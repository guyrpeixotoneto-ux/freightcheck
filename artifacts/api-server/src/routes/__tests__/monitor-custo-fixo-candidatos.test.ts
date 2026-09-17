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
import { createDb, encerrarPoolDoProcesso, pool } from "@workspace/db";
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
 * 1. **o menu é o consolidado, campo a campo.** O Monitor lê cinco módulos de
 *    uma vez, e o menu tem de publicar o mesmo líquido por periodicidade que a
 *    tela publica depois do clique — nunca uma segunda conta. Houve aqui uma
 *    separação por natureza, custo de um lado e receita do outro, e ela saiu
 *    junto com a natureza: os cinco falam o idioma de quem recebe, positivo é
 *    ganho e negativo é perda. O que **não** pode acontecer é uma
 *    periodicidade somar com outra, e é isso que o segundo caso guarda;
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
      tela.resumo.baldes.map((b: any) => ({
        periodicidade: b.periodicidade,
        valor: b.liquido,
      })),
    );
  }, 300_000);

  /**
   * Periodicidade nunca se mistura — a recusa que sobreviveu à saída da
   * natureza.
   *
   * Cada periodicidade produz **uma** entrada, e duas periodicidades nunca
   * viram uma. Uma resposta que juntasse R$/mês com R$/ano seria a soma que o
   * produto recusa, feita no servidor, e o cliente não teria como desfazê-la.
   */
  it("uma entrada por periodicidade, e nunca duas periodicidades somadas", async () => {
    const lista = await vigencias();
    const { body } = await get(`/monitor-custo-fixo/candidatos?para=${lista[0].id}`);

    for (const candidato of body.candidatos) {
      if (candidato.numeros === null) continue;
      const periodicidades = candidato.numeros.impacto.baldes.map(
        (b: any) => b.periodicidade,
      );
      expect(new Set(periodicidades).size).toBe(periodicidades.length);
      for (const balde of candidato.numeros.impacto.baldes) {
        expect(Object.keys(balde).sort()).toEqual(["periodicidade", "valor"]);
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

  /**
   * A resposta não chega antes de a conexão voltar ao pool.
   *
   * O teto desta rota é aplicado numa conexão avulsa (`comTetoDeRota`), e
   * desfazê-lo é uma consulta — `SET statement_timeout = DEFAULT` — que roda
   * no `finally`, **depois** do corpo. Enquanto `res.json` era a última linha
   * de dentro daquele corpo, o HTTP terminava primeiro e a limpeza ficava em
   * voo: quem recebeu a resposta seguia adiante com uma conexão que o pool
   * ainda não tinha de volta, e um `pool.end()` nesse instante não resolvia
   * mais. Em CI isso apareceu como o `afterAll` de
   * `monitor-custo-fixo-candidatos` estourando os 60s com todos os testes
   * verdes; em produção é o processo que não desliga sozinho.
   *
   * A régua aqui é a mais direta que existe para essa ordem: **no instante em
   * que a resposta chega, nenhuma conexão do pool está em uso**. Ela falha com
   * a ordem antiga e passa com a nova — conferido invertendo a rota de volta.
   *
   * `idleCount === totalCount` é o pool inteiro parado. `totalCount > 0`
   * impede que a asserção passe por vacuidade num pool que nunca abriu nada.
   */
  it("a conexão já voltou ao pool quando a resposta chega", async () => {
    const lista = await vigencias();
    const { status } = await get(`/monitor-custo-fixo/candidatos?para=${lista[0].id}`);

    expect(status).toBe(200);
    expect(pool.totalCount).toBeGreaterThan(0);
    expect(pool.idleCount).toBe(pool.totalCount);
  }, 300_000);
});
