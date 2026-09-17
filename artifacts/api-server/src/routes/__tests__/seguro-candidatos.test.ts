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
 * `GET /seguro/candidatos` — e o `R$ 0,00` que o menu não pode mais escrever.
 *
 * O defeito, visto na tela: o cartão "Impacto financeiro" dizia **"Sem impacto
 * precificável — nenhuma rubrica monetária confirmada se moveu"**, a tabela
 * logo abaixo listava a carreta cujo seguro foi de R$ 180,79 a R$ 631,41, e o
 * menu de vigências — a dois centímetros do cartão — escrevia `R$ 0,00` para
 * aquele mesmo par. Dos três, só o cartão contava a verdade.
 *
 * A rota descia `impacto: { baldes: [] }` e nada mais, e `baldes` vazio, no
 * cliente, quer dizer *calculei e deu zero*. Não foi o que aconteceu: o motor
 * recusou monetizar, porque `viraDinheiro` só passa o que a curadoria
 * confirmou, e `carreta.seguro` está PRESUMED.
 *
 * O que se protege aqui, sobre o export real e a curadoria de verdade:
 *
 * 1. **a recusa é publicada** — `semImpacto` desce sempre que o recorte tem
 *    alteração monetária sem preço, e `baldes` vazio nunca fica mudo sobre o
 *    porquê;
 * 2. **o menu não discorda do cartão** — para cada candidata, o que a rota
 *    publica bate, campo a campo, com `/seguro/comparacao` do mesmo par,
 *    inclusive na decisão de calar a coluna;
 * 3. **nada disso vale para quem precifica** — a mesma montagem, na rota irmã
 *    de FINAME, continua publicando dinheiro e sem `semImpacto` nenhum.
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

/** A série do destino mais recente — mesma unidade, mesma cobertura. */
async function serieDoDestino() {
  const lista = await vigencias();
  const destino = lista[0];
  return {
    destino,
    serie: lista.filter(
      (v) =>
        v.scopeHash === destino.scopeHash && v.entityTypeSet === destino.entityTypeSet,
    ),
  };
}

