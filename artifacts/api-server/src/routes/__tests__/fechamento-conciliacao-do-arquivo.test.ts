import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import express from "express";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { createDb, encerrarPoolDoProcesso } from "@workspace/db";
import { erroEmJson } from "../../middlewares/contrato-json";

/**
 * `GET /fechamento/competencias/:id/conciliacao-do-arquivo` — o 03.02.59.02,
 * seção por seção.
 *
 * `lerItensDaConciliacaoDaCompetencia` já é provado sem HTTP em
 * `lib/fechamento/src/__tests__/persistencia.test.ts`. Aqui só a borda: lista
 * vazia (não 404) sem arquivo, e o que o arquivo real declarou depois de
 * importado.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;
let nomeDoBanco: string;

async function pedir(caminho: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${caminho}`, init);
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function abrirCompetencia(sufixo: string): Promise<string> {
  const { body } = await pedir("/fechamento/competencias", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ano: 2026,
      mes: 7,
      quinzena: 2,
      unidade: { codigo: `conc-${sufixo}`, nome: `CDD ${sufixo}` },
      transportadora: { codigo: "036", nome: "HORIZONTE" },
      tipoDeOperacao: "ROTA",
    }),
  });
  return body.id as string;
}

/** Um 03.02.59.02 mínimo, no mesmo layout de largura fixa que o Promax exporta. */
function fixtureConciliacao(): Buffer {
  const soCalculado = (rotulo: string, valor: string) => rotulo.padEnd(79 - valor.length) + valor;
  const duas = (rotulo: string, marca: string, a: string, b: string) =>
    rotulo.padEnd(61) + marca.padEnd(4) + a.padStart(10) + "   " + b.padStart(10);

  const linhas = [
    "PW02551R-j-Promax Web                        (930 )  Rel. Valores Conciliacao CT-e - Por Nota Fiscal                04/08/2026                              Pag.   1",
    "CRBS SA - CDD Ficticio                                                                                                   16:46",
    "Versao: 12.22.00.04      Rotina: 03.02.59.02.00      Usuario: 00000000001",
    "",
    "Selecao - Data: 16/07/2026 a 31/07/2026",
    "Transportadora:     36 - TRANSPORTES FICTICIA LTDA",
    "Opcao: Sintetico",
    "",
    "                                                     Conciliado     R$ CT-e   R$ SRTrans",
    "                                                                   (Emitido) (Calculado)",
    "RESUMO CT-e ROTA",
    "----------------------------------------------------------------------------------------",
    "RESUMO PENDENCIAS",
    soCalculado("Saldo Proxima Quinzena", "325,00"),
    "",
    "RESUMO DA QUINZENA ATUAL",
    duas("Frota Fixa", "S", "1.000,00", "1.000,00"),
    "",
  ];
  return Buffer.from(linhas.join("\n"), "latin1");
}

beforeAll(async () => {
  ctx = await createTestDatabase("api_fechamento_conciliacao_do_arquivo");
  process.env.DATABASE_URL = ctx.url;
  nomeDoBanco = ctx.url.replace(/^.*\//, "").replace(/\?.*$/, "");

  const { default: fechamentoRouter } = await import("../fechamento");

  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = { error: () => {}, warn: () => {}, info: () => {} };
    (req as unknown as { user: unknown }).user = {
      id: "11111111-1111-1111-1111-111111111111",
      name: "Guy",
      email: "teste@freightcheck",
      role: "OPERADOR",
    };
    next();
  });
  app.use(fechamentoRouter);
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
});

describe("GET /fechamento/competencias/:id/conciliacao-do-arquivo", () => {
  it("404 numa competência que não existe", async () => {
    const { status } = await pedir(
      "/fechamento/competencias/00000000-0000-0000-0000-000000000000/conciliacao-do-arquivo",
    );
    expect(status).toBe(404);
  });

  it("lista vazia — não 404 — quando ninguém importou o 03.02.59.02 ainda", async () => {
    const id = await abrirCompetencia("vazia");
    const { status, body } = await pedir(`/fechamento/competencias/${id}/conciliacao-do-arquivo`);

    expect(status).toBe(200);
    expect(body.itens).toEqual([]);
  });

  it("devolve as linhas do arquivo, seção e bloco inclusos", async () => {
    const id = await abrirCompetencia("com-linhas");
    const envio = await pedir(`/fechamento/competencias/${id}/documentos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tipo: "CONCILIACAO",
        filename: "03.02.59.02.txt",
        contentBase64: fixtureConciliacao().toString("base64"),
      }),
    });
    expect(envio.status).toBe(201);

    const { status, body } = await pedir(`/fechamento/competencias/${id}/conciliacao-do-arquivo`);

    expect(status).toBe(200);
    expect(body.itens.length).toBeGreaterThan(0);
    const frotaFixa = body.itens.find((i: any) => i.rubrica === "Frota Fixa");
    expect(frotaFixa.secao).toBe("ROTA");
    expect(frotaFixa.bloco).toBe("RESUMO DA QUINZENA ATUAL");
    expect(frotaFixa.emitido).toBe(1000);
    expect(frotaFixa.calculado).toBe(1000);
  });
});
