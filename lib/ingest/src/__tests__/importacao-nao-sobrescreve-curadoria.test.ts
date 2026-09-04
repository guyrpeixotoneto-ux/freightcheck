import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "../testing";
import { escreverPlanilha, planilhaPadrao } from "./planilha-sintetica";
import { captureRaw, preview, promote, receiveFile, stage } from "../pipeline";

/**
 * O outro lado do mesmo contrato: **importar** também não desfaz curadoria.
 *
 * Excluir uma importação deixou de apagar colunas. Isso só vale a pena se a
 * porta de entrada respeitar a mesma regra — de nada adianta a coluna
 * sobreviver à exclusão se a planilha do mês seguinte zerar o que alguém
 * escreveu nela.
 *
 * ---------------------------------------------------------------------------
 * A evidência no código, que este arquivo prende
 * ---------------------------------------------------------------------------
 *
 * A promoção resolve o atributo assim (`pipeline.ts`, bloco `--- atributos`):
 *
 *     const existing = await tx.select().from(attributeTable)
 *                        .where(eq(attributeTable.code, code));
 *     if (existing.length > 0) { attributeCache.set(code, existing[0].id); continue; }
 *
 * O `continue` é o contrato inteiro: achou pelo `code`, **reusa e não escreve
 * nada**. Não existe `UPDATE attribute` nem `onConflictDoUpdate` no pipeline; o
 * `INSERT` só roda para código que ainda não existe, e o alias novo entra com
 * `onConflictDoNothing`.
 *
 * Depois do bloco, a promoção chama três garantias, e duas delas só preenchem
 * vazio: `garantirSemanticaInicial` insere a versão 1 apenas `WHERE NOT EXISTS`
 * uma versão (e copia **do** atributo, nunca para ele), e
 * `garantirClasseDeCustoPadrao` filtra `cost_class IS NULL`.
 *
 * ---------------------------------------------------------------------------
 * A exceção, dita na cara: o registro canônico
 * ---------------------------------------------------------------------------
 *
 * A terceira é `aplicarConfirmacoesCanonicas`, e ela **escreve semântica** — é o
 * único ponto em que a importação o faz. Não é inferência: `CONFIRMED_SEMANTICS`
 * é um registro de decisões humanas, cada entrada com autor e base, revisada em
 * pull request. Ela alcança apenas os códigos listados lá, e apenas os campos
 * técnicos: `unit`, `periodicity`, `aggregation`, `is_monetary`, `meaning_id`,
 * `taxonomy_node_id`, `semantics_status`, `confirmed_by`, `semantics_rationale`.
 *
 * O que ela nunca toca, em coluna nenhuma: `definition`, `change_rule`,
 * `display_name`, `economic_direction`, `economic_effect`, `source_name`,
 * `code` e `id`. E quando alguém já **confirmou** a coluna com outra semântica,
 * ela se recusa a corrigir — relata em `divergentes` e segue.
 *
 * Os dois lados estão presos aqui: a coluna fora do registro, intocada em tudo;
 * e a coluna do registro, com a prosa intocada e a semântica reafirmada.
 */

let ctx: TestDb;

interface Coluna {
  id: string;
  code: string;
  source_name: string;
  display_name: string | null;
  definition: string | null;
  change_rule: string | null;
  economic_direction: string | null;
  economic_effect: string | null;
  cost_class: string | null;
  data_type: string;
  unit: string | null;
  periodicity: string | null;
  aggregation: string | null;
  meaning_id: string | null;
  taxonomy_node_id: string | null;
  semantics_status: string;
  confirmed_by: string | null;
}

const CAMPOS = `id, code, source_name, display_name, definition, change_rule,
                economic_direction, economic_effect, cost_class, data_type,
                unit, periodicity, aggregation, meaning_id, taxonomy_node_id,
                semantics_status, confirmed_by`;

/** A coluna do dicionário, pelo nome que ela tem no arquivo e pelo equipamento. */
async function coluna(sourceName: string, entityType: string): Promise<Coluna> {
  const { rows } = await ctx.pool.query<Coluna>(
    `SELECT ${CAMPOS} FROM attribute WHERE source_name = $1 AND entity_type = $2`,
    [sourceName, entityType],
  );
  expect([sourceName, entityType, rows.length]).toEqual([sourceName, entityType, 1]);
  return rows[0];
}

async function contar(query: string): Promise<number> {
  const { rows } = await ctx.pool.query<{ n: string }>(query);
  return Number(rows[0].n);
}

