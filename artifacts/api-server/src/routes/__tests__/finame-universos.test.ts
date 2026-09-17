import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import express from "express";
import { erroEmJson } from "../../middlewares/contrato-json";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { createDb, encerrarPoolDoProcesso } from "@workspace/db";
import { buildFixture, type AttributeSpec } from "@workspace/comparison/testing";
import {
  registrarFonteDoRealizado,
  SEM_FONTE_DO_REALIZADO,
  type FonteDoRealizado,
} from "@workspace/comparison";

/**
 * OS TRÊS UNIVERSOS NA API — a rota que os separa, com fonte do realizado de pé.
 *
 * ---------------------------------------------------------------------------
 * Por que um arquivo novo, e não mais um `it` em `finame-confronto.test.ts`
 * ---------------------------------------------------------------------------
 * Porque aquele arquivo prova a consolidação mensal **sem** fonte do realizado —
 * é o que o título dele diz e o que as 18 asserções dele fazem. Este precisa do
 * oposto: uma fonte registrada, uma placa de cada universo e o atributo de
 * situação do financiamento no acervo, que aquele fixture não tem. Enfiar as
 * duas montagens no mesmo `beforeAll` faria cada arquivo carregar o preparo do
 * outro, e o de lá é o mais caro dos dois.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo prova, e o que ele não prova
 * ---------------------------------------------------------------------------
 * Prova que **a rota separa os universos** — que `universos.conciliados` não
 * contém o dinheiro de `universos.semRealizado`, que a cobertura sai com o
 * denominador dos remunerados, e que os alertas chegam com a evidência. A
 * aritmética já está provada em
 * `lib/comparison/src/__tests__/universos-do-confronto.test.ts`, e repeti-la
 * aqui pagaria um banco para reconferir uma função pura.
 *
 * O cenário é setembro/2026 em miniatura, com os números da planilha real — os
 * mesmos de `docs/DEFINICOES-DO-CONFRONTO-DE-FINAME.md`.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;
let nomeDoBanco: string;

/**
 * Os cinco atributos que o confronto lê de um cavalo.
 *
 * A parcela é o que soma; amortização, juros e lucro fixo são a identidade que
 * o alerta de composição verifica; a situação é o que parte o universo 2 entre
 * o coerente e o achado. Sem o último, todo veículo sem realizado sairia
 * `INDEFINIDO` — que é a verdade e não é o que produção tem.
 */
const ATRIBUTOS: AttributeSpec[] = [
  {
    code: "cavalo.finame_cavalo",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
  },
  {
    code: "cavalo.amortizacao_cavalo",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
  },
  {
    code: "cavalo.juros_finame_cavalo",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
  },
  {
    code: "cavalo.lucro_fixomodelo_novo_ciclo_cavalo",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
  },
  {
    code: "cavalo.status_financiamento_t1_shared",
    dataType: "TEXT",
    semanticsStatus: "CONFIRMED",
  },
];

const SETEMBRO = "2026-09-01";
const UNIDADE = "scope-universos-camacari";

/**
 * As seis placas, uma por caso — com os números de setembro/2026.
 *
 * - `RPG0C44` concilia em déficit: financiada, remunerada e lançada no razão;
 * - `RZG5A37` concilia em sobra — **sem** cópia retida, porque este acervo não
 *   tem extrato importado; é o que prende o alerta de duplicata à evidência em
 *   vez de ao resultado;
 * - `QYP0I48` concilia, é **quitada**, e o razão lança mesmo assim — com a
 *   identidade da parcela furada em R$ 779,67;
 * - `RPG1I89` e `RPG2I13` são remuneradas, financiadas e **sem** lançamento —
 *   o achado executivo;
 * - `QYP3G72` é remunerada, quitada e sem lançamento — o caso coerente, que não
 *   pode aparecer no destaque.
 */
