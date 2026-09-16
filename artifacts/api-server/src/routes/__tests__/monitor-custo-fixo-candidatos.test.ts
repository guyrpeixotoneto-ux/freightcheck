import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import express from "express";
import { erroEmJson } from "../../middlewares/contrato-json";
import {
  createTestDatabase,
  importFixture,
  modelExportPaths,
  type TestDb,
} from "@workspace/ingest/testing";
import {
  applyConfirmations,
  backfillSemantics,
  runProposalPass,
  seedTaxonomy,
} from "@workspace/curation";
import { createDb, encerrarPoolDoProcesso } from "@workspace/db";
import { listComparableSnapshots } from "@workspace/comparison";

/**
 * `GET /monitor-custo-fixo/candidatos` — o menu da tela que consolida as quatro.
 *
 * Montagem igual à de `finame-candidatos.test.ts`, e as mesmas quatro promessas
 * de qualquer rota de candidatas (número do par, uma unidade só, cobertura
 * recorta, ausência nunca vira zero) valem aqui sem uma linha nova — elas moram
 * em `lib/candidatas-do-par.ts`, que é uma implementação só.
 *
 * O que este arquivo guarda é o que **só o Monitor** tem, e as duas coisas são
 * as que faltavam na tela:
 *
 * 1. **as duas naturezas, separadas.** É o único recorte do produto em que
 *    custo e receita chegam juntos, e o menu tem de dizer de qual lado fala.
 *    Um número só, somando os dois, é o "impacto líquido" que os cartões desta
 *    tela recusam publicar — e o menu não pode ser a porta dos fundos por onde
 *    ele entra;
 * 2. **o filtro vale no menu.** O número ao lado de cada vigência é o que
 *    aquele par mostraria **com os filtros ligados**. Sem isso, o menu
 *    prometeria "289 alterações" ao lado de uma vigência que, escolhida,
 *    mostraria zero — e a tela teria duas réguas para a mesma pergunta.
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

/** As vigências do acervo de teste, da mais recente para a mais antiga. */
async function vigencias() {
  const lista = await listComparableSnapshots(ctx.db);
  return [...lista].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
}

