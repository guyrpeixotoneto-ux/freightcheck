import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import express from "express";
import { erroEmJson } from "../../middlewares/contrato-json";
import { captureRaw, preview, promote, receiveFile, stage } from "@workspace/ingest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { escreverPlanilha } from "@workspace/ingest/testing/planilha";
import { createDb, encerrarPoolDoProcesso } from "@workspace/db";

/**
 * `GET /monitor-equipe/candidatos` — o que cada candidata a "De" produz.
 *
 * Esta era a única tela de par do produto cujo menu abria **mudo**: sete linhas
 * de `agosto/2026 · 1ª quinzena` e nada à direita de nenhuma — que naquele
 * seletor é a forma de dizer *ainda não calculei*, a quem não tinha o que
 * calcular. A rota existe para a coluna, e o que se protege aqui são as três
 * coisas que a fariam mentir:
 *
 * 1. **a contagem é a do consolidado**, para o mesmo par e o mesmo recorte — o
 *    número do menu é o número que o clique entrega, e não uma segunda régua;
 * 2. **o recorte da tela vale no menu**: com um módulo ligado, a candidata conta
 *    o que aquele módulo moveu, e não o quadro inteiro;
 * 3. **nada de dinheiro, e dito**: `baldes` vazio **com** `semImpacto`, porque
 *    um `R$ 0,00` afirmaria uma conta que esta seção recusa fazer.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;
let nomeDoBanco: string;

interface Resposta {
  status: number;
  body: any;
}

async function get(caminho: string): Promise<Resposta> {
  const res = await fetch(`${base}${caminho}`);
  return { status: res.status, body: await res.json() };
}

const COLUNAS = [
  "Quantidade Ordenados",
  "Salário Ordenados",
  "Despesa Ordenados",
  "QLP Benchmark Quantidade",
];

const cargo = (
  nome: string,
  valores: { qtd: number; salario: number; despesa: number; benchmark: number },
) => ({
  placa: nome,
  valores: {
    "Quantidade Ordenados": valores.qtd,
    "Salário Ordenados": valores.salario,
    "Despesa Ordenados": valores.despesa,
    "QLP Benchmark Quantidade": valores.benchmark,
  },
});

/*
  Duas quinzenas do quadro administrativo, de uma unidade só — o par mais
  simples que ainda move as duas coisas que a tela separa: o **salário** de um
  cargo (o ANALISTA cai de 3 para 2 posições e a despesa acompanha) e o
  **cargo** em si (o AUXILIAR sai do quadro). Um par que movesse um módulo só
  não distinguiria "contou o quadro" de "contou o recorte", que é a promessa 2.
*/
const primeiraQuinzena = () =>
  escreverPlanilha({
    vigencia: "EMPURRADA_1_8_2026",
    abas: [
      {
        nome: "TABELA DE QLP ADM",
        identificador: "Cargo",
        colunas: COLUNAS,
        linhas: [
          cargo("COORDENADOR ADM", { qtd: 1, salario: 9800, despesa: 9800, benchmark: 1 }),
          cargo("ANALISTA ADM", { qtd: 3, salario: 4600, despesa: 13800, benchmark: 2 }),
          cargo("AUXILIAR ADM", { qtd: 4, salario: 2400, despesa: 9600, benchmark: 4 }),
        ],
      },
    ],
  });

const segundaQuinzena = () =>
  escreverPlanilha({
    vigencia: "EMPURRADA_2_8_2026",
    abas: [
      {
        nome: "TABELA DE QLP ADM",
        identificador: "Cargo",
        colunas: COLUNAS,
        linhas: [
          cargo("COORDENADOR ADM", { qtd: 1, salario: 9800, despesa: 9800, benchmark: 1 }),
          cargo("ANALISTA ADM", { qtd: 2, salario: 4600, despesa: 9200, benchmark: 2 }),
        ],
      },
    ],
  });

async function importarQlp(arquivo: string): Promise<void> {
  const recebido = await receiveFile(ctx.db, {
    filePath: arquivo,
    declaredType: "QLP_ADMINISTRATIVO",
  });
  await captureRaw(ctx.db, recebido.importRunId);
  await stage(ctx.db, recebido.importRunId);
  const relatorio = await preview(ctx.db, recebido.importRunId);
  expect(relatorio.blockingErrors).toBe(0);
  await promote(ctx.db, recebido.importRunId);
}

/** O par do quadro administrativo — as duas quinzenas da mesma unidade. */
async function par(): Promise<{ base: any; comparada: any }> {
  const { body } = await get("/snapshots?datasetFamily=QUADRO_DE_PESSOAL");
  const doQuadro = body.filter((v: any) => v.entityTypeSet === "QLP_ADMINISTRATIVO");
  const primeira = doQuadro.find((v: any) => v.effectiveDate === "2026-08-01");
  const segunda = doQuadro.find(
    (v: any) => v.effectiveDate === "2026-08-16" && v.scopeHash === primeira?.scopeHash,
  );
  expect(primeira && segunda).toBeTruthy();
  return { base: primeira, comparada: segunda };
}

beforeAll(async () => {
  ctx = await createTestDatabase("api_monitor_equipe_candidatos");
  process.env.DATABASE_URL = ctx.url;
  nomeDoBanco = ctx.url.replace(/^.*\//, "").replace(/\?.*$/, "");

  const { default: monitorRouter } = await import("../monitor-equipe");
  const { default: changesRouter } = await import("../changes");

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    next();
  });
  app.use(monitorRouter);
  app.use(changesRouter);
  app.use(erroEmJson);

  servidor = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const endereco = servidor.address();
  if (typeof endereco === "string" || endereco === null) throw new Error("sem porta");
  base = `http://127.0.0.1:${endereco.port}`;

  await importarQlp(primeiraQuinzena());
  await importarQlp(segundaQuinzena());
}, 600_000);

