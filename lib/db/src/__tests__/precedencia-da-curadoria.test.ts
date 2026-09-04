import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { runMigrations } from "../migrate";
import {
  aplicarConfirmacoesCanonicas,
  CAMPOS_DA_NORMALIZACAO_CANONICA,
  CONFIRMED_SEMANTICS,
  ESTADO_E_DECISAO_HUMANA,
} from "../semantica-confirmada";
import { garantirSemanticaInicial } from "../semantica-inicial";
import { garantirTaxonomiaCanonica } from "../taxonomia-canonica";
import type { Database } from "../index";

/**
 * A PRECEDÊNCIA, PRESA COMO CONTRATO.
 *
 *     curadoria humana existente > confirmação canônica > inferência automática
 *
 * A normalização canônica fica — é ela que faz `cavalo.ipva_licenciamento`
 * nascer com semântica em vez de "não apurado". O que este arquivo impede é ela
 * subir um degrau: prevalecer sobre o que uma pessoa já decidiu nesta base.
 *
 * O risco não é alguém reescrever a regra de propósito. É alguém **ampliar** a
 * função — um estado novo de `semantics_status`, um campo novo de curadoria — e
 * a decisão humana passar a ser sobrescrita por omissão, uma vez por arquivo
 * recebido, sem nada acusar. Os dois primeiros testes daqui são exatamente
 * essas duas ampliações; os outros são o comportamento que elas protegem.
 *
 * Mora em `@workspace/db`, ao lado da implementação, e por isso monta os
 * atributos com `INSERT` em vez de importar planilha: a fronteira desta camada
 * é não conhecer nem a ingestão nem a curadoria (ver `fronteira.test.ts`).
 *
 * Precisa de um Postgres. Na máquina de quem desenvolve, pula; no CI não pula.
 */

const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const NOME = `fc_precedencia_${process.pid}`;

/**
 * O mesmo `urlFor` de `@workspace/ingest/testing`, e pelo mesmo motivo:
 * `new URL` recusa a forma por socket (`postgres@/postgres?host=...`), que é
 * como esta base é alcançada quando não há Postgres em TCP.
 */
function apontarPara(url: string, banco: string): string {
  return url.includes("/postgres?")
    ? url.replace("/postgres?", `/${banco}?`)
    : url.replace(/\/postgres$/, `/${banco}`);
}

async function bancoAlcancavel(): Promise<boolean> {
  const pool = new pg.Pool({ connectionString: ADMIN, connectionTimeoutMillis: 1500 });
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => {});
  }
}

const noCi = process.env.CI === "true" || process.env.CI === "1";
const temBanco = noCi || (await bancoAlcancavel());

/** Uma entrada do registro que classifica — tem nó e significado a preencher. */
const ENTRADA = CONFIRMED_SEMANTICS.find(
  (e) => e.meaningCode !== undefined && e.taxonomyCode !== undefined,
)!;

