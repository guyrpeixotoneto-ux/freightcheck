import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import express from "express";
import { erroEmJson } from "../../middlewares/contrato-json";
import { captureRaw, preview, promote, receiveFile, stage } from "@workspace/ingest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { escreverPlanilha } from "@workspace/ingest/testing/planilha";
import { createDb, encerrarPoolDoProcesso } from "@workspace/db";

/**
 * `/compras*` — o contrato da superfície, sobre o pipeline real.
 *
 * A aritmética mora em `@workspace/compras` e é provada lá, contra o export
 * real e contra material sintético. O que se protege aqui são os estados que a
 * tela promete sustentar, na ordem em que eles acontecem na vida real:
 *
 * 1. **banco vazio** — o catálogo responde mesmo assim, porque é o mapa e não
 *    uma projeção dos nossos fatos; os dois balcões respondem 404 com a frase
 *    que aponta o caminho;
 * 2. **frota importada** — a placa é encontrada, o remunerado sai por produto,
 *    e uma placa inexistente é 404 e não 500;
 * 3. **placa em branco** — 400, porque não há o que consultar, e a diferença
 *    entre "faltou o parâmetro" e "não achei" tem de chegar à tela.
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

const PLACA = "ABC1D23";

function planilhaDeFrota(): string {
  return escreverPlanilha({
    vigencia: "EMPURRADA_1_8_2026",
    abas: [
      {
        nome: "cavalos",
        colunas: ["Valor Pneu", "ipvaLicenciamento"],
        linhas: [
          {
            placa: PLACA,
            chassi: "9BM9999999X999999",
            /*
              O pneu entra zerado de propósito: é o estado que a ressalva do
              catálogo existe para explicar, e a rota tem de devolvê-lo como
              número — a tela é que o lê com a advertência ao lado.
            */
            valores: { "Valor Pneu": 0, ipvaLicenciamento: 4096.31 },
          },
        ],
      },
    ],
  });
}