const REMUNERADO = {
  RPG0C44: {
    "cavalo.finame_cavalo": 16769.83,
    "cavalo.amortizacao_cavalo": 10000,
    "cavalo.juros_finame_cavalo": 6769.83,
    "cavalo.lucro_fixomodelo_novo_ciclo_cavalo": 0,
    "cavalo.status_financiamento_t1_shared": "Descrição: FINANCIADO",
  },
  RZG5A37: {
    "cavalo.finame_cavalo": 13873.44,
    "cavalo.amortizacao_cavalo": 7515.85,
    "cavalo.juros_finame_cavalo": 6357.59,
    "cavalo.lucro_fixomodelo_novo_ciclo_cavalo": 0,
    "cavalo.status_financiamento_t1_shared": "Descrição: FINANCIADO",
  },
  QYP0I48: {
    "cavalo.finame_cavalo": 4103.53,
    "cavalo.amortizacao_cavalo": 0,
    "cavalo.juros_finame_cavalo": 0,
    "cavalo.lucro_fixomodelo_novo_ciclo_cavalo": 3323.86,
    "cavalo.status_financiamento_t1_shared": "Descrição: QUITADO",
  },
  RPG1I89: {
    "cavalo.finame_cavalo": 17227.35,
    "cavalo.amortizacao_cavalo": 11000,
    "cavalo.juros_finame_cavalo": 6227.35,
    "cavalo.lucro_fixomodelo_novo_ciclo_cavalo": 0,
    "cavalo.status_financiamento_t1_shared": "Descrição: FINANCIADO",
  },
  RPG2I13: {
    "cavalo.finame_cavalo": 17227.35,
    "cavalo.amortizacao_cavalo": 11000,
    "cavalo.juros_finame_cavalo": 6227.35,
    "cavalo.lucro_fixomodelo_novo_ciclo_cavalo": 0,
    "cavalo.status_financiamento_t1_shared": "Descrição: FINAME",
  },
  QYP3G72: {
    "cavalo.finame_cavalo": 4677.85,
    "cavalo.amortizacao_cavalo": 0,
    "cavalo.juros_finame_cavalo": 0,
    "cavalo.lucro_fixomodelo_novo_ciclo_cavalo": 4677.85,
    "cavalo.status_financiamento_t1_shared": "Descrição: QUITADO",
  },
};

/** Os três lançamentos do razão — os únicos três que conciliam. */
const REALIZADO: Record<string, number> = {
  RPG0C44: 25085.47,
  RZG5A37: 4147.88,
  QYP0I48: 9958.86,
};

/**
 * Uma fonte do realizado de mentira, com os valores acima.
 *
 * De mentira **na origem**, e não no contrato: ela implementa `FonteDoRealizado`
 * inteiro, de modo que a rota não sabe que está falando com um teste. É a
 * promessa que `realizado-de-finame.ts` fez — trocar a fonte sem tocar em mais
 * nada — cobrada aqui.
 */
const FONTE_DE_TESTE: FonteDoRealizado = {
  nome: "teste-universos",
  convencaoDeSinal: "CUSTO_NEGATIVO",
  async competenciasDisponiveis() {
    return { competencias: ["2026-09"] };
  },
  async valoresDaCompetencia(_escopo, competencia) {
    if (competencia !== "2026-09") {
      return {
        indisponivel: {
          motivo: "SEM_COMPETENCIA",
          frase: `Sem extrato para ${competencia}.`,
        },
      };
    }
    return {
      valores: Object.entries(REALIZADO).map(([placa, valor]) => ({
        competencia,
        entityLabel: placa,
        entityType: "CAVALO",
        valor,
        bruto: -valor,
      })),
    };
  },
};

