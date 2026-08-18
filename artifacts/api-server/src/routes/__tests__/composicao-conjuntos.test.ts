import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import express from "express";
import { erroEmJson } from "../../middlewares/contrato-json";
import { captureRaw, preview, promote, receiveFile, stage } from "@workspace/ingest";
import { createTestDatabase, realExportPath, type TestDb } from "@workspace/ingest/testing";
import { applyConfirmations, runProposalPass, seedTaxonomy } from "@workspace/curation";
import { createDb, encerrarPoolDoProcesso } from "@workspace/db";

/**
 * `/composition/conjuntos`, sobre o export real.
 *
 * O cálculo está coberto em `@workspace/composition`. O que se protege aqui é o
 * **contrato da superfície**, e ele tem uma armadilha própria: conjunto não é um
 * `entityType`. A rota da frota valida `entityType` contra `TIPOS_COM_REGRA` e
 * nunca vai aceitar "CONJUNTO" — quem tentar servir a aba por lá recebe 400, e é
 * por isso que a aba tem rota separada. O primeiro caso abaixo fixa as duas
 * pontas dessa decisão.
 *
 * O segundo é o que dá razão à aba existir: a soma dos conjuntos **é** a frota de
 * cavalos mais a de carretas. Se um dia as três respostas divergirem, a mesma
 * tela mostrará dois totais diferentes para a mesma frota, sem dizer qual é o
 * certo.
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

beforeAll(async () => {
  ctx = await createTestDatabase("api_conjuntos");
  process.env.DATABASE_URL = ctx.url;
  nomeDoBanco = ctx.url.replace(/^.*\//, "").replace(/\?.*$/, "");

  const received = await receiveFile(ctx.db, { filePath: realExportPath() });
  await captureRaw(ctx.db, received.importRunId);
  await stage(ctx.db, received.importRunId);
  const report = await preview(ctx.db, received.importRunId);
  await promote(ctx.db, received.importRunId, {
    confirmNewEntityTypes: report.pendingIdentities,
  });
  await seedTaxonomy(ctx.db, "test");
  await runProposalPass(ctx.db, "test:proposal");
  await applyConfirmations(ctx.db);

  const { default: composicaoRouter } = await import("../composition");
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    next();
  });
  app.use(composicaoRouter);
  /*
    O contrato JSON, montado como no `app.ts`. Não é cerimônia de teste: desde
    que a tradução das recusas e o diagnóstico de schema saíram dos `catch` das
    rotas, é ele quem responde 404, 400, 422, 503 e 500 — e um app de teste sem
    ele mede o `finalhandler` do Express, que devolve HTML.
  */
  app.use(erroEmJson);

  servidor = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const endereco = servidor.address();
  if (typeof endereco === "string" || endereco === null) throw new Error("sem porta");
  base = `http://127.0.0.1:${endereco.port}`;
}, 300_000);

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

describe("GET /composition/conjuntos", () => {
  it("serve a aba por rota própria, porque conjunto não é tipo de equipamento", async () => {
    const conjuntos = await get("/composition/conjuntos");
    expect(conjuntos.status).toBe(200);
    expect(conjuntos.body.linhas.length).toBeGreaterThan(0);

    const comoTipo = await get("/composition/fleet?entityType=CONJUNTO");
    expect(comoTipo.status).toBe(400);
    expect(comoTipo.body.error).toContain("CONJUNTO");
  });

  it("forma um conjunto por par e um por carreta órfã, sem repetir ativo", async () => {
    const { body } = await get("/composition/conjuntos");
    expect(body.resumo.conjuntos).toBe(body.resumo.pareados + body.resumo.carretasOrfas);

    const vistos = new Set<string>();
    for (const linha of body.linhas) {
      for (const lado of [linha.cavalo, linha.carreta]) {
        if (!lado) continue;
        expect(vistos.has(lado.entityId)).toBe(false);
        vistos.add(lado.entityId);
      }
    }
  });

  it("apura a mesma frota que as duas abas de equipamento", async () => {
    const [conjuntos, cavalos, carretas] = await Promise.all([
      get("/composition/conjuntos"),
      get("/composition/fleet?entityType=CAVALO"),
      get("/composition/fleet?entityType=CARRETA"),
    ]);
    expect(conjuntos.body.resumo.apuradoTotal).toBeCloseTo(
      cavalos.body.resumo.mensalTotal + carretas.body.resumo.mensalTotal,
      2,
    );
    /* E a vigência é a mesma: as três rotas leem o contexto pelo mesmo caminho. */
    expect(conjuntos.body.effectiveDate).toBe(cavalos.body.effectiveDate);
  });

  it("confere o total declarado contra a soma das duas fichas", async () => {
    const { body } = await get("/composition/conjuntos");
    expect(body.resumo.conferidos).toBe(body.resumo.conjuntos);
    expect(body.toleranciaDaConferencia).toBe(0.01);

    /*
      A rota **serve** a divergência; não é papel dela zerá-la. Desde
      18/08/2026 há conjuntos em que a fonte declara mais do que os dois
      equipamentos recebem — o lucro fixo do cavalo que o `custoFixo` conta
      duas vezes. A contagem exata e a razão estão em
      `lib/composition/__tests__/conjuntos-real.test.ts`; aqui o que se guarda é
      que a rota entrega a conferência inteira, divergentes incluídos.
    */
    expect(body.resumo.divergem).toBeGreaterThan(0);
    expect(body.resumo.fecham + body.resumo.divergem).toBe(body.resumo.conferidos);

    /* O apurado é sempre a soma das duas fichas — inclusive nos que divergem
       do declarado, que é justamente o que a divergência mede. */
    const pareado = body.linhas.find((l: any) => l.natureza === "PAREADO");
    expect(pareado.declaradoCode).toBe("carreta.custo_fixo");
    expect(pareado.cavalo.mensal + pareado.carreta.mensal).toBeCloseTo(pareado.apurado, 2);
  });

  it("recorta a lista pelos filtros sem mexer no resumo da frota", async () => {
    const [tudo, semPar] = await Promise.all([
      get("/composition/conjuntos"),
      get("/composition/conjuntos?semPar=1"),
    ]);
    expect(semPar.body.linhas.length).toBeLessThan(tudo.body.linhas.length);
    expect(semPar.body.totalSemFiltro).toBe(tudo.body.totalSemFiltro);
    expect(semPar.body.resumo.declaradoTotal).toBe(tudo.body.resumo.declaradoTotal);
    expect(
      semPar.body.linhas.every((l: any) => l.natureza !== "PAREADO"),
    ).toBe(true);
  });

  it("responde a vigência pedida, e não sempre a última", async () => {
    const ultima = await get("/composition/conjuntos");
    const anterior = ultima.body.anterior;
    expect(anterior).not.toBeNull();

    const pedida = await get(`/composition/conjuntos?period=${anterior.effectiveDate}`);
    expect(pedida.status).toBe(200);
    expect(pedida.body.effectiveDate).toBe(anterior.effectiveDate);
    expect(pedida.body.periodLabel).toBe(anterior.periodLabel);
  });
});
