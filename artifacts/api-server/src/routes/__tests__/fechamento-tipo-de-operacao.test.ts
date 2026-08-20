import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import express from "express";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { createDb, encerrarPoolDoProcesso, fechamentoCompetenciaTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { erroEmJson } from "../../middlewares/contrato-json";

/**
 * `PUT /fechamento/competencias/:id/tipo-de-operacao` — a saída do carimbo da `0046`.
 *
 * O que a troca faz, e a quem ela é recusada, está provado sem HTTP em
 * `lib/fechamento` (`persistencia.test.ts`). O que só existe aqui é a tradução,
 * e ela é o que decide se quem opera lê a frase do negócio ou uma tela de erro
 * genérica: **cada recusa vira um número por classe**, e as classes são três —
 * `400` para o pedido incompleto (sem tipo, ou identificador malformado), `404`
 * para a competência que não existe, `409` para as duas em que o pedido está bom
 * e é o estado que responde por ele.
 *
 * O `400` do tipo ausente é o único que não sai desta rota: ele sobe como
 * `TipoDeOperacaoAusente` e é o handler compartilhado (`recusa-de-dominio`) que
 * o numera. É por isso que ele é testado aqui e não lá — o caminho inteiro é o
 * que está sendo medido, e ele passa por um middleware que a função não conhece.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;
let nomeDoBanco: string;

const UNIDADE = { codigo: "081-0443", nome: "CRBS SA - CDD Belem" };
const TRANSPORTADORA = { codigo: "36", nome: "HORIZONTE LOGISTICA LTDA" };

async function pedir(
  caminho: string,
  init?: RequestInit,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${caminho}`, init);
  return { status: res.status, body: await res.json().catch(() => null) };
}

/**
 * Abre a competência de um caso — cada um com a sua unidade.
 *
 * O sufixo varia a unidade e não o período pelo motivo do teste vizinho: a
 * quádrupla é (unidade, transportadora, tipo, chave), e dois casos que a
 * dividissem passariam a medir a idempotência da abertura em vez do que estão
 * aqui para medir.
 */
async function abrir(sufixo: string, tipoDeOperacao = "EMPURRADA"): Promise<string> {
  const { body } = await pedir("/fechamento/competencias", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ano: 2026,
      mes: 7,
      quinzena: 1,
      unidade: { ...UNIDADE, codigo: `${UNIDADE.codigo}-${sufixo}` },
      transportadora: TRANSPORTADORA,
      tipoDeOperacao,
    }),
  });
  return body.id as string;
}

/** O carimbo do backfill, escrito por fora — a porta da frente o recusa. */
async function carimbarDoBackfill(id: string): Promise<void> {
  await ctx.db
    .update(fechamentoCompetenciaTable)
    .set({ tipoDeOperacao: "NAO_INFORMADO" })
    .where(eq(fechamentoCompetenciaTable.id, id));
}

async function encerrarNoBanco(id: string): Promise<void> {
  await ctx.db
    .update(fechamentoCompetenciaTable)
    .set({ estado: "ENCERRADA", encerradaEm: new Date() })
    .where(eq(fechamentoCompetenciaTable.id, id));
}

function trocar(id: string, tipoDeOperacao: unknown) {
  return pedir(`/fechamento/competencias/${id}/tipo-de-operacao`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tipoDeOperacao }),
  });
}

beforeAll(async () => {
  ctx = await createTestDatabase("api_fechamento_tipo");
  process.env.DATABASE_URL = ctx.url;
  nomeDoBanco = ctx.url.replace(/^.*\//, "").replace(/\?.*$/, "");

  const { default: fechamentoRouter } = await import("../fechamento");

  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
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

describe("PUT /fechamento/competencias/:id/tipo-de-operacao", () => {
  it("200 e a competência com o tipo que o backfill não sabia", async () => {
    const id = await abrir("informa");
    await carimbarDoBackfill(id);

    const { status, body } = await trocar(id, "ROTA");

    expect(status).toBe(200);
    expect(body.tipoDeOperacao).toBe("ROTA");
    /* E a leitura seguinte concorda — a resposta não é só o eco do pedido. */
    const lida = await pedir(`/fechamento/competencias/${id}`);
    expect(lida.body.competencia.tipoDeOperacao).toBe("ROTA");
  });

  it("200 na encerrada que nunca disse de qual operação era", async () => {
    const id = await abrir("informa-encerrada");
    await carimbarDoBackfill(id);
    await encerrarNoBanco(id);

    const { status, body } = await trocar(id, "EMPURRADA");

    expect(status).toBe(200);
    expect(body.tipoDeOperacao).toBe("EMPURRADA");
    expect(body.estado).toBe("ENCERRADA");
  });

  it("409 ao trocar o tipo declarado de uma encerrada, e a frase manda reabrir", async () => {
    const id = await abrir("troca-encerrada");
    await encerrarNoBanco(id);

    const { status, body } = await trocar(id, "ROTA");

    expect(status).toBe(409);
    expect(body.codigo).toBe("COMPETENCIA_ENCERRADA");
    expect(body.error).toContain("Reabra");
  });

  it("409 quando a outra operação da mesma quinzena já existe, e diz qual", async () => {
    const empurrada = await abrir("ocupado");
    const { body: rota } = await pedir("/fechamento/competencias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ano: 2026,
        mes: 7,
        quinzena: 1,
        unidade: { ...UNIDADE, codigo: `${UNIDADE.codigo}-ocupado` },
        transportadora: TRANSPORTADORA,
        tipoDeOperacao: "ROTA",
      }),
    });

    const { status, body } = await trocar(rota.id, "EMPURRADA");

    expect(status).toBe(409);
    expect(body.codigo).toBe("TIPO_DE_OPERACAO_EM_USO");
    expect(body.detalhe).toEqual({ competenciaId: empurrada });
  });

  /*
    O 400 que não sai desta rota: `TipoDeOperacaoAusente` sobe do domínio e é o
    handler compartilhado que o numera. Sem ele, o pedido sem tipo viraria 500 —
    e quem opera leria "erro interno" a respeito de um campo que ele esqueceu.
  */
  it("400 sem tipo, e 400 pedindo o carimbo do backfill de volta", async () => {
    const id = await abrir("sem-tipo");

    for (const tipo of ["", "   ", "NAO_INFORMADO", undefined, 7]) {
      const { status } = await trocar(id, tipo);
      expect(status, `tipo ${JSON.stringify(tipo)}`).toBe(400);
    }
  });

  it("404 para a competência que não existe, e 400 para o id que não é um", async () => {
    const inexistente = await trocar("00000000-0000-0000-0000-000000000000", "ROTA");
    expect(inexistente.status).toBe(404);

    const malformado = await trocar("nao-e-uuid", "ROTA");
    expect(malformado.status).toBe(400);
  });
});
