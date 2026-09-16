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
 * `GET /ipva/candidatos` — o que cada candidata a "De" produz contra o "Para".
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
  ctx = await createTestDatabase("api_ipva_candidatos");
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

  const { default: ipvaRouter } = await import("../ipva");
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    next();
  });
  app.use(ipvaRouter);
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

describe("GET /ipva/candidatos", () => {
  it("exige a vigência de destino", async () => {
    const res = await get("/ipva/candidatos");
    expect(res.status).toBe(400);
  });

  /**
   * O requisito 2 e o 3 na mesma asserção, porque são a mesma régua: a lista de
   * candidatas é a série do destino — mesma unidade, mesma cobertura.
   */
  it("só oferece candidatas da mesma unidade e da mesma cobertura", async () => {
    const lista = await vigencias();
    const destino = lista[0];
    const { status, body } = await get(`/ipva/candidatos?para=${destino.id}`);

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

  /**
   * O requisito 1: o número é do par, e não da vigência.
   *
   * A primeira versão deste teste comparava o mesmo candidato contra os **dois
   * destinos mais recentes** e exigia números diferentes — e falhou, com razão:
   * medido no acervo real, o IPVA de 16/06 contra 16/07 e contra 01/08 dá o
   * mesmo `−R$ 144.874,50`, porque o tributo não se moveu entre julho e agosto.
   * O IPVA é anual; vigências vizinhas repetirem o valor é o comportamento
   * esperado, não o defeito.
   *
   * A régua certa é varrer os destinos: **em algum par o número tem de mudar**,
   * e muda — de `−R$ 590.437,65` para `−R$ 731.586,01` quando o destino
   * atravessa a virada. Um número que fosse da vigência sozinha seria igual em
   * todos eles.
   */
  it("responde números diferentes quando o Para muda", async () => {
    const lista = await vigencias();
    const serie = lista.filter(
      (v) =>
        v.scopeHash === lista[0].scopeHash && v.entityTypeSet === lista[0].entityTypeSet,
    );
    const candidata = serie[serie.length - 1];

    const numeros: string[] = [];
    for (const destino of serie.slice(0, serie.length - 1)) {
      const { body } = await get(`/ipva/candidatos?para=${destino.id}`);
      const achado = body.candidatos.find(
        (c: { id: string }) => c.id === candidata.id,
      );
      if (achado?.numeros) numeros.push(JSON.stringify(achado.numeros));
    }

    expect(numeros.length).toBeGreaterThan(1);
    expect(new Set(numeros).size).toBeGreaterThan(1);
  }, 300_000);

  /**
   * E o número é **o mesmo** que a tela publica depois do clique.
   *
   * Esta é a prova direta de que o menu não inventa uma segunda régua: o que
   * aparece ao lado da vigência tem de bater, campo a campo, com o que
   * `/ipva/comparacao` responde para aquele par exato. Se um dia as duas
   * divergirem, quem escolhe pelo menu escolhe por um número que a tela não
   * confirma.
   */
  it("o número do menu é o mesmo de /ipva/comparacao para aquele par", async () => {
    const lista = await vigencias();
    const destino = lista[0];
    const { body } = await get(`/ipva/candidatos?para=${destino.id}`);
    const comNumero = body.candidatos.find(
      (c: { numeros: unknown }) => c.numeros !== null,
    );
    expect(comNumero).toBeDefined();

    const { body: comparacao } = await get(
      `/ipva/comparacao?base=${comNumero.id}&comparada=${destino.id}`,
    );

    expect(comNumero.numeros.alteracoes).toBe(comparacao.resumo.variaveisAlteradas);
    /* Os mesmos baldes, e com natureza nula: é uma rubrica de uma natureza só,
       e a linha do menu sai sem prefixo. */
    expect(comNumero.numeros.impacto.baldes).toEqual(
      Object.entries(comparacao.resumo.impacto.porPeriodicidade).map(
        ([periodicidade, valor]) => ({ periodicidade, natureza: null, valor }),
      ),
    );
  }, 300_000);

  /**
   * O requisito 4, e o que ele **não** permite: a ausência de cálculo volta
   * `null`, nunca um zero. Um `alteracoes: 0` só pode existir ao lado de uma
   * comparação que de fato aconteceu.
   */
  it("ausência de cálculo é null, e nunca um zero inventado", async () => {
    const lista = await vigencias();
    const { body } = await get(`/ipva/candidatos?para=${lista[0].id}`);

    for (const candidato of body.candidatos) {
      expect(candidato).toHaveProperty("numeros");
      if (candidato.numeros === null) continue;
      expect(typeof candidato.numeros.alteracoes).toBe("number");
      expect(Array.isArray(candidato.numeros.impacto.baldes)).toBe(true);
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
    const res = await get(`/ipva/candidatos?para=${lista[0].id}&operacao=ROTA`);
    expect(res.status).toBe(404);
  });

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
    const { status } = await get(`/ipva/candidatos?para=${lista[0].id}`);

    expect(status).toBe(200);
    expect(pool.totalCount).toBeGreaterThan(0);
    expect(pool.idleCount).toBe(pool.totalCount);
  }, 300_000);
});