beforeAll(async () => {
  ctx = await createTestDatabase("api_monitor_candidatos");
  process.env.DATABASE_URL = ctx.url;
  nomeDoBanco = ctx.url.replace(/^.*\//, "").replace(/\?.*$/, "");

  const { carreta, cavalo } = modelExportPaths();
  for (const filePath of [carreta, cavalo]) {
    await importFixture(ctx.db, filePath);
  }
  await seedTaxonomy(ctx.db, "test");
  await runProposalPass(ctx.db, "test:proposal");
  await applyConfirmations(ctx.db);
  await backfillSemantics(ctx.db);

  const { default: monitorRouter } = await import("../monitor-custo-fixo");
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    next();
  });
  app.use(monitorRouter);
  app.use(erroEmJson);

  servidor = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const endereco = servidor.address();
  if (typeof endereco === "string" || endereco === null) throw new Error("sem porta");
  base = `http://127.0.0.1:${endereco.port}`;
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

/** A primeira candidata que já veio calculada — a que o menu escreveria. */
function comNumero(body: any) {
  const achada = body.candidatos.find((c: { numeros: unknown }) => c.numeros !== null);
  expect(achada).toBeDefined();
  return achada;
}

describe("GET /monitor-custo-fixo/candidatos", () => {
  it("exige a vigência de destino", async () => {
    const res = await get("/monitor-custo-fixo/candidatos");
    expect(res.status).toBe(400);
  });

  it("só oferece candidatas da mesma unidade e da mesma cobertura", async () => {
    const lista = await vigencias();
    const destino = lista[0];
    const { status, body } = await get(`/monitor-custo-fixo/candidatos?para=${destino.id}`);

    expect(status).toBe(200);
    expect(body.candidatos.length).toBeGreaterThan(0);

    const porId = new Map(lista.map((v) => [v.id, v]));
    for (const candidato of body.candidatos) {
      const v = porId.get(candidato.id);
      expect(v?.scopeHash).toBe(destino.scopeHash);
      expect(v?.entityTypeSet).toBe(destino.entityTypeSet);
      expect(candidato.id).not.toBe(destino.id);
    }
  }, 300_000);

  /**
   * O menu não inventa uma segunda régua — e aqui a prova é campo a campo
   * contra `/consolidado`, que é a resposta que o clique entrega.
   */
  it("o número do menu é o mesmo de /consolidado para aquele par", async () => {
    const lista = await vigencias();
    const destino = lista[0];
    const { body } = await get(`/monitor-custo-fixo/candidatos?para=${destino.id}`);
    const candidata = comNumero(body);

    const { body: tela } = await get(
      `/monitor-custo-fixo/consolidado?base=${candidata.id}&comparada=${destino.id}`,
    );

    expect(candidata.numeros.alteracoes).toBe(tela.resumo.alteracoes);
    expect(candidata.numeros.impacto.baldes).toEqual(
      tela.resumo.baldes.flatMap((b: any) => [
        { periodicidade: b.periodicidade, natureza: "CUSTO", valor: b.custo.liquido },
        { periodicidade: b.periodicidade, natureza: "RECEITA", valor: b.receita.liquido },
      ]),
    );
  }, 300_000);

  /**
   * As duas naturezas viajam separadas, sempre — e é isto que impede a soma.
   *
   * Cada periodicidade produz exatamente duas entradas, uma por lado da DRE.
   * Uma resposta com uma entrada só por periodicidade seria a soma feita no
   * servidor, e o cliente não teria como desfazê-la.
   */
  it("abre cada periodicidade em custo e receita, e nunca num número só", async () => {
    const lista = await vigencias();
    const { body } = await get(`/monitor-custo-fixo/candidatos?para=${lista[0].id}`);

    for (const candidato of body.candidatos) {
      if (candidato.numeros === null) continue;
      const porPeriodicidade = new Map<string, string[]>();
      for (const balde of candidato.numeros.impacto.baldes) {
        porPeriodicidade.set(balde.periodicidade, [
          ...(porPeriodicidade.get(balde.periodicidade) ?? []),
          balde.natureza,
        ]);
      }
      for (const naturezas of porPeriodicidade.values()) {
        expect(naturezas.sort()).toEqual(["CUSTO", "RECEITA"]);
      }
    }
  }, 300_000);

  /**
   * O filtro do endereço recorta o menu — a promessa que distingue esta rota
   * das outras três.
   */
  it("o recorte do endereço vale no menu, e o menu continua batendo com a tela", async () => {
    const lista = await vigencias();
    const destino = lista[0];

    const { body: inteiro } = await get(`/monitor-custo-fixo/candidatos?para=${destino.id}`);
    const { body: soIpva } = await get(
      `/monitor-custo-fixo/candidatos?para=${destino.id}&modulo=IPVA`,
    );

    const candidata = comNumero(inteiro);
    const mesma = soIpva.candidatos.find((c: { id: string }) => c.id === candidata.id);
    expect(mesma?.numeros).not.toBeNull();

    /* Um módulo de quatro nunca responde por mais do que os quatro. */
    expect(mesma.numeros.alteracoes).toBeLessThanOrEqual(candidata.numeros.alteracoes);

    /* E o número filtrado é o que a tela filtrada publica para o mesmo par. */
    const { body: tela } = await get(
      `/monitor-custo-fixo/consolidado?base=${candidata.id}&comparada=${destino.id}&modulo=IPVA`,
    );
    expect(mesma.numeros.alteracoes).toBe(tela.resumo.alteracoes);
  }, 300_000);

  /* Um filtro inválido cai no padrão e é dito por extenso, como em
     `/consolidado`: um menu que recortasse por um valor que não existe
     responderia zero em toda linha, correto e inexplicável. */
  it("um filtro inválido não esvazia o menu, e é declarado", async () => {
    const lista = await vigencias();
    const { status, body } = await get(
      `/monitor-custo-fixo/candidatos?para=${lista[0].id}&modulo=CAFE`,
    );

    expect(status).toBe(200);
    expect(body.ignorados).toEqual(['módulo "CAFE"']);
    expect(body.candidatos.length).toBeGreaterThan(0);
  }, 300_000);

  /** Ausência de cálculo é `null`, nunca um zero inventado. */
  it("ausência de cálculo é null, e nunca um zero inventado", async () => {
    const lista = await vigencias();
    const { body } = await get(`/monitor-custo-fixo/candidatos?para=${lista[0].id}`);

    for (const candidato of body.candidatos) {
      expect(candidato).toHaveProperty("numeros");
      if (candidato.numeros === null) continue;
      expect(typeof candidato.numeros.alteracoes).toBe("number");
      expect(Array.isArray(candidato.numeros.impacto.baldes)).toBe(true);
    }

    const semNumero = body.candidatos.filter(
      (c: { numeros: unknown }) => c.numeros === null,
    ).length;
    expect(body.pendentes).toBe(semNumero);
  }, 300_000);
});
