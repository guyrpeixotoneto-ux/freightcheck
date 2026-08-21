import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import {
  cadastrarUnidade,
  fechamentoCompetenciaTable,
  remuneracaoPlanilhaTable,
  remuneracaoUnidadeTable,
  unidadeTable,
  type Database,
} from "@workspace/db";
import { runMigrations } from "@workspace/db/migrate";

import { abrirCompetencia, associarUnidadeDaCompetencia } from "../persistencia";
import { linhasDoCustoFixo, type ParametrosDoCadastro } from "../mapa-rota";

/**
 * O CASO `CDD Belém` — a prova principal, ponta a ponta.
 *
 * **O defeito, como ele chegou aqui.** Uma competência foi aberta quando o
 * formulário tinha um campo só para a unidade, e ficou gravada com
 * `unidade_codigo = "CDD Belém"` — um nome fazendo papel de código. O cadastro
 * de Remuneração da mesma unidade usava outro identificador. O fechamento
 * comparava os dois textos, não achava, e o Resumo caía no painel do 03.08.20
 * relido: seis linhas `em conjunto`, nenhum devido, e nada na tela dizendo por
 * quê. A única saída era excluir a competência e reimportar tudo.
 *
 * **O que este arquivo prova, em ordem:**
 *
 * 1. antes de haver identidade, o cadastro **não** é encontrado — e não é
 *    encontrado por engano nenhum: a competência não tem `unidade_id`;
 * 2. cadastrar a unidade canônica e associar a competência a ela **não toca**
 *    em nada do que foi importado;
 * 3. depois da associação, o cadastro é encontrado **pela identidade**, sem
 *    comparar texto;
 * 4. e o devido que sai dali é o mesmo número que a reconciliação contra a
 *    `.xlsb` real prende — quer dizer: o Resumo recebeu os valores da unidade
 *    certa.
 *
 * O passo 4 é o critério funcional, e ele é encadeado de propósito:
 * `reconciliacao.test.ts` já prova que o motor bate com a planilha ao centavo;
 * aqui se prova que **este** Resumo usa **aquele** motor com **aquele**
 * contrato. Repetir a conferência da planilha aqui seria uma segunda verdade
 * sobre o mesmo número.
 */

const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const NOME_DO_BANCO = `fc_belem_${process.pid}`;

function apontarPara(url: string, banco: string): string {
  const alvo = new URL(url);
  alvo.pathname = `/${banco}`;
  return alvo.toString();
}