async function get(caminho: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${caminho}`);
  return { status: res.status, body: await res.json() };
}

/* Sem `?fonte`: esta rota **é** a da fonte Real, e o silêncio quer dizer "a
   fonte desta rota" — ver `fonteDaConsulta`, em `routes/finame.ts`. */
const confronto = () => get(`/finame/confronto?competencia=2026-09&scopeHash=${UNIDADE}`);

beforeAll(async () => {
  ctx = await createTestDatabase("api_finame_universos");
  process.env.DATABASE_URL = ctx.url;
  nomeDoBanco = ctx.url.replace(/^.*\//, "").replace(/\?.*$/, "");
  await seedTaxonomy(ctx.db, "test");

  await buildFixture(
    ctx.db,
    ATRIBUTOS,
    [{ label: "EMPURRADA_1_9_2026", effectiveDate: SETEMBRO, data: REMUNERADO }],
    { entityType: "CAVALO", scopeHash: UNIDADE, canal: "EMPURRADA" },
  );

  registrarFonteDoRealizado(FONTE_DE_TESTE);

  const { default: finameRouter } = await import("../finame");
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    next();
  });
  app.use(finameRouter);
  app.use(erroEmJson);

  servidor = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const endereco = servidor.address();
  if (typeof endereco === "string" || endereco === null) throw new Error("sem porta");
  base = `http://127.0.0.1:${endereco.port}`;
}, 600_000);

afterAll(async () => {
  /* A fonte volta ao que era: o registro é do processo, e um arquivo que o
     deixasse sujo contaminaria quem rodasse depois dele. */
  registrarFonteDoRealizado(SEM_FONTE_DO_REALIZADO);

  if (servidor) {
    servidor.closeAllConnections();
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  }
  await ctx?.pool.end().catch(() => {});
  await encerrarPoolDoProcesso().catch(() => {});

  const admin = createDb(
    process.env.TEST_ADMIN_DATABASE_URL ??
      "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433",
  );
  await admin.pool.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [nomeDoBanco],
  );
  await admin.pool.query(`DROP DATABASE IF EXISTS "${nomeDoBanco}" WITH (FORCE)`);
  await admin.pool.end();
}, 60_000);

describe("a rota publica os três universos separados", () => {
  it("o universo 1 traz os totais e a cobertura com o denominador dos remunerados", async () => {
    const { status, body } = await confronto();
    expect(status).toBe(200);

    const { conciliados } = body.universos;
    expect(conciliados.veiculos).toBe(3);
    expect(conciliados.de).toBe(6);
    expect(conciliados.remunerado).toBe(34746.8);
    expect(conciliados.realizado).toBe(39192.21);
    expect(conciliados.saldo).toBe(-4445.41);
    /* A identidade fecha na resposta, e não só no módulo. */
    expect(conciliados.saldo).toBe(
      Number((conciliados.remunerado - conciliados.realizado).toFixed(2)),
    );
  });

  it("o universo 2 sai à parte, com o financiado separado do quitado", async () => {
    const { body } = await confronto();
    const { semRealizado } = body.universos;

    expect(semRealizado.veiculos).toBe(3);
    expect(semRealizado.remunerado).toBe(39132.55);
    /* RPG1I89 e RPG2I13 — "FINANCIADO" e "FINAME" são a mesma coisa. */
    expect(semRealizado.financiados).toBe(2);
    expect(semRealizado.remuneradoFinanciado).toBe(34454.7);
    /* QYP3G72, quitada e sem lançamento: coerente, e fora do destaque. */
    expect(semRealizado.quitados).toBe(1);
    expect(semRealizado.indefinidos).toBe(0);
  });

  it("nenhum número do universo 2 está dentro do universo 1", async () => {
    const { body } = await confronto();
    const { conciliados, semRealizado } = body.universos;
    /*
      A asserção que define a tela inteira: o saldo não conhece os R$ 39.132,55
      de remuneração sem contrapartida, e não pode passar a conhecê-los.
    */
    expect(conciliados.remunerado).toBeLessThan(
      conciliados.remunerado + semRealizado.remunerado,
    );
    expect(conciliados.saldo).not.toBe(
      Number((conciliados.remunerado + semRealizado.remunerado - conciliados.realizado).toFixed(2)),
    );
  });

  it("o universo 3 distingue a competência analisada da fila do extrato", async () => {
    const { body } = await confronto();
    const { pendenteDeClassificacao } = body.universos;
    /* Este acervo não tem extrato importado: as duas filas são zero, e as duas
       existem — a tela precisa poder dizer "nenhuma" em vez de sumir com o
       bloco. O que importa aqui é que os dois recortes sejam campos distintos. */
    expect(pendenteDeClassificacao.naCompetencia).toEqual({ placas: 0, valor: 0 });
    expect(pendenteDeClassificacao.noExtrato).toEqual({ placas: 0, valor: 0 });
    expect(Object.keys(pendenteDeClassificacao).sort()).toEqual([
      "naCompetencia",
      "noExtrato",
    ]);
  });

  it("não publica nenhum total que misture os universos", async () => {
    const { body } = await confronto();
    const serializado = JSON.stringify(body);
    /* O campo que a tela mostrava como resultado do mês não existe mais em
       lugar nenhum da resposta. */
    expect(serializado).not.toContain("resultadoLiquido");
    expect(body.confronto.resumo).toHaveProperty("saldoDosConciliados");
    expect(body.confronto.resumo).toHaveProperty("veiculosRemunerados");
  });
});