async function importar(arquivo: string) {
  const recebido = await receiveFile(ctx.db, {
    filePath: arquivo,
    receivedBy: "quem.importou@exemplo.com",
  });
  await captureRaw(ctx.db, recebido.importRunId);
  await stage(ctx.db, recebido.importRunId);
  const relatorio = await preview(ctx.db, recebido.importRunId);
  await promote(ctx.db, recebido.importRunId, {
    confirmNewEntityTypes: relatorio.pendingIdentities,
  });
  return recebido.importRunId;
}

/**
 * O arquivo de um mês.
 *
 * `carencia` entra sem valor nenhum de propósito: é uma coluna do registro
 * canônico chegando vazia, e é o caso que derrubava a promoção inteira.
 */
function planilhaDoMes(vigencia: string, extrasDaCarreta: string[] = []): string {
  const valoresCarreta: Record<string, number> = {
    custoRastreador: 120,
    periodoFiname: 48,
  };
  for (const extra of extrasDaCarreta) valoresCarreta[extra] = 7;

  return escreverPlanilha(
    planilhaPadrao({
      vigencia,
      abas: [
        {
          nome: "carretas",
          colunas: ["custoRastreador", "periodoFiname", "carencia", ...extrasDaCarreta],
          linhas: [{ placa: "XYZ9A88", valores: valoresCarreta }],
        },
        {
          nome: "cavalos",
          colunas: ["periodoFiname"],
          linhas: [{ placa: "ABC1D23", valores: { periodoFiname: 60 } }],
        },
      ],
    }),
  );
}