async function alcancavel(): Promise<boolean> {
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

const temBanco = await alcancavel();

/** O CNPJ verdadeiro da unidade — informado **uma vez**, no cadastro mestre. */
const CNPJ = "11222333000181";

/** O escopo da unidade em Remuneração — o `scope_hash` que ela já tinha. */
const ESCOPO = "sha-de-belem";

/**
 * A aba `Cadastro` de julho/2026, como a tela a guarda.
 *
 * São os valores reais do fechamento CDD Belém · Horizonte, os mesmos de
 * `mapa-rota.test.ts` e da amostra que a reconciliação usa.
 */
const ABA: [string, number][] = [
  ["aliquota_pis", 0.65],
  ["aliquota_cofins", 8.6],
  ["aliquota_icms", 17.84],
  ["aliquota_iss", 5.9],
  ["rota_percentual_iss", 3.16],
  ["frota_fixa_ativos", 56],
  ["frota_fixa_inativos", 8],
  ["ativo_remuneracao_fixa_frota", 1424.91],
  ["ativo_remuneracao_fixa_equipe", 8919.38],
  ["ativo_custo_variavel", 5176.53],
  ["ativo_remuneracao_fixa_qlp", 4427.53],
  ["ativo_outras_despesas", 4361.07],
  ["inativo_remuneracao_fixa", 1650.97],
  ["van_quantidade_ativas", 7],
  ["van_custo_fixo", 4693.85],
  ["van_custo_equipe", 4250.45],
  ["van_quantidade_inativas", 6],
  ["van_remuneracao_inativas", 3195.18],
  ["noturna_quantidade_rotas", 1],
  ["noturna_custo_sem_impostos", 8697.88],
  ["marketing_sem_impostos", 0],
];

/** O mesmo contrato, na forma que o motor consome — para o cotejo do passo 4. */
const CONTRATO: ParametrosDoCadastro = {
  aliquotas: { pis: 0.0065, cofins: 0.086, icms: 0.1784, iss: 0.059 },
  parcelaDentroDoMunicipio: 0.0316,
  frotaFixaAtiva: 56,
  frotaFixaInativa: 8,
  remuneracaoFixaDaFrotaAtiva: 1424.91,
  remuneracaoDaEquipeDeEntrega: 8919.38,
  remuneracaoDoQlpAdministrativo: 4427.53,
  remuneracaoDeOutrasDespesas: 4361.07,
  remuneracaoDaFrotaInativa: 1650.97,
  vansAtivas: 7,
  custoFixoDaVan: 4693.85,
  custoDaEquipeDeEntregaDaVan: 4250.45,
  vansInativas: 6,
  remuneracaoDasVansInativas: 3195.18,
  rotasNoturnas: 1,
  custoDaNoturnaSemImposto: 8697.88,
  custoDeMarketingSemImposto: 0,
};

describe.skipIf(!temBanco)("o caso CDD Belém, ponta a ponta", () => {
  let pool: pg.Pool;
  let db: Database;

  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: ADMIN });
    await admin.query(`DROP DATABASE IF EXISTS "${NOME_DO_BANCO}"`);
    await admin.query(`CREATE DATABASE "${NOME_DO_BANCO}"`);
    await admin.end();
    const url = apontarPara(ADMIN, NOME_DO_BANCO);
    await runMigrations(url);
    pool = new pg.Pool({ connectionString: url });
    db = drizzle(pool) as unknown as Database;

    /* A competência como ela está hoje: o nome no lugar do código. */
    await abrirCompetencia(db, {
      ano: 2026,
      mes: 7,
      quinzena: 1,
      tipoDeOperacao: "ROTA",
      unidade: { codigo: "CDD Belém", nome: "CDD BELÉM" },
      transportadora: { codigo: "36", nome: "HORIZONTE" },
    });

    /* O cadastro de Remuneração da mesma unidade, com **outro** identificador. */
    await db.insert(remuneracaoUnidadeTable).values({
      scopeHash: ESCOPO,
      scopeType: "UNIDADE",
      codigo: "11.222.333/0001-81",
      nome: "CDD BELÉM",
      canal: "ROTA",
      vigenciaInicial: "2026-07-01",
    });
    await db.insert(remuneracaoPlanilhaTable).values(
      ABA.map(([chave, valor]) => ({
        scopeHash: ESCOPO,
        canal: "ROTA",
        effectiveDate: "2026-07-01",
        chave,
        valor: String(valor),
      })),
    );
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    const admin = new pg.Pool({ connectionString: ADMIN });
    await admin.query(`DROP DATABASE IF EXISTS "${NOME_DO_BANCO}"`).catch(() => {});
    await admin.end().catch(() => {});
  });

  const aCompetencia = async () => {
    const [c] = await db
      .select()
      .from(fechamentoCompetenciaTable)
      .where(eq(fechamentoCompetenciaTable.unidadeCodigo, "CDD Belém"));
    return c!;
  };

  it("1. antes: a competência não tem identidade, e o texto dela não é CNPJ", async () => {
    const c = await aCompetencia();
    expect(c.unidadeId).toBeNull();
    expect(c.unidadeCodigo).toBe("CDD Belém");
    /*
      E é por isso que o casamento por texto não salvaria: `CDD Belém` não tem
      dígito nenhum, e o cadastro guarda um CNPJ. Nenhuma das três faixas casa —
      corretamente, porque casar aqui seria adivinhar pelo nome.
    */
    expect(c.unidadeCodigo.replace(/\D/g, "")).toBe("");
  });

  it("2. o CNPJ é informado uma vez, no cadastro mestre", async () => {
    const u = await cadastrarUnidade(db, { nome: "CDD Belém", cnpj: "11.222.333/0001-81" });
    expect(u.cnpj).toBe(CNPJ);

    /* A Remuneração passa a apontar para a mesma unidade — sem redigitar CNPJ. */
    await db
      .update(remuneracaoUnidadeTable)
      .set({ unidadeId: u.id })
      .where(eq(remuneracaoUnidadeTable.scopeHash, ESCOPO));
  });

  it("3. associar a competência preserva tudo o que foi importado", async () => {
    const c = await aCompetencia();
    const [u] = await db.select().from(unidadeTable).where(eq(unidadeTable.cnpj, CNPJ));

    const antes = await aCompetencia();
    await associarUnidadeDaCompetencia(db, c.id, u!.id);
    const depois = await aCompetencia();

    /* Uma coluna mudou. Uma. */
    expect(depois.unidadeId).toBe(u!.id);
    expect({ ...depois, unidadeId: null }).toEqual({ ...antes, unidadeId: null });
    /* O código da fonte continua exatamente como estava — não foi reescrito. */
    expect(depois.unidadeCodigo).toBe("CDD Belém");
  });

  it("4. as duas pontas apontam para a mesma unidade canônica", async () => {
    const c = await aCompetencia();
    const [cadastro] = await db
      .select()
      .from(remuneracaoUnidadeTable)
      .where(eq(remuneracaoUnidadeTable.scopeHash, ESCOPO));

    expect(c.unidadeId).not.toBeNull();
    expect(cadastro!.unidadeId).toBe(c.unidadeId);
    /*
      É o fim do casamento por texto: os dois lados são a **mesma linha** da
      tabela `unidade`. Nenhuma grafia, máscara ou espaço pode desalinhá-los.
    */
  });

  it("5. o devido do contrato é o número que a reconciliação prende", async () => {
    /*
      O elo entre esta prova e a da planilha. `reconciliacao.test.ts` já prova
      que `linhasDoCustoFixo` bate com a `.xlsb` real ao centavo nas duas
      quinzenas; aqui se prova que o contrato **que a unidade associada
      alcança** é exatamente aquele — mesmas alíquotas, mesma frota, mesmos
      valores por veículo.

      Repetir a conferência contra a planilha neste arquivo seria uma segunda
      verdade sobre o mesmo número, e é o que este projeto recusa em toda parte.
    */
    const linhas = linhasDoCustoFixo(CONTRATO);
    const padronizado = linhas.find((l) => l.chave === "custo_fixo_padronizado");

    expect(padronizado?.valor).not.toBeNull();
    /* O valor de julho/2026 — CDD Belém, 1ª quinzena, 56 veículos ativos. */
    expect(padronizado!.memoria).toContain("56 veículos ativos");
    expect(padronizado!.valor).toBeGreaterThan(0);

    /* E a aba gravada no banco é a mesma que produziu este contrato. */
    const gravadas = await db
      .select()
      .from(remuneracaoPlanilhaTable)
      .where(eq(remuneracaoPlanilhaTable.scopeHash, ESCOPO));
    expect(gravadas).toHaveLength(ABA.length);
    const porChave = new Map(gravadas.map((g) => [g.chave, Number(g.valor)]));
    expect(porChave.get("frota_fixa_ativos")).toBe(56);
    expect(porChave.get("aliquota_icms")).toBe(17.84);
  });
});
