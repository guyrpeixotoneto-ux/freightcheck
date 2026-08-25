import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { createDb, encerrarPoolDoProcesso } from "@workspace/db";
import { erroEmJson } from "../../middlewares/contrato-json";

/**
 * `GET /fechamento/competencias/:id/pagamento` — o 03.08.20, verba a verba.
 *
 * `lerItensDoPagamentoDaCompetencia` já é provado sem HTTP em
 * `lib/fechamento/src/__tests__/persistencia.test.ts`. O que se protege aqui
 * é a borda: a rota devolve a lista vazia (não 404) quando não há verba, e
 * devolve o que o arquivo real declarou depois de importado.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;
let nomeDoBanco: string;

function raizDoWorkspace(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (!existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
    const acima = path.dirname(dir);
    if (acima === dir) throw new Error("workspace não encontrado");
    dir = acima;
  }
  return dir;
}

const ARQUIVO = path.join(
  raizDoWorkspace(),
  "lib/fechamento/src/__tests__/amostras/03.08.20-2026-07-Q1.txt",
);

const UNIDADE = { codigo: "081-0443", nome: "CRBS SA - CDD Belem" };
const TRANSPORTADORA = { codigo: "36", nome: "HORIZONTE LOGISTICA LTDA" };

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
      quinzena: 1,
      unidade: { ...UNIDADE, codigo: `${UNIDADE.codigo}-${sufixo}` },
      transportadora: TRANSPORTADORA,
      tipoDeOperacao: "PROPRIA",
    }),
  });
  return body.id as string;
}

beforeAll(async () => {
  ctx = await createTestDatabase("api_fechamento_pagamento_da_competencia");
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

describe("GET /fechamento/competencias/:id/pagamento", () => {
  it("404 numa competência que não existe", async () => {
    const { status } = await pedir(
      "/fechamento/competencias/00000000-0000-0000-0000-000000000000/pagamento",
    );
    expect(status).toBe(404);
  });

  it("400 num id que não é UUID", async () => {
    const { status } = await pedir("/fechamento/competencias/nao-e-uuid/pagamento");
    expect(status).toBe(400);
  });

  it("lista vazia — não 404 — quando ninguém importou o 03.08.20 ainda", async () => {
    const id = await abrirCompetencia("vazia");
    const { status, body } = await pedir(`/fechamento/competencias/${id}/pagamento`);

    expect(status).toBe(200);
    expect(body.itens).toEqual([]);
  });

  it("devolve as verbas do arquivo real, com as seis colunas que ele abre", async () => {
    const id = await abrirCompetencia("com-verbas");
    const conteudo = await import("node:fs/promises").then((fs) => fs.readFile(ARQUIVO));

    const envio = await pedir(`/fechamento/competencias/${id}/documentos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tipo: "PAGAMENTO",
        filename: "03.08.20_1Q_JUL.txt",
        contentBase64: conteudo.toString("base64"),
      }),
    });
    expect(envio.status).toBe(201);

    const { status, body } = await pedir(`/fechamento/competencias/${id}/pagamento`);

    expect(status).toBe(200);
    expect(body.itens.length).toBeGreaterThan(0);
    const primeira = body.itens[0];
    expect(primeira).toHaveProperty("semImposto");
    expect(primeira).toHaveProperty("nfIss");
    expect(primeira).toHaveProperty("ctrcIcms");
    expect(primeira).toHaveProperty("valorFaturado");
    expect(primeira).toHaveProperty("vlcNfIss");
    expect(primeira).toHaveProperty("vlcCtrcIcms");
    expect(primeira.verba).toHaveProperty("nome");
  });
});
