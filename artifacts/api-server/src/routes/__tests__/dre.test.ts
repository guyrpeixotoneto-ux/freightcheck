import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import express from "express";
import { captureRaw, preview, promote, receiveFile, stage } from "@workspace/ingest";
import { createTestDatabase, realExportPath, type TestDb } from "@workspace/ingest/testing";
import { applyConfirmations, runProposalPass, seedTaxonomy } from "@workspace/curation";
import { createDb } from "@workspace/db";

/**
 * As rotas da DRE, sobre o export real.
 *
 * O router sobe num socket de verdade e é consultado por `fetch`, em vez de por
 * um cliente de teste. Não é purismo: o workspace não tem supertest, e um
 * pacote novo entra por uma janela de segurança de 24 horas
 * (`minimumReleaseAge` em `pnpm-workspace.yaml`) que não vale a pena abrir por
 * um atalho de sintaxe. `listen(0)` pega uma porta livre e o `afterAll` a
 * devolve.
 *
 * O que estes testes protegem não é o cálculo — isso é de `@workspace/dre` e
 * está coberto lá. É o **contrato da superfície**: que a tela receba a mesma
 * apuração que o pacote produz, que um escopo inválido pare em 400 em vez de
 * devolver a DRE de outra coisa, e que o aviso de circularidade acompanhe toda
 * resposta que carregue números.
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
  ctx = await createTestDatabase("api_dre");
  process.env.DATABASE_URL = ctx.url;
  /* `new URL` recusa esta string: o host vive na query (`?host=/tmp/pgsock`) e
     a autoridade fica vazia. O nome do banco é o trecho entre `/` e `?`. */
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

  /* Só o router da DRE, sem sessão: o portão é testado em `auth.test.ts`. */
  const { default: dreRouter } = await import("../dre");
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    next();
  });
  app.use(dreRouter);

  servidor = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const endereco = servidor.address();
  if (typeof endereco === "string" || endereco === null) throw new Error("sem porta");
  base = `http://127.0.0.1:${endereco.port}`;
}, 300_000);

afterAll(async () => {
  /*
    `closeAllConnections` antes do `close`. O `fetch` do Node mantém a conexão
    viva por padrão, e `close()` sozinho espera por ela até o timeout do hook —
    os nove testes passam e a suíte falha no desligamento.
  */
  if (servidor) {
    servidor.closeAllConnections();
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  }
  /*
    As rotas usam o `db` do processo, e não o do `TestDb` — é assim que elas
    rodam em produção, e testá-las de outro jeito testaria outra coisa. O preço
    é este encerramento: o pool do processo não é alcançável daqui (o `db`
    exportado é um Proxy sem `end` utilizável), e sem fechá-lo o `DROP DATABASE`
    esbarra em "is being accessed by other users" com os testes todos verdes.
    Derrubar as conexões pelo próprio Postgres resolve sem exportar nada novo.
  */
  await ctx?.pool.end().catch(() => {});

  const admin = createDb(
    process.env.TEST_ADMIN_DATABASE_URL ??
      "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433",
  );
  await admin.pool.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [nomeDoBanco],
  );
  /* WITH (FORCE) porque terminar as conexões e derrubar o banco não são
     atômicos: entre uma coisa e outra o Postgres ainda enxerga a sessão que
     acabou de morrer, e o DROP simples falha com os testes todos verdes. */
  await admin.pool.query(`DROP DATABASE IF EXISTS "${nomeDoBanco}" WITH (FORCE)`);
  await admin.pool.end();
}, 60_000);

describe("GET /dre/plano", () => {
  it("serve o plano com escopos, critérios e o aviso", async () => {
    const res = await get("/dre/plano");
    expect(res.status).toBe(200);
    expect(res.body.componentes.length).toBeGreaterThan(10);
    expect(res.body.escopos).toEqual(["CAVALO", "CARRETA", "CONJUNTO"]);
    expect(res.body.aviso).toMatch(/tarifa/i);

    /* Todo componente sem fonte diz o que falta — o contrato de §4. */
    for (const c of res.body.componentes) {
      if (c.fontes.length === 0) expect(c.ausencia?.oQueFalta?.length).toBeGreaterThan(20);
    }
  });
});

