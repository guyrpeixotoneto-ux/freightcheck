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
import { computeChangeSet, listComparableSnapshots } from "@workspace/comparison";

/**
 * `GET /alteracoes-por-modulo/ultimas-alteracoes` — o par de cada módulo.
 *
 * O que estes casos prendem é o contrato inteiro da tela contra o acervo de
 * verdade: os estados são discriminados (nenhum campo monetário onde não há
 * montante), `antes + impacto` fecha com `depois`, periodicidade não se
 * converte, e uma lacuna de cálculo **nunca** vira "sem alteração".
 *
 * O acervo de teste é o mesmo do seed: cobertura de equipamento e só. As abas
 * de Custo Variável e Equipe são provadas por fixtures em
 * `lib/comparison/src/__tests__/cartoes-de-ultima-alteracao.test.ts` — aqui elas
 * aparecem como ausência de cobertura, que é o que este acervo de fato tem.
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

const aba = (body: any, area: string) =>
  body.abas.find((a: { area: string }) => a.area === area);

const cartao = (body: any, area: string, modulo: string) =>
  aba(body, area).cartoes.find((c: { modulo: string }) => c.modulo === modulo);

beforeAll(async () => {
  ctx = await createTestDatabase("api_ultimas_alteracoes");
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

  const { default: router } = await import("../ultimas-alteracoes");
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    next();
  });
  app.use(router);
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

describe("GET /alteracoes-por-modulo/ultimas-alteracoes", () => {
  /**
   * A recusa do item 6, e ela vem antes de tudo: sem nenhuma comparação
   * calculada, a tela **não** diz "sem alteração". Ela diz que não sabe, e
   * oferece o cálculo.
   */
  it("sem comparação calculada, publica lacuna — e nunca 'sem alteração'", async () => {
    const { status, body } = await get("/alteracoes-por-modulo/ultimas-alteracoes");
    expect(status).toBe(200);

    const finame = cartao(body, "CUSTO_FIXO", "FINAME");
    expect(finame.estado).toBe("LACUNA_DE_CALCULO");
    expect(finame.varredura.lacunas.length).toBeGreaterThan(0);
    expect(finame.varredura.pares).toBe(0);
    expect(finame.baldes).toEqual([]);
    /* A lacuna nomeia as duas pontas: é o que a ação "Calcular" precisa. */
    const [lacuna] = finame.varredura.lacunas;
    expect(lacuna.baseId).toBeTruthy();
    expect(lacuna.comparadaId).toBeTruthy();
    expect(lacuna.comparadaData).toBeTruthy();
  }, 300_000);

  it("as três abas existem sempre, e nenhum módulo some", async () => {
    const { body } = await get("/alteracoes-por-modulo/ultimas-alteracoes");
    expect(body.abas.map((a: { area: string }) => a.area)).toEqual([
      "CUSTO_FIXO",
      "CUSTO_VARIAVEL",
      "EQUIPE",
    ]);
    expect(aba(body, "CUSTO_FIXO").cartoes).toHaveLength(7);
    /* Dois cartões de quadro, e não trinta e dois de assunto. */
    const equipe = aba(body, "EQUIPE").cartoes;
    expect(equipe).toHaveLength(2);
    expect(equipe.map((c: { modulo: string }) => c.modulo)).toEqual([
      "OPERACIONAL",
      "ADMINISTRATIVO",
    ]);
    /* Os dezesseis assuntos aparecem mesmo sem quadro no acervo: o catálogo de
       assuntos é do produto, e não da comparação. */
    for (const c of equipe) expect(c.assuntos.length).toBe(16);
  }, 300_000);

  describe("com as comparações calculadas", () => {
    beforeAll(async () => {
      const lista = await vigencias();
      /* Os pares consecutivos, como a varredura os enxerga. */
      for (let i = 0; i + 1 < lista.length; i++) {
        await computeChangeSet(ctx.db, lista[i + 1].id, lista[i].id, {
          computedBy: "test:ultimas-alteracoes",
        });
      }
    }, 600_000);

    /**
     * O caso que dá nome à tela: dois cartões da mesma aba comparando pares
     * diferentes, cada um com o **seu**.
     */
    it("cada cartão traz o par dele, e a aba conta os períodos distintos", async () => {
      const { body } = await get("/alteracoes-por-modulo/ultimas-alteracoes");
      const custoFixo = aba(body, "CUSTO_FIXO");

      const comMovimento = custoFixo.cartoes.filter(
        (c: { estado: string }) => c.estado === "COM_MOVIMENTO_FINANCEIRO",
      );
      expect(comMovimento.length).toBeGreaterThan(0);

      const datas = new Set(
        comMovimento.map((c: { par: { comparadaData: string } }) => c.par.comparadaData),
      );
      expect(custoFixo.periodosDistintos).toBeGreaterThanOrEqual(datas.size);
      expect(custoFixo.comparadaMaisRecente).toBe(
        [...datas].sort((a: any, b: any) => b.localeCompare(a))[0],
      );

      /* Ordenação: recência primeiro. O atrasado fica depois do mais recente. */
      const recencias = custoFixo.cartoes
        .filter((c: { par: unknown }) => c.par !== null)
        .map((c: { par: { comparadaData: string } }) => c.par.comparadaData);
      expect([...recencias].sort((a, b) => b.localeCompare(a))).toEqual(recencias);
    }, 300_000);

    /**
     * A reconciliação do item 7, conferida número a número: `antes` e `depois`
     * são as duas pontas das **mesmas** linhas que o módulo somou, e a diferença
     * entre elas é exatamente o impacto que ele publicou.
     */
    it("antes + impacto fecha com depois, em todo balde de todo cartão", async () => {
      const { body } = await get("/alteracoes-por-modulo/ultimas-alteracoes");
      let conferidos = 0;

      for (const a of body.abas) {
        for (const c of a.cartoes) {
          for (const b of c.baldes) {
            expect(b.depois, `${c.modulo}/${b.periodicidade}`).toBeCloseTo(
              b.antes + b.impacto,
              2,
            );
            /* Variação é impacto ÷ antes, e nunca infinito. */
            if (b.antes === 0) expect(b.variacao).toBeNull();
            else expect(b.variacao).toBeCloseTo(b.impacto / b.antes, 9);
            expect(Number.isFinite(b.variacao ?? 0)).toBe(true);
            conferidos++;
          }
        }
      }

      expect(conferidos).toBeGreaterThan(0);
    }, 300_000);

    it("nenhum balde é convertido — a periodicidade sai como o módulo a publicou", async () => {
      const { body } = await get("/alteracoes-por-modulo/ultimas-alteracoes");
      const ipva = cartao(body, "CUSTO_FIXO", "IPVA");
      if (ipva.estado === "COM_MOVIMENTO_FINANCEIRO") {
        /* O IPVA é ANUAL confirmado. Um balde MENSAL aqui seria uma divisão por
           doze que o produto recusa em todas as outras telas. */
        expect(ipva.baldes.map((b: { periodicidade: string }) => b.periodicidade)).toEqual([
          "ANUAL",
        ]);
      }

      for (const a of body.abas) {
        for (const c of a.cartoes) {
          const periodicidades = c.baldes.map((b: { periodicidade: string }) => b.periodicidade);
          expect(new Set(periodicidades).size).toBe(periodicidades.length);
        }
      }
    }, 300_000);

    /**
     * Os estados discriminados do item 3: nenhum campo monetário aparece num
     * cartão que não tem montante, e nenhuma frase de ausência de dado aparece
     * onde a ausência é semântica.
     */
    it("um módulo sem montante apurável não publica balde nenhum, e diz por quê", async () => {
      const { body } = await get("/alteracoes-por-modulo/ultimas-alteracoes");
      const manutencao = cartao(body, "CUSTO_VARIAVEL", "MANUTENCAO");

      expect(manutencao.estado).toBe("SEM_MONTANTE_APURAVEL");
      expect(manutencao.baldes).toEqual([]);
      expect(manutencao.motivo).toMatch(/R\$\/km/);
      expect(manutencao.movimento.unidade).toBe("R$/km");
      /* O movimento existe e é dito: seiscentas linhas alteradas não são "nada
         aconteceu". */
      expect(manutencao.movimento.alteracoes).toBeGreaterThan(0);
    }, 300_000);

    it("a aquisição explica a decisão semântica, e não uma falta de dado", async () => {
      const { body } = await get("/alteracoes-por-modulo/ultimas-alteracoes");
      const aquisicao = cartao(body, "CUSTO_FIXO", "AQUISICAO");

      expect(aquisicao.estado).toBe("SEM_MONTANTE_APURAVEL");
      expect(aquisicao.baldes).toEqual([]);
      expect(aquisicao.motivo).toMatch(/não compõe o impacto de custo fixo/);
      expect(aquisicao.motivo).not.toMatch(/sem alteração/i);
    }, 300_000);

    /**
     * O módulo financeiro que nunca se moveu: a frase é a do item 3A, e vem com
     * o que a torna verificável — quantos pares, em que intervalo.
     */
    it("um módulo financeiro parado diz quantos pares varreu e em que intervalo", async () => {
      const { body } = await get("/alteracoes-por-modulo/ultimas-alteracoes");
      const parados = aba(body, "CUSTO_FIXO").cartoes.filter(
        (c: { estado: string }) => c.estado === "SEM_MOVIMENTO_FINANCEIRO",
      );

      for (const c of parados) {
        expect(c.baldes).toEqual([]);
        expect(c.motivo).toBeNull();
        expect(c.varredura.pares).toBeGreaterThan(0);
        expect(c.varredura.de).toBeTruthy();
        expect(c.varredura.ate).toBeTruthy();
        expect(c.varredura.lacunas).toEqual([]);
      }
    }, 300_000);

    it("o cartão traz a comparação de onde saiu — a origem de 'Ver alterações'", async () => {
      const { body } = await get("/alteracoes-por-modulo/ultimas-alteracoes");
      for (const a of body.abas) {
        for (const c of a.cartoes) {
          if (c.estado !== "COM_MOVIMENTO_FINANCEIRO") continue;
          expect(c.changeSetId).toBeTruthy();
          expect(c.par.baseId).toBeTruthy();
          expect(c.par.comparadaId).toBeTruthy();
        }
      }
    }, 300_000);

    it("uma cobertura ausente não apaga os cartões dela", async () => {
      const { body } = await get("/alteracoes-por-modulo/ultimas-alteracoes");
      /* Este acervo não tem trecho. Os cinco cartões da malha continuam, com a
         frase do domínio — sumir faria "não importamos" parecer "não existe". */
      const daMalha = aba(body, "CUSTO_VARIAVEL").cartoes.filter(
        (c: { cobertura: string }) => c.cobertura === "TRECHO",
      );
      expect(daMalha).toHaveLength(5);
      for (const c of daMalha) {
        expect(c.estado).toBe("SEM_COBERTURA");
        expect(c.motivo).toMatch(/trecho/);
      }
    }, 300_000);
  });
});
