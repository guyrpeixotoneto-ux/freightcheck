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
 * `GET /alteracoes-por-modulo/candidatos` — o menu do seletor mestre.
 *
 * É a única rota de candidatas do produto cujo `para` **não é um id de
 * vigência**: o seletor mestre oferece datas, porque as quatro coberturas do
 * catálogo têm ids diferentes para a mesma quinzena. Daí que as garantias
 * comuns de `lib/candidatas-do-par.ts` — recorte por unidade e cobertura,
 * ausência que nunca vira zero — não venham de graça aqui: esta rota monta a
 * lista por conta própria, com `paresDoMestre`, e é isso que estes casos
 * guardam.
 *
 * O caso que manda é o segundo. O contrato deste menu é que o número ao lado de
 * uma data seja o número que o clique naquela data entrega — e "o clique" é
 * literalmente `/consolidado` com os pares que a tela escreve no endereço. Se
 * um dia as duas contas divergirem, é aqui que se vê.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;
let nomeDoBanco: string;

async function get(caminho: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${caminho}`);
  return { status: res.status, body: await res.json() };
}

/** As vigências do acervo de teste, da mais recente para a mais antiga. */
async function vigencias() {
  const lista = await listComparableSnapshots(ctx.db);
  return [...lista].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
}

beforeAll(async () => {
  ctx = await createTestDatabase("api_catalogo_candidatos");
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

  const { default: catalogoRouter } = await import("../alteracoes-por-modulo");
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    next();
  });
  app.use(catalogoRouter);
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

describe("GET /alteracoes-por-modulo/candidatos", () => {
  it("exige a data de destino", async () => {
    const res = await get("/alteracoes-por-modulo/candidatos");
    expect(res.status).toBe(400);
  });

  /**
   * As candidatas são datas do acervo, nunca um calendário — e nunca o próprio
   * destino.
   *
   * É a mesma recusa que o seletor de par documenta: um menu que oferecesse a
   * quinzena que ninguém importou faria a recusa do motor chegar depois do
   * clique.
   */
  it("oferece datas do acervo, sem repetir o destino", async () => {
    const lista = await vigencias();
    const destino = lista[0];
    const datas = new Set(lista.map((v) => v.effectiveDate));

    const { status, body } = await get(
      `/alteracoes-por-modulo/candidatos?para=${destino.effectiveDate}` +
        `&scopeHash=${destino.scopeHash}`,
    );

    expect(status).toBe(200);
    expect(body.candidatos.length).toBeGreaterThan(0);
    for (const candidato of body.candidatos) {
      expect(datas.has(candidato.id)).toBe(true);
      expect(candidato.id).not.toBe(destino.effectiveDate);
    }
  }, 300_000);

  /**
   * O contrato inteiro deste menu, provado contra a resposta que o clique
   * entrega — e não contra uma segunda conta escrita no teste.
   *
   * `/consolidado` é a tela: os mesmos pares, as mesmas funções, os mesmos
   * cartões. A contagem do menu é a soma das áreas, e cada balde do menu é o
   * balde daquela área — nunca um total entre elas, que é o que
   * `alteracoes-por-modulo.ts` recusa por escrito.
   */
  it("o número do menu é o que /consolidado entrega para aquele par", async () => {
    const lista = await vigencias();
    const destino = lista[0];
    const { body } = await get(
      `/alteracoes-por-modulo/candidatos?para=${destino.effectiveDate}` +
        `&scopeHash=${destino.scopeHash}`,
    );
    const candidata = comNumero(body);

    /* O par que a tela escreveria no endereço ao clicar nesta linha. */
    const daData = lista.find((v) => v.effectiveDate === candidata.id);
    expect(daData).toBeDefined();
    const { body: tela } = await get(
      `/alteracoes-por-modulo/consolidado?baseEquipamento=${daData!.id}` +
        `&comparadaEquipamento=${destino.id}`,
    );

    const alteracoesDaTela = tela.areas.reduce(
      (soma: number, area: any) => soma + area.alteracoes,
      0,
    );
    expect(candidata.numeros.alteracoes).toBe(alteracoesDaTela);

    const baldesDaTela = tela.areas.flatMap((area: any) =>
      Object.entries(area.porPeriodicidade).map(([periodicidade, valor]) => ({
        periodicidade,
        valor,
      })),
    );
    /* Sem rótulo: neste acervo só uma área publica dinheiro, e a régua que não
       precisa ser distinguida não é escrita — ver `semRotuloRedundante`. */
    expect(candidata.numeros.impacto.baldes).toEqual(baldesDaTela);
  }, 300_000);

  /**
   * A unidade vem do endereço, e não do destino — a diferença que ser por data
   * cria.
   *
   * Nas dezesseis rotas por id, a unidade é a do próprio `para`
   * (`formamParDeVigencias` exige mesma unidade). Uma data não carrega unidade
   * nenhuma: sem `scopeHash`, a lista sai do acervo inteiro da operação.
   */
  it("recorta a frota pela unidade pedida", async () => {
    const lista = await vigencias();
    const destino = lista[0];
    const { body } = await get(
      `/alteracoes-por-modulo/candidatos?para=${destino.effectiveDate}` +
        `&scopeHash=nao-existe-esta-unidade`,
    );

    expect(body.candidatos).toEqual([]);
    expect(body.pendentes).toBe(0);
  }, 300_000);
});