describe("GET /dre/fleet", () => {
  it("devolve o consolidado, o ranking e a lista de atenção", async () => {
    const res = await get("/dre/fleet?escopo=CONJUNTO");
    expect(res.status).toBe(200);

    expect(res.body.consolidado.unidades).toBe(71);
    expect(res.body.consolidado.ativos).toBe(133);
    expect(res.body.ranking.length).toBe(71);
    expect(res.body.aviso).toMatch(/tarifa/i);

    const receita = res.body.consolidado.subtotais.find(
      (s: { id: string }) => s.id === "RECEITA_BRUTA",
    );
    expect(Number(receita.valorParcial)).toBeCloseTo(1_204_664.11, 2);
  }, 120_000);

  it("recusa um escopo que a DRE não sabe apurar, listando os que existem", async () => {
    const res = await get("/dre/fleet?escopo=FROTA");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("CONJUNTO");
  });

  it("filtra sem alterar o consolidado — o total descreve a frota, não o recorte", async () => {
    const todos = await get("/dre/fleet?escopo=CAVALO");
    expect(todos.status).toBe(200);
    const filtrado = await get("/dre/fleet?escopo=CAVALO&soNegativos=1");
    expect(filtrado.status).toBe(200);

    expect(filtrado.body.ranking.length).toBeLessThanOrEqual(todos.body.ranking.length);
    expect(filtrado.body.totalSemFiltro).toBe(todos.body.totalSemFiltro);
    expect(filtrado.body.consolidado.subtotais).toEqual(todos.body.consolidado.subtotais);
  }, 120_000);
});

describe("GET /dre/unit/:id", () => {
  it("dá a mesma apuração que a linha do ranking, com origem até a célula", async () => {
    const frota = await get("/dre/fleet?escopo=CONJUNTO");
    expect(frota.status).toBe(200);
    const alvo = frota.body.ranking.find(
      (l: { receita: number | null }) => l.receita !== null,
    );

    const res = await get(`/dre/unit/${alvo.entityIds[0]}?escopo=CONJUNTO`);
    expect(res.status).toBe(200);

    const receita = res.body.atual.subtotais.find(
      (s: { id: string }) => s.id === "RECEITA_BRUTA",
    );
    expect(Number(receita.valorParcial)).toBeCloseTo(alvo.receita, 2);

    const comValor = res.body.atual.secoes
      .flatMap((s: { linhas: unknown[] }) => s.linhas)
      .filter((l: { valor: number | null }) => l.valor !== null);
    expect(comValor.length).toBeGreaterThan(0);
    for (const linha of comValor) {
      for (const origem of linha.origens) {
        expect(origem.celula?.sourceLabel).toBeTruthy();
        expect(origem.semanticsStatus).toBe("CONFIRMED");
      }
    }
  }, 120_000);

  it("recusa um identificador que não é UUID", async () => {
    expect((await get("/dre/unit/nao-e-uuid")).status).toBe(400);
  });

  it("responde 404 quando o equipamento não forma unidade neste escopo", async () => {
    expect((await get("/dre/unit/00000000-0000-4000-8000-000000000000?escopo=CONJUNTO")).status).toBe(404);
  }, 60_000);
});

describe("GET /dre/unit/:id/bridge", () => {
  it("liga alteração a linha da DRE e traz a explicação derivada", async () => {
    const frota = await get("/dre/fleet?escopo=CONJUNTO");
    expect(frota.status).toBe(200);
    const alvo = frota.body.ranking.find(
      (l: { receita: number | null }) => l.receita !== null,
    );

    const res = await get(`/dre/unit/${alvo.entityIds[0]}/bridge?escopo=CONJUNTO`);
    expect(res.status).toBe(200);

    expect(res.body.para.effectiveDate).toBe("2026-08-01");
    for (const a of res.body.queMexeramNaDRE) {
      expect(a.linhaDaDRE).not.toBeNull();
      expect(a.impactoConfianca).toBe("CALCULATED");
    }
    /* A decomposição fecha, ou diz o que não atribuiu. */
    if (res.body.saldo !== null && res.body.naoAtribuido !== null) {
      expect(res.body.saldo + res.body.naoAtribuido).toBeCloseTo(
        res.body.variacaoDoResultado,
        2,
      );
    }
  }, 180_000);
});

describe("GET /dre/history", () => {
  it("cobre as nove vigências da série", async () => {
    const res = await get("/dre/history?escopo=CONJUNTO");
    expect(res.status).toBe(200);
    expect(res.body.pontos).toHaveLength(9);
    expect(res.body.pontos.every((p: { presente: boolean }) => p.presente)).toBe(true);
  }, 180_000);
});
