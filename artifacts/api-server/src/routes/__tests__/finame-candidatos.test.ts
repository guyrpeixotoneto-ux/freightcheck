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
 * `GET /finame/candidatos` — o que cada candidata a "De" produz contra o "Para".
 *
 * Montagem igual à de `impacto.test.ts`: o router sobe num socket de verdade,
 * sobre o export real, e usa o `db` do processo — que é como ele roda.
 *
 * O que se protege aqui são as quatro promessas que a tela faz ao mostrar
 * número ao lado de vigência:
 *
 * 1. **o número é do par**, então trocar o "Para" troca o número;
 * 2. **a lista é de uma unidade só**, decidido no servidor e não na tela;
 * 3. **cobertura também recorta** — cavalo não vira candidato de carreta;
 * 4. **ausência nunca vira zero**: o que não foi calculado volta `null`.
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
  ctx = await createTestDatabase("api_finame_candidatos");
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

describe("GET /finame/candidatos", () => {
  it("exige a vigência de destino", async () => {
    const res = await get("/finame/candidatos");
    expect(res.status).toBe(400);
  });

  /**
   * O requisito 2 e o 3 na mesma asserção, porque são a mesma régua: a lista de
   * candidatas é a série do destino — mesma unidade, mesma cobertura.
   */
  it("só oferece candidatas da mesma unidade e da mesma cobertura", async () => {
    const lista = await vigencias();
    const destino = lista[0];
    const { status, body } = await get(`/finame/candidatos?para=${destino.id}`);

    expect(status).toBe(200);
    expect(body.candidatos.length).toBeGreaterThan(0);

    const porId = new Map(lista.map((v) => [v.id, v]));
    for (const candidato of body.candidatos) {
      const v = porId.get(candidato.id);
      expect(v?.scopeHash).toBe(destino.scopeHash);
      expect(v?.entityTypeSet).toBe(destino.entityTypeSet);
      expect(candidato.id).not.toBe(destino.id);
    }
  });

  /** O requisito 1: o número é do par, e não da vigência. */
  it("responde números diferentes quando o Para muda", async () => {
    const lista = await vigencias();
    const destino = lista[0];
    const outroDestino = lista.find(
      (v) =>
        v.id !== destino.id &&
        v.scopeHash === destino.scopeHash &&
        v.entityTypeSet === destino.entityTypeSet,
    );
    expect(outroDestino).toBeDefined();

    const primeira = await get(`/finame/candidatos?para=${destino.id}`);
    const segunda = await get(`/finame/candidatos?para=${outroDestino!.id}`);

    /* A candidata comum aos dois pedidos: a que não é nenhum dos dois destinos. */
    const comum = primeira.body.candidatos
      .map((c: { id: string }) => c.id)
      .find(
        (id: string) =>
          id !== outroDestino!.id &&
          segunda.body.candidatos.some((c: { id: string }) => c.id === id),
      );
    expect(comum).toBeDefined();

    const numerosA = primeira.body.candidatos.find(
      (c: { id: string }) => c.id === comum,
    ).numeros;
    const numerosB = segunda.body.candidatos.find(
      (c: { id: string }) => c.id === comum,
    ).numeros;

    /*
      Os dois pares existem e são pares diferentes: mesma ponta esquerda,
      pontas direitas distintas. O que se exige é que a resposta **dependa do
      par** — se os dois viessem iguais, o número estaria sendo tirado da
      vigência sozinha, que é exatamente o defeito que esta rota evita.
    */
    expect(numerosA).not.toBeNull();
    expect(numerosB).not.toBeNull();
    expect(numerosA).not.toEqual(numerosB);
  }, 120_000);

  /**
   * O requisito 4, e o que ele **não** permite: a ausência de cálculo volta
   * `null`, nunca um zero. Um `alteracoes: 0` só pode existir ao lado de uma
   * comparação que de fato aconteceu.
   */
  it("ausência de cálculo é null, e nunca um zero inventado", async () => {
    const lista = await vigencias();
    const { body } = await get(`/finame/candidatos?para=${lista[0].id}`);

    for (const candidato of body.candidatos) {
      expect(candidato).toHaveProperty("numeros");
      if (candidato.numeros === null) continue;
      expect(typeof candidato.numeros.alteracoes).toBe("number");
      expect(candidato.numeros.impacto).toHaveProperty("porPeriodicidade");
    }

    /* `pendentes` conta exatamente as que voltaram sem número — o cliente lê
       esse número para decidir se pergunta de novo. */
    const semNumero = body.candidatos.filter(
      (c: { numeros: unknown }) => c.numeros === null,
    ).length;
    expect(body.pendentes).toBe(semNumero);
  }, 120_000);

  /**
   * O isolamento por operação, que vale para toda rota desta superfície.
   *
   * 404 e não 403, como em `/change-sets/pair` e em `/composition/equipment`:
   * é o status que `recusa-de-dominio.ts` dá a `RecursoDeOutraOperacaoError`
   * no produto inteiro. A Auditoria Rota não fica sabendo que a vigência de
   * empurrada existe.
   */
  it("recusa a vigência de outra operação", async () => {
    const lista = await vigencias();
    const res = await get(`/finame/candidatos?para=${lista[0].id}&operacao=ROTA`);
    expect(res.status).toBe(404);
  });
});