describe.skipIf(!temBanco)("a precedência da curadoria sobre a normalização", () => {
  let pool: pg.Pool;
  let db: Database;

  /** Todas as colunas de `attribute`, para diferenciar linha contra linha. */
  let colunasDaTabela: string[];

  async function linha(code: string): Promise<Record<string, unknown>> {
    const { rows } = await pool.query(`SELECT * FROM attribute WHERE code = $1`, [code]);
    return rows[0];
  }

  /** Quais colunas mudaram entre dois retratos da mesma linha. */
  function alteradas(
    antes: Record<string, unknown>,
    depois: Record<string, unknown>,
  ): string[] {
    return colunasDaTabela.filter(
      (c) => String(antes[c] ?? " ") !== String(depois[c] ?? " "),
    );
  }

  /**
   * Um atributo com a prosa toda escrita — o que nenhuma máquina repõe — e o
   * estado técnico que o teste quiser.
   */
  async function criarAtributo(
    code: string,
    estado: Record<string, string | boolean | null>,
  ): Promise<void> {
    const campos: Record<string, string | boolean | null> = {
      code,
      source_name: code.split(".")[1],
      entity_type: code.split(".")[0].toUpperCase(),
      data_type: "NUMERIC",
      display_name: `Nome gerencial de ${code}`,
      definition: `O que ${code} significa, escrito por gente.`,
      change_rule: "Muda quando o contrato é renegociado.",
      economic_direction: "HIGHER_IS_WORSE",
      economic_effect: "Sobe o custo da frota.",
      ...estado,
    };
    // `attribute_confirmed_requires_actor`: CONFIRMED sem autor e sem data não
    // é confirmação de ninguém, e o banco recusa. A data acompanha o autor.
    if (campos.semantics_status === "CONFIRMED" && campos.confirmed_at == null) {
      campos.confirmed_at = new Date().toISOString();
    }
    const nomes = Object.keys(campos);
    await pool.query(
      `INSERT INTO attribute (${nomes.join(", ")})
       VALUES (${nomes.map((_, i) => `$${i + 1}`).join(", ")})`,
      Object.values(campos),
    );
  }

  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: ADMIN });
    await admin.query(`DROP DATABASE IF EXISTS "${NOME}"`);
    await admin.query(`CREATE DATABASE "${NOME}"`);
    await admin.end();

    const url = apontarPara(ADMIN, NOME);
    await runMigrations(url);
    pool = new pg.Pool({ connectionString: url });
    db = drizzle(pool) as unknown as Database;

    // A árvore precisa existir para o nó do registro poder ser resolvido — é a
    // mesma ordem que `promote` executa.
    await garantirTaxonomiaCanonica(db, "teste");

    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'attribute'
        ORDER BY column_name`,
    );
    colunasDaTabela = rows.map((r) => r.column_name);
  }, 300_000);

  afterAll(async () => {
    await pool?.end();
    const limpeza = new pg.Pool({ connectionString: ADMIN });
    await limpeza.query(`DROP DATABASE IF EXISTS "${NOME}"`).catch(() => {});
    await limpeza.end();
  });

  // -------------------------------------------------------------------------
  // As duas travas contra a ampliação silenciosa
  // -------------------------------------------------------------------------

  /**
   * Um estado novo de `semantics_status` não pode cair do lado automático por
   * omissão.
   *
   * O `Record` sobre o enum já faz o TypeScript recusar a compilação de um
   * estado não classificado; este teste cobre o outro caminho, o de uma
   * migration acrescentar o rótulo ao banco sem que ninguém volte aqui.
   */
  it("todo estado de semantics_status está classificado como humano ou automático", async () => {
    const { rows } = await pool.query<{ rotulo: string }>(
      `SELECT e.enumlabel AS rotulo
         FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'semantics_status'
        ORDER BY e.enumsortorder`,
    );
    expect(rows.map((r) => r.rotulo).sort()).toEqual(
      Object.keys(ESTADO_E_DECISAO_HUMANA).sort(),
    );

    // E o que a classificação afirma hoje, dito por extenso: só a assinatura de
    // uma pessoa conta como decisão dela.
    expect(ESTADO_E_DECISAO_HUMANA).toEqual({
      CONFIRMED: true,
      PRESUMED: false,
      UNKNOWN: false,
    });
  });

  /**
   * A normalização não pode crescer para dentro da curadoria.
   *
   * O teste roda a passada sobre um atributo que ela **vai** escrever, e compara
   * o conjunto de colunas alteradas com a lista declarada. Acrescentar
   * `definition` ao registro deixa de ser uma linha discreta: fica vermelho
   * aqui, com o nome do campo na mensagem.
   */
  it("a passada canônica só escreve os campos que ela declara", async () => {
    await criarAtributo(ENTRADA.code, { semantics_status: "UNKNOWN" });
    await garantirSemanticaInicial(db);

    const antes = await linha(ENTRADA.code);
    const resultado = await aplicarConfirmacoesCanonicas(db, [ENTRADA]);
    const depois = await linha(ENTRADA.code);

    expect(resultado.applied).toEqual([ENTRADA.code]);
    const mudou = alteradas(antes, depois);
    expect(mudou.length).toBeGreaterThan(0);
    expect(
      mudou.filter(
        (c) => !(CAMPOS_DA_NORMALIZACAO_CANONICA as readonly string[]).includes(c),
      ),
    ).toEqual([]);

    // E a prosa, que é o degrau de cima, atravessou intacta.
    expect(depois.definition).toBe(antes.definition);
    expect(depois.display_name).toBe(antes.display_name);
    expect(depois.change_rule).toBe(antes.change_rule);
    expect(depois.economic_direction).toBe(antes.economic_direction);
    expect(depois.economic_effect).toBe(antes.economic_effect);
  });

  // -------------------------------------------------------------------------
  // A precedência, degrau por degrau
  // -------------------------------------------------------------------------

  /** Decisão humana com outra semântica: o registro se cala e relata. */
  it("não sobrescreve quem confirmou com semântica diferente", async () => {
    const code = `${ENTRADA.code}_divergente`;
    await criarAtributo(code, {
      semantics_status: "CONFIRMED",
      confirmed_by: "quem.decidiu@exemplo.com",
      unit: "PERCENT",
      periodicity: null,
      aggregation: "NONE",
      is_monetary: false,
    });
    await garantirSemanticaInicial(db);

    const antes = await linha(code);
    const resultado = await aplicarConfirmacoesCanonicas(db, [{ ...ENTRADA, code }]);

    expect(resultado.divergentes).toEqual([code]);
    expect(resultado.applied).toEqual([]);
    expect(alteradas(antes, await linha(code))).toEqual([]);
  });

  /**
   * Decisão humana com a mesma semântica técnica, mas outro nó: o registro
   * **completa o que está nulo** e não troca o que alguém escolheu.
   *
   * Este é o degrau que faltava. A condição era só "é diferente do registro?",
   * e por ela o nó de quem classificou à mão voltava ao do registro a cada
   * importação — normalização técnica prevalecendo sobre curadoria, que é a
   * precedência ao contrário.
   */
  it("não troca o nó nem o significado que uma pessoa escolheu", async () => {
    const { rows: outroNo } = await pool.query<{ id: string }>(
      `SELECT id FROM taxonomy_node WHERE code <> $1 ORDER BY path LIMIT 1`,
      [ENTRADA.taxonomyCode!],
    );
    const code = `${ENTRADA.code}_no_proprio`;
    await criarAtributo(code, {
      semantics_status: "CONFIRMED",
      confirmed_by: "quem.classificou@exemplo.com",
      unit: ENTRADA.unit,
      periodicity: ENTRADA.periodicity,
      aggregation: ENTRADA.aggregation,
      is_monetary: ENTRADA.isMonetary,
      taxonomy_node_id: outroNo[0].id,
    });
    await garantirSemanticaInicial(db);

    const antes = await linha(code);
    await aplicarConfirmacoesCanonicas(db, [{ ...ENTRADA, code }]);
    const depois = await linha(code);

    // O nó que a pessoa escolheu continua sendo o dela, e a assinatura também
    // — nome e data, porque a data é quando ela decidiu, não quando o registro
    // passou por aqui.
    expect(depois.taxonomy_node_id).toBe(outroNo[0].id);
    expect(depois.confirmed_by).toBe("quem.classificou@exemplo.com");
    expect(depois.confirmed_at).toEqual(antes.confirmed_at);

    /*
      O que mudou foram os dois campos que estavam **nulos**: a regra é "não
      substituir", e não "não encostar". `semantics_rationale` entra porque é o
      campo em que o motor e o registro escrevem por que propuseram algo — não é
      prosa de curador, e nasce nulo aqui.

      Esta lista é o teste inteiro: se o nó, a assinatura ou a data entrarem
      nela, a normalização voltou a prevalecer sobre a curadoria.
    */
    expect(alteradas(antes, depois)).toEqual(["meaning_id", "semantics_rationale"]);
    expect(antes.meaning_id).toBeNull();
    expect(depois.meaning_id).not.toBeNull();
  });

  /**
   * E o degrau de baixo continua funcionando: sem decisão humana, o registro
   * escreve — inclusive completando o nó que estava nulo.
   *
   * É o caso que a normalização existe para servir, e prendê-lo aqui é o que
   * impede a proteção de virar paralisia.
   */
  it("sobre coluna sem decisão humana, a normalização se aplica inteira", async () => {
    const code = `${ENTRADA.code}_presumido`;
    await criarAtributo(code, {
      semantics_status: "PRESUMED",
      unit: "PERCENT",
      aggregation: "NONE",
    });
    await garantirSemanticaInicial(db);

    const resultado = await aplicarConfirmacoesCanonicas(db, [{ ...ENTRADA, code }]);
    expect(resultado.applied).toEqual([code]);

    const depois = await linha(code);
    expect(depois.semantics_status).toBe("CONFIRMED");
    expect(depois.unit).toBe(ENTRADA.unit);
    expect(depois.confirmed_by).toBe(ENTRADA.confirmedBy);
    // O nó estava nulo, e completar nulo é o que o registro faz.
    expect(depois.taxonomy_node_id).not.toBeNull();
    expect(depois.meaning_id).not.toBeNull();
  });

  /**
   * Completar o nulo continua valendo **também** sobre decisão humana — é o
   * caso da base cuja árvore ainda não fora semeada quando alguém confirmou.
   *
   * A regra é "não substituir", e não "não encostar": sem esta metade, um
   * atributo confirmado antes da árvore ficaria sem nó para sempre.
   */
  it("sobre decisão humana, completa o que está nulo — e só isso", async () => {
    const code = `${ENTRADA.code}_sem_no`;
    await criarAtributo(code, {
      semantics_status: "CONFIRMED",
      confirmed_by: "quem.confirmou.cedo@exemplo.com",
      unit: ENTRADA.unit,
      periodicity: ENTRADA.periodicity,
      aggregation: ENTRADA.aggregation,
      is_monetary: ENTRADA.isMonetary,
    });
    await garantirSemanticaInicial(db);

    const antes = await linha(code);
    expect(antes.taxonomy_node_id).toBeNull();

    await aplicarConfirmacoesCanonicas(db, [{ ...ENTRADA, code }]);
    const depois = await linha(code);

    expect(depois.taxonomy_node_id).not.toBeNull();
    // E a assinatura continua sendo a de quem confirmou, não a do registro.
    expect(depois.confirmed_by).toBe("quem.confirmou.cedo@exemplo.com");
    expect(depois.definition).toBe(antes.definition);
  });
});