beforeAll(async () => {
  ctx = await createTestDatabase("api_seguro_candidatos");
  process.env.DATABASE_URL = ctx.url;
  nomeDoBanco = ctx.url.replace(/^.*\//, "").replace(/\?.*$/, "");

  const { carreta, cavalo } = modelExportPaths();
  for (const filePath of [carreta, cavalo]) {
    await importFixture(ctx.db, filePath);
  }
  /*
    A curadoria roda inteira, e é o que dá sentido ao caso principal: nada aqui
    confirma `carreta.seguro` à mão. O atributo sai deste passo como sai no
    acervo — PRESUMED —, e é o produto que decide o que fazer com isso.
  */
  await seedTaxonomy(ctx.db, "test");
  await runProposalPass(ctx.db, "test:proposal");
  await applyConfirmations(ctx.db);
  await backfillSemantics(ctx.db);

  const { default: seguroRouter } = await import("../seguro");
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
  app.use(seguroRouter);
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

describe("GET /seguro/candidatos", () => {
  it("exige a vigência de destino", async () => {
    expect((await get("/seguro/candidatos")).status).toBe(400);
  });

  /**
   * A promessa 1, sobre o acervo real.
   *
   * O aparato se move entre as vigências do export e nenhuma das colunas tem
   * semântica confirmada — então **tem de existir** candidata nesse estado, e
   * ela tem de dizer por que não publica dinheiro. Um `baldes: []` calado ali é
   * exatamente o `R$ 0,00` que a tela escrevia.
   */
  it("o que mudou sem preço desce com a frase, e nunca calado", async () => {
    const { destino } = await serieDoDestino();
    const { status, body } = await get(`/seguro/candidatos?para=${destino.id}`);

    expect(status).toBe(200);
    const comNumero = body.candidatos.filter((c: any) => c.numeros !== null);
    expect(comNumero.length).toBeGreaterThan(0);

    const semDinheiro = comNumero.filter(
      (c: any) => c.numeros.impacto.baldes.length === 0,
    );
    /* Se um dia a curadoria confirmar as colunas, este caso deixa de existir —
       e é o próximo que garante que a tela continuará certa nesse dia. */
    expect(semDinheiro.length).toBeGreaterThan(0);

    const comAlteracao = semDinheiro.filter((c: any) => c.numeros.alteracoes > 0);
    expect(comAlteracao.length).toBeGreaterThan(0);

    /*
      A frase desce em quem tem alteração monetária **sem preço** — que é o que
      `naoCalculavel` conta. O acervo tem os dois casos, e a diferença entre
      eles é o assunto do próximo bloco.
    */
    const semPreco: any[] = [];
    for (const c of comAlteracao) {
      const { body: comparacao } = await get(
        `/seguro/comparacao?base=${c.id}&comparada=${destino.id}`,
      );
      if (comparacao.resumo.impacto.naoCalculavel > 0) semPreco.push(c);
    }

    expect(semPreco.length).toBeGreaterThan(0);
    for (const c of semPreco) {
      expect(c.numeros.semImpacto, `candidata ${c.id}`).toContain("curadoria");
    }
  }, 600_000);

  /**
   * O que esta correção **não** cobre — medido, e não suposto.
   *
   * Existe um quarto estado no acervo: o par cuja única movimentação monetária
   * está nas colunas que não somam por construção — `carreta.custo_fixo`, que
   * já contém FINAME e lucro fixo; o `custo_aluguel`, que é outro contrato; o
   * rastreador, que é zero em toda parte. Ali `naoCalculavel` é zero, a frase
   * não desce, e o menu escreve `R$ 0,00` — ao lado de um cartão que, lendo o
   * mesmo `porPeriodicidade` vazio, diz "Sem impacto precificável".
   *
   * É a mesma discordância que se corrigiu, num recorte mais estreito e por
   * outra razão: lá falta confirmação da curadoria; aqui a recusa de somar é
   * deliberada. O caso está aferido — e não escondido — porque a decisão de
   * calar também a coluna nesse estado é de produto, não deste arquivo. O dia
   * em que ela for tomada, este bloco é o que muda.
   */
  it("a coluna que não soma por construção ainda escreve R$ 0,00", async () => {
    const { destino } = await serieDoDestino();
    const { body } = await get(`/seguro/candidatos?para=${destino.id}`);

    const mudas = body.candidatos.filter(
      (c: any) =>
        c.numeros !== null &&
        c.numeros.impacto.baldes.length === 0 &&
        c.numeros.semImpacto === undefined &&
        c.numeros.alteracoes > 0,
    );

    for (const c of mudas) {
      const { body: comparacao } = await get(
        `/seguro/comparacao?base=${c.id}&comparada=${destino.id}`,
      );
      /* Nenhuma delas pode ser do estado que se corrigiu: se `naoCalculavel`
         for maior que zero aqui, a frase deixou de descer onde devia. */
      expect(comparacao.resumo.impacto.naoCalculavel, `candidata ${c.id}`).toBe(0);
      expect(comparacao.resumo.impacto.foraDaSoma, `candidata ${c.id}`).toBeGreaterThan(
        0,
      );
    }
  }, 600_000);

  /**
   * A promessa 2: o menu e o cartão contam a mesma coisa, inclusive o silêncio.
   *
   * A régua é a decisão inteira, e não só os números: `semImpacto` existe se, e
   * somente se, a comparação daquele par não publicou balde nenhum **e** deixou
   * alteração monetária por precificar. É a definição do estado 3 aferida
   * contra a fonte que o cartão lê.
   */
  it("a decisão do menu é a mesma de /seguro/comparacao para aquele par", async () => {
    const { destino } = await serieDoDestino();
    const { body } = await get(`/seguro/candidatos?para=${destino.id}`);
    const comNumero = body.candidatos.filter((c: any) => c.numeros !== null);
    expect(comNumero.length).toBeGreaterThan(0);

    for (const candidata of comNumero) {
      const { body: comparacao } = await get(
        `/seguro/comparacao?base=${candidata.id}&comparada=${destino.id}`,
      );
      const impacto = comparacao.resumo.impacto;

      expect(candidata.numeros.alteracoes, `candidata ${candidata.id}`).toBe(
        comparacao.resumo.variaveisAlteradas,
      );
      expect(candidata.numeros.impacto.baldes, `candidata ${candidata.id}`).toEqual(
        Object.entries(impacto.porPeriodicidade).map(([periodicidade, valor]) => ({
          periodicidade,
          valor,
        })),
      );

      const deveCalar =
        Object.keys(impacto.porPeriodicidade).length === 0 && impacto.naoCalculavel > 0;
      expect(
        candidata.numeros.semImpacto !== undefined,
        `candidata ${candidata.id}: naoCalculavel=${impacto.naoCalculavel}`,
      ).toBe(deveCalar);
    }
  }, 600_000);

  /**
   * O estado 2 continua existindo — e é por isso que a correção não foi
   * "sempre calar".
   *
   * Um par sem nada por precificar publica a conta, mesmo que ela dê zero:
   * `semImpacto` só desce quando há alteração monetária sem preço. Sem esta
   * régua, um menu inteiramente mudo passaria pelo caso de cima.
   */
  it("sem nada por precificar, a frase não desce", async () => {
    const { destino } = await serieDoDestino();
    const { body } = await get(`/seguro/candidatos?para=${destino.id}`);

    for (const candidata of body.candidatos) {
      if (candidata.numeros === null) continue;
      if (candidata.numeros.semImpacto === undefined) continue;

      const { body: comparacao } = await get(
        `/seguro/comparacao?base=${candidata.id}&comparada=${destino.id}`,
      );
      expect(comparacao.resumo.impacto.naoCalculavel).toBeGreaterThan(0);
    }
  }, 600_000);

  /**
   * A promessa 3: nenhum efeito colateral em quem precifica.
   *
   * O FINAME lê o mesmo acervo, pela mesma montagem de candidatas, e tem
   * semântica confirmada. É o controle do experimento: se `semImpacto`
   * aparecesse aqui, a correção teria virado uma regra global de calar a
   * coluna — e é também o retrato do que a Auditoria de Seguro passa a fazer
   * no dia em que a curadoria confirmar as colunas dela.
   */
  it("a rubrica com semântica confirmada segue publicando dinheiro", async () => {
    const { destino } = await serieDoDestino();
    const { status, body } = await get(`/finame/candidatos?para=${destino.id}`);

    expect(status).toBe(200);
    const comNumero = body.candidatos.filter((c: any) => c.numeros !== null);
    expect(comNumero.length).toBeGreaterThan(0);

    const comDinheiro = comNumero.filter(
      (c: any) => c.numeros.impacto.baldes.length > 0,
    );
    expect(comDinheiro.length).toBeGreaterThan(0);
    for (const c of comNumero) {
      expect(c.numeros.semImpacto, `candidata ${c.id}`).toBeUndefined();
    }
  }, 600_000);

  /** O isolamento por operação, como em toda rota desta superfície. */
  it("recusa a vigência de outra operação", async () => {
    const { destino } = await serieDoDestino();
    const res = await get(`/seguro/candidatos?para=${destino.id}&operacao=ROTA`);
    expect(res.status).toBe(404);
  });
});