afterAll(async () => {
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

describe("GET /monitor-equipe/candidatos", () => {
  it("exige o quadro e a vigência de destino", async () => {
    const { comparada } = await par();
    expect((await get("/monitor-equipe/candidatos")).status).toBe(400);
    expect((await get(`/monitor-equipe/candidatos?para=${comparada.id}`)).status).toBe(400);
    expect(
      (await get("/monitor-equipe/candidatos?quadro=ADMINISTRATIVO")).status,
    ).toBe(400);
  }, 120_000);

  /**
   * A promessa que faz a coluna valer: o menu e a tabela contam a mesma coisa.
   *
   * Vale para o quadro inteiro e vale recortado — e é o recorte que importa:
   * com "salário" ligado, um menu que contasse o quadro inteiro prometeria
   * alterações que o clique não mostraria.
   */
  it("a contagem do menu bate com o consolidado, com e sem filtro", async () => {
    const { base: primeira, comparada } = await par();

    for (const recorte of ["", "&modulo=salario"]) {
      const { status, body } = await get(
        `/monitor-equipe/candidatos?quadro=ADMINISTRATIVO&para=${comparada.id}${recorte}`,
      );
      expect(status, `recorte "${recorte}"`).toBe(200);

      const candidata = body.candidatos.find((c: any) => c.id === primeira.id);
      expect(candidata?.numeros, `recorte "${recorte}"`).not.toBeNull();

      const { body: consolidado } = await get(
        `/monitor-equipe/consolidado?quadro=ADMINISTRATIVO` +
          `&baseAdministrativo=${primeira.id}&comparadaAdministrativo=${comparada.id}${recorte}`,
      );
      const quadro = consolidado.resumo.porQuadro.find(
        (q: any) => q.quadro === "ADMINISTRATIVO",
      );
      expect(candidata.numeros.alteracoes, `recorte "${recorte}"`).toBe(quadro.alteracoes);
    }
  }, 300_000);

  /**
   * O recorte **muda** o número — sem isto, o caso acima passaria com uma rota
   * que ignorasse os filtros e um consolidado que também os ignorasse.
   */
  it("o filtro recorta o menu, e não o deixa igual ao quadro inteiro", async () => {
    const { base: primeira, comparada } = await par();

    const inteiro = await get(
      `/monitor-equipe/candidatos?quadro=ADMINISTRATIVO&para=${comparada.id}`,
    );
    const recortado = await get(
      `/monitor-equipe/candidatos?quadro=ADMINISTRATIVO&para=${comparada.id}&modulo=salario`,
    );

    const de = (r: Resposta) =>
      r.body.candidatos.find((c: any) => c.id === primeira.id)?.numeros?.alteracoes;
    expect(de(inteiro)).toBeGreaterThan(0);
    expect(de(recortado)).toBeGreaterThan(0);
    expect(de(recortado)).toBeLessThan(de(inteiro));
  }, 300_000);

  /**
   * `baldes` vazio **com** a frase do porquê.
   *
   * Sem a frase, o cliente escreveria `R$ 0,00` ao lado de cada vigência — a
   * tela afirmando que nada mudou de dinheiro numa comparação que nunca mediu
   * dinheiro. É a recusa desta seção inteira, e ela não pode entrar pela porta
   * dos fundos do menu.
   */
  it("não publica dinheiro, e diz por quê em vez de escrever zero", async () => {
    const { comparada } = await par();
    const { body } = await get(
      `/monitor-equipe/candidatos?quadro=ADMINISTRATIVO&para=${comparada.id}`,
    );

    const comNumero = body.candidatos.filter((c: any) => c.numeros !== null);
    expect(comNumero.length).toBeGreaterThan(0);
    for (const c of comNumero) {
      expect(c.numeros.impacto.baldes).toEqual([]);
      expect(c.numeros.semImpacto).toContain("sem semântica confirmada");
    }
  }, 120_000);

  /**
   * A lista é a da série do destino, e o próprio destino nunca é candidato a si
   * mesmo. As duas recusas são do motor, antecipadas pela rota.
   */
  it("as candidatas são do mesmo quadro, unidade e cobertura", async () => {
    const { base: primeira, comparada } = await par();
    const { body } = await get(
      `/monitor-equipe/candidatos?quadro=ADMINISTRATIVO&para=${comparada.id}`,
    );

    expect(body.candidatos.some((c: any) => c.id === primeira.id)).toBe(true);
    const { body: todas } = await get("/snapshots?datasetFamily=QUADRO_DE_PESSOAL");
    const porId = new Map(todas.map((v: any) => [v.id, v]));
    for (const c of body.candidatos) {
      const v: any = porId.get(c.id);
      expect(v, `candidata ${c.id} não é do quadro`).toBeDefined();
      expect(v.scopeHash).toBe(comparada.scopeHash);
      expect(v.entityTypeSet).toBe(comparada.entityTypeSet);
      expect(c.id).not.toBe(comparada.id);
    }
  }, 120_000);

  /** Ausência de cálculo é `null`, e `pendentes` conta exatamente essas. */
  it("ausência de cálculo é null, e nunca um zero inventado", async () => {
    const { comparada } = await par();
    const { body } = await get(
      `/monitor-equipe/candidatos?quadro=ADMINISTRATIVO&para=${comparada.id}`,
    );
    const semNumero = body.candidatos.filter((c: any) => c.numeros === null).length;
    expect(body.pendentes).toBe(semNumero);
  }, 120_000);
});