beforeAll(async () => {
  ctx = await createTestDatabase("curadoria_reimportacao");
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("uma importação nova não sobrescreve a curadoria de um atributo existente", () => {
  /** Fora do registro canônico: curada por inteiro, e intocável. */
  let curadaAntes: Coluna;
  /** No registro, e confirmada por gente de outro jeito. */
  let divergenteAntes: Coluna;
  /** No registro, com prosa escrita e semântica ainda em aberto. */
  let comProsaAntes: Coluna;
  let colunasAntes: number;

  beforeAll(async () => {
    await importar(planilhaDoMes("EMPURRADA_1_8_2026"));

    const [{ id: significadoId }] = (
      await ctx.pool.query<{ id: string }>(
        `SELECT id FROM semantic_meaning WHERE scope_type = 'GLOBAL' ORDER BY code LIMIT 1`,
      )
    ).rows;
    const [{ id: noId }] = (
      await ctx.pool.query<{ id: string }>(
        `SELECT id FROM taxonomy_node ORDER BY path LIMIT 1`,
      )
    ).rows;

    /*
      `custoRastreador` — o caso do pedido, e o caso comum: uma coluna que o
      registro canônico não conhece, curada por inteiro na tela.

      Escrita direto na projeção pelo mesmo motivo de `fronteira.test.ts`: a
      importação não pode depender da curadoria, nem dentro de um teste dela.
    */
    const alvo = await coluna("custoRastreador", "CARRETA");
    await ctx.pool.query(
      `UPDATE attribute
          SET display_name       = 'Custo do rastreador, por mês',
              definition         = 'A mensalidade do rastreador embarcado na carreta.',
              change_rule        = 'Muda quando o contrato com a rastreadora é renegociado.',
              economic_direction = 'HIGHER_IS_WORSE',
              economic_effect    = 'Mensalidade maior derruba a margem da carreta.',
              cost_class         = 'FIXO',
              unit               = 'BRL',
              periodicity        = 'MENSAL',
              aggregation        = 'SUM',
              is_monetary        = true,
              meaning_id         = $2,
              taxonomy_node_id   = $3,
              semantics_status   = 'CONFIRMED',
              confirmed_by       = 'quem.curou@exemplo.com',
              confirmed_at       = now()
        WHERE id = $1`,
      [alvo.id, significadoId, noId],
    );

    /*
      `carreta.periodoFiname` — está em `CONFIRMED_SEMANTICS`, e aqui alguém o
      confirmou com **outra** semântica. É o limite do registro: ele relata a
      divergência e não corrige.
    */
    const divergente = await coluna("periodoFiname", "CARRETA");
    await ctx.pool.query(
      `UPDATE attribute
          SET unit             = 'ANO',
              periodicity      = 'ANUAL',
              aggregation      = 'NONE',
              is_monetary      = false,
              definition       = 'Prazo do FINAME contado em anos, como a diretoria pede.',
              semantics_status = 'CONFIRMED',
              confirmed_by     = 'quem.discordou@exemplo.com',
              confirmed_at     = now()
        WHERE id = $1`,
      [divergente.id],
    );

    /*
      `cavalo.periodoFiname` — também do registro, mas **não** confirmado por
      ninguém: prosa escrita, semântica ainda em palpite. Aqui o registro vai
      escrever, e é o que o último teste deste arquivo documenta.
    */
    const comProsa = await coluna("periodoFiname", "CAVALO");
    await ctx.pool.query(
      `UPDATE attribute
          SET display_name       = 'Prazo do FINAME, em meses',
              definition         = 'Quantos meses faltam para o fim do financiamento do cavalo.',
              change_rule        = 'Muda quando o contrato é renegociado com o banco.',
              economic_direction = 'HIGHER_IS_WORSE',
              economic_effect    = 'Prazo maior estica a parcela por mais tempo.',
              unit               = 'ANO',
              aggregation        = 'NONE',
              semantics_status   = 'PRESUMED'
        WHERE id = $1`,
      [comProsa.id],
    );

    curadaAntes = await coluna("custoRastreador", "CARRETA");
    divergenteAntes = await coluna("periodoFiname", "CARRETA");
    comProsaAntes = await coluna("periodoFiname", "CAVALO");
    colunasAntes = await contar(`SELECT count(*) AS n FROM attribute`);

    // O mês seguinte: as mesmas colunas, mais uma que nunca existiu.
    await importar(planilhaDoMes("EMPURRADA_2_8_2026", ["taxaAvaria"]));
  }, 900_000);

  /** Contrato 1 — o nome gerencial. */
  it("preserva o Nome Gerencial", async () => {
    expect((await coluna("custoRastreador", "CARRETA")).display_name).toBe(
      "Custo do rastreador, por mês",
    );
  });

  /** Contrato 2 — a prosa e os demais campos manuais. */
  it("preserva definição, regra de alteração, direção econômica e classe de custo", async () => {
    const agora = await coluna("custoRastreador", "CARRETA");
    expect(agora.definition).toBe(curadaAntes.definition);
    expect(agora.change_rule).toBe(curadaAntes.change_rule);
    expect(agora.economic_direction).toBe("HIGHER_IS_WORSE");
    expect(agora.economic_effect).toBe(curadaAntes.economic_effect);
    expect(agora.cost_class).toBe("FIXO");
    expect(agora.unit).toBe("BRL");
    expect(agora.periodicity).toBe("MENSAL");
  });

  /** Contrato 3 — significado, taxonomia, estado e autoria. */
  it("preserva meaning_id, taxonomy_node_id, semantics_status e confirmed_by", async () => {
    const agora = await coluna("custoRastreador", "CARRETA");
    expect(agora.meaning_id).toBe(curadaAntes.meaning_id);
    expect(agora.taxonomy_node_id).toBe(curadaAntes.taxonomy_node_id);
    expect(agora.semantics_status).toBe("CONFIRMED");
    expect(agora.confirmed_by).toBe("quem.curou@exemplo.com");

    // A importação também não abriu versão nova da semântica por cima da que havia.
    expect(
      await contar(
        `SELECT count(*) AS n FROM attribute_semantics WHERE attribute_id = '${curadaAntes.id}'`,
      ),
    ).toBe(1);

    // E o campo por campo, que é o contrato inteiro numa linha só.
    expect(agora).toEqual(curadaAntes);
  });

  /** Contrato 4 — a coluna é a mesma linha, não uma segunda. */
  it("não cria atributo duplicado: o mesmo code, a mesma linha, com o dado novo", async () => {
    const agora = await coluna("custoRastreador", "CARRETA");
    expect(agora.id).toBe(curadaAntes.id);
    expect(agora.code).toBe(curadaAntes.code);

    // Uma linha a mais no dicionário, e uma só: a coluna que chegou agora.
    expect(await contar(`SELECT count(*) AS n FROM attribute`)).toBe(colunasAntes + 1);
    expect(
      await contar(
        `SELECT count(*) AS n FROM (SELECT code FROM attribute GROUP BY code HAVING count(*) > 1) d`,
      ),
    ).toBe(0);

    // E os fatos dos dois meses estão pendurados na mesma coluna curada.
    const { rows } = await ctx.pool.query<{ n: string }>(
      `SELECT count(DISTINCT s.id) AS n
         FROM fact f JOIN snapshot s ON s.id = f.snapshot_id
        WHERE f.attribute_id = $1`,
      [curadaAntes.id],
    );
    expect(Number(rows[0].n)).toBe(2);
  });

  /** Contrato 5 — `source_name` é o nome do arquivo, e só isso. */
  it("source_name continua sendo o nome de origem, e não vira o nome gerencial", async () => {
    const agora = await coluna("custoRastreador", "CARRETA");
    expect(agora.source_name).toBe("custoRastreador");
    expect(agora.display_name).not.toBe(agora.source_name);

    /*
      E nenhuma coluna do banco nasce com o nome gerencial igual ao de origem —
      um campo que abre preenchido com a resposta errada parece respondido sem
      ninguém ter respondido. Ver a migration 0089 e o comentário do `INSERT` de
      `attribute` em `pipeline.ts`.
    */
    expect(
      await contar(`SELECT count(*) AS n FROM attribute
                     WHERE display_name IS NOT NULL AND display_name = source_name`),
    ).toBe(0);
    expect(
      await contar(`SELECT count(*) AS n FROM attribute WHERE source_name IS NULL`),
    ).toBe(0);
  });

  /** Contrato 6 — a coluna nova entra, e não encosta em ninguém. */
  it("uma coluna nova cria um atributo novo, sem interferir nos existentes", async () => {
    const nova = await coluna("taxaAvaria", "CARRETA");
    expect(nova.id).not.toBe(curadaAntes.id);
    expect(nova.display_name).toBeNull();
    expect(nova.definition).toBeNull();
    expect(
      await contar(`SELECT count(*) AS n FROM fact WHERE attribute_id = '${nova.id}'`),
    ).toBeGreaterThan(0);

    // A curada continua exatamente como estava, campo por campo.
    expect(await coluna("custoRastreador", "CARRETA")).toEqual(curadaAntes);
  });

  /**
   * O limite do registro canônico, no caso em que ele **não** escreve.
   *
   * Sem esta guarda, o registro reescreveria a decisão de quem opera a cada
   * arquivo recebido — e quem confirmou de outro jeito descobriria isso pelo
   * número mudando na tela, não por uma conversa.
   */
  it("o registro canônico não reescreve quem confirmou diferente", async () => {
    const agora = await coluna("periodoFiname", "CARRETA");
    expect(agora.unit).toBe("ANO");
    expect(agora.confirmed_by).toBe("quem.discordou@exemplo.com");
    expect(agora).toEqual(divergenteAntes);
  });

  /**
   * E o caso em que ele escreve — documentado, porque é a única exceção.
   *
   * A coluna está no registro e ninguém a confirmou: a promoção aplica a
   * decisão registrada. A prosa da curadoria atravessa intacta; o que muda são
   * os campos técnicos e a assinatura, que passam a ser os do registro.
   */
  it("no código do registro ainda não confirmado, a semântica é reafirmada — e a prosa fica", async () => {
    const agora = await coluna("periodoFiname", "CAVALO");

    // A prosa, que é o que nenhuma importação repõe, atravessou inteira.
    expect(agora.display_name).toBe(comProsaAntes.display_name);
    expect(agora.definition).toBe(comProsaAntes.definition);
    expect(agora.change_rule).toBe(comProsaAntes.change_rule);
    expect(agora.economic_direction).toBe(comProsaAntes.economic_direction);
    expect(agora.economic_effect).toBe(comProsaAntes.economic_effect);

    // E os campos técnicos são os do registro — `cavalo.periodo_finame` é
    // "grandeza em meses, média, não monetária", decidido em 29/08/2026.
    expect(comProsaAntes.semantics_status).toBe("PRESUMED");
    expect(agora.semantics_status).toBe("CONFIRMED");
    expect(agora.unit).toBe("MESES");
    expect(agora.aggregation).toBe("AVG");
  });

  /**
   * Uma coluna do registro que chega **vazia** não derruba a promoção.
   *
   * `carencia` está em `CONFIRMED_SEMANTICS` com agregação `AVG`, e chega sem
   * um único valor: o tipo dela é `UNKNOWN`, e `attribute_semantica_coerente`
   * proíbe agregação sobre coluna não numérica. A guarda olhava só `isMonetary`
   * e deixava passar, e o arquivo inteiro morria com um `23514` cru — o cliente
   * é quem decide se uma coluna vem preenchida, então isto não é hipótese.
   *
   * Agora ela sai por `incoerentes`, que `promote` já reporta, e a coluna fica
   * no dicionário esperando o mês em que vier com número.
   */
  it("uma coluna do registro que chega vazia é relatada, e não derruba a importação", async () => {
    const vazia = await coluna("carencia", "CARRETA");
    expect(vazia.data_type).toBe("UNKNOWN");
    expect(vazia.semantics_status).not.toBe("CONFIRMED");
    expect(vazia.aggregation).toBeNull();
  });
});