describe("a rota publica os alertas com a evidência", () => {
  it("acusa a quitada que o razão continua lançando, com a composição furada", async () => {
    const { body } = await confronto();
    const alerta = body.alertas.find((a: any) => a.entityLabel === "QYP0I48");

    expect(alerta.tipo).toBe("QUITADO_COM_REALIZADO_RECORRENTE");
    expect(alerta.titulo).toContain("composição remunerada inconsistente");
    const diferenca = alerta.evidencia.find(
      (e: any) => e.rotulo === "Diferença não explicada",
    );
    /* 4.103,53 − (0 + 0 + 3.323,86) = 779,67 — o buraco da planilha real. */
    expect(diferenca.valor).toContain("779,67");
  });

  it("só acusa o que satisfaz a regra — as financiadas com lançamento ficam fora", async () => {
    const { body } = await confronto();
    const placas = body.alertas.map((a: any) => a.entityLabel);
    expect(placas).toContain("QYP0I48");
    expect(placas).not.toContain("RPG0C44");
    expect(placas).not.toContain("QYP3G72");
  });

  it("sem fila de duplicata no acervo, não inventa o alerta de sobra", async () => {
    const { body } = await confronto();
    /* RZG5A37 é sobra, mas este acervo não tem extrato importado — logo não há
       cópia retida, e o alerta que depende dela não pode existir. Um alerta que
       aparecesse aqui estaria sendo montado a partir do resultado, e não da
       evidência. */
    const sobra = body.confronto.linhas.find((l: any) => l.entityLabel === "RZG5A37");
    expect(sobra.resultado).toBe("SOBRA");
    expect(body.alertas.some((a: any) => a.tipo === "SOBRA_COM_DUPLICATA_RETIDA")).toBe(false);
  });
});

describe("a linha carrega a situação do financiamento", () => {
  it("para a tela poder listar os financiados sem lançamento real", async () => {
    const { body } = await confronto();
    const financiadosSemReal = body.confronto.linhas
      .filter(
        (l: any) => l.cobertura === "SEM_REALIZADO" && l.situacaoDoFinanciamento === "FINANCIADO",
      )
      .map((l: any) => l.entityLabel)
      .sort();

    expect(financiadosSemReal).toEqual(["RPG1I89", "RPG2I13"]);
  });

  it("cita o texto da base em vez de parafraseá-lo", async () => {
    const { body } = await confronto();
    const linha = body.confronto.linhas.find((l: any) => l.entityLabel === "RPG2I13");
    expect(linha.statusDeclarado).toBe("Descrição: FINAME");
    expect(linha.situacaoDoFinanciamento).toBe("FINANCIADO");
  });
});