beforeAll(async () => {
  ctx = await createTestDatabase("api_compras");
  process.env.DATABASE_URL = ctx.url;
  nomeDoBanco = ctx.url.replace(/^.*\//, "").replace(/\?.*$/, "");

  const { default: comprasRouter } = await import("../compras");

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
  app.use(comprasRouter);
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

describe("a superfície de Compras, na ordem em que a vida acontece", () => {
  /**
   * O catálogo não toca o banco. É o que permite à tela desenhar a lista de
   * produtos antes de qualquer importação — e dizer, com o banco vazio, o que
   * ela vai responder quando houver dado.
   */
  it("com o banco vazio: o catálogo responde, e os dois balcões dizem o que falta", async () => {
    const catalogo = await get("/compras/catalogo");
    expect(catalogo.status).toBe(200);
    expect(catalogo.body.produtos.length).toBeGreaterThan(0);
    expect(catalogo.body.produtos.map((p: any) => p.chave)).toContain("pneu");
    expect(catalogo.body.produtos.map((p: any) => p.chave)).toContain("uniformes");
    expect(catalogo.body.operacional.balcao).toBe("QLP_OPERACIONAL");

    const frota = await get(`/compras/remunerado/frota?placa=${PLACA}`);
    expect(frota.status).toBe(404);
    expect(frota.body.error).toMatch(/ABC1D23/);

    const qlp = await get("/compras/remunerado/qlp");
    expect(qlp.status).toBe(404);
    expect(qlp.body.error).toMatch(/QLP Administrativo/);

    const matriz = await get("/compras/remunerado/frota/matriz");
    expect(matriz.status).toBe(404);
    expect(matriz.body.error).toMatch(/vigência/i);
  });

  it("sem placa: 400, e não 404 — faltou o parâmetro, não o veículo", async () => {
    const semPlaca = await get("/compras/remunerado/frota");
    expect(semPlaca.status).toBe(400);
    expect(semPlaca.body.error).toMatch(/placa/i);

    const emBranco = await get("/compras/remunerado/frota?placa=%20%20");
    expect(emBranco.status).toBe(400);
  });

  /**
   * A busca de placas responde antes de haver qualquer importação, e responde
   * lista vazia — quem está digitando a primeira letra não cometeu falha
   * nenhuma, e um 400 a cada tecla encheria o log de ruído.
   */
  it("a busca de placas nunca é erro, mesmo vazia ou curta demais", async () => {
    expect((await get("/compras/placas?termo=")).status).toBe(200);
    expect((await get("/compras/placas?termo=")).body.placas).toEqual([]);
    expect((await get("/compras/placas?termo=A")).body.placas).toEqual([]);
  });

  describe("com uma vigência de frota importada", () => {
    beforeAll(async () => {
      const recebido = await receiveFile(ctx.db, { filePath: planilhaDeFrota() });
      await captureRaw(ctx.db, recebido.importRunId);
      await stage(ctx.db, recebido.importRunId);
      const relatorio = await preview(ctx.db, recebido.importRunId);
      expect(relatorio.blockingErrors).toBe(0);
      await promote(ctx.db, recebido.importRunId, {
        confirmNewEntityTypes: relatorio.pendingIdentities,
      });
    }, 120_000);

    it("acha a placa pelo prefixo", async () => {
      const r = await get("/compras/placas?termo=ABC");
      expect(r.status).toBe(200);
      expect(r.body.placas.map((p: any) => p.placa)).toContain(PLACA);
    });

    it("devolve o remunerado por produto, na ordem do catálogo", async () => {
      const r = await get(`/compras/remunerado/frota?placa=${PLACA}`);
      expect(r.status).toBe(200);
      expect(r.body.placa.placa).toBe(PLACA);
      expect(r.body.presente).toBe(true);

      const chaves = r.body.produtos.map((p: any) => p.produto.chave);
      expect(chaves).toContain("pneu");
      expect(chaves).toContain("ipva-licenciamento");
      /* A ordem é a do catálogo, e não a dos dados que a placa por acaso tem. */
      expect(chaves.indexOf("pneu")).toBeLessThan(chaves.indexOf("ipva-licenciamento"));
    });

    /**
     * O zero do pneu chega como número, com a ressalva ao lado. Omitir o zero
     * seria esconder o que a fonte declara; mostrá-lo sem a ressalva faria quem
     * confere um pedido concluir que a Ambev não remunera pneu.
     */
    it("o pneu chega zerado e com a ressalva junto", async () => {
      const r = await get(`/compras/remunerado/frota?placa=${PLACA}`);
      const pneu = r.body.produtos.find((p: any) => p.produto.chave === "pneu");
      expect(pneu.produto.ressalva.motivo).toBe("COLUNA_ZERADA_NA_SERIE");
      expect(pneu.linhas.find((l: any) => l.code === "cavalo.valor_pneu").valor).toBe(0);
    });

    /**
     * A matriz é a porta da aba: ela responde **sem placa nenhuma**, que é o
     * ponto — a pergunta "quanto a Ambev remunera pneu na frota" não tem placa,
     * e respondê-la digitando uma a uma é o gesto que esta rota existe para
     * apagar.
     */
    it("a matriz responde sem placa, com a frota em linhas e os produtos em colunas", async () => {
      const r = await get("/compras/remunerado/frota/matriz");
      expect(r.status).toBe(200);
      expect(r.body.linhas.length).toBeGreaterThan(0);
      expect(r.body.linhas.map((l: any) => l.placa)).toContain(PLACA);

      const chaves = r.body.colunas.map((c: any) => c.produto.chave);
      expect(chaves).toContain("pneu");
      expect(chaves.indexOf("pneu")).toBeLessThan(chaves.indexOf("ipva-licenciamento"));
      /* Uma célula por coluna, sempre: a tabela não tem buraco de forma. */
      for (const linha of r.body.linhas) {
        expect(linha.celulas).toHaveLength(r.body.colunas.length);
      }
    });

    /**
     * A célula e a ficha são o mesmo número — é a promessa inteira do módulo,
     * conferida aqui pela superfície que a tela consome, e não só pela leitura.
     */
    it("a célula da matriz é o destaque da ficha da mesma placa", async () => {
      const matriz = await get("/compras/remunerado/frota/matriz");
      const ficha = await get(`/compras/remunerado/frota?placa=${PLACA}`);
      const linha = matriz.body.linhas.find((l: any) => l.placa === PLACA);

      matriz.body.colunas.forEach((coluna: any, i: number) => {
        const produto = ficha.body.produtos.find(
          (p: any) => p.produto.chave === coluna.produto.chave,
        );
        expect(linha.celulas[i].valor).toBe(produto.destaque?.valor ?? null);
      });
    });

    it("o recorte por equipamento estreita as linhas e mantém as colunas", async () => {
      const so = await get("/compras/remunerado/frota/matriz?entityType=CARRETA");
      expect(so.status).toBe(200);
      expect(so.body.linhas.every((l: any) => l.entityType === "CARRETA")).toBe(true);

      const tudo = await get("/compras/remunerado/frota/matriz");
      expect(so.body.colunas.map((c: any) => c.produto.chave)).toEqual(
        tudo.body.colunas.map((c: any) => c.produto.chave),
      );
    });

    it("placa que não existe é 404 — nunca 500", async () => {
      const r = await get("/compras/remunerado/frota?placa=XXX0X00");
      expect(r.status).toBe(404);
      expect(r.body.error).toMatch(/XXX0X00/);
    });

    /**
     * A placa é normalizada antes da busca: quem digita com hífen ou em caixa
     * baixa chega ao mesmo veículo. Sem isto, metade das consultas de um dia
     * responderia 404 por causa de pontuação.
     */
    it("normaliza a placa digitada — hífen e caixa não mudam o veículo", async () => {
      const comHifen = await get("/compras/remunerado/frota?placa=abc-1d23");
      expect(comHifen.status).toBe(200);
      expect(comHifen.body.placa.placa).toBe(PLACA);
    });

    /**
     * O QLP continua 404 depois da importação de frota: são famílias de dados
     * diferentes, e uma vigência de equipamento não abre o balcão da estrutura.
     */
    it("a frota importada não abre o balcão do QLP", async () => {
      const qlp = await get("/compras/remunerado/qlp");
      expect(qlp.status).toBe(404);
    });
  });
});
