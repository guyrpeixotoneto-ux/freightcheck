import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { createDb, encerrarPoolDoProcesso } from "@workspace/db";
import { erroEmJson } from "../../middlewares/contrato-json";

/**
 * `POST /fechamento/documentos/:id/reimportar` — a porta do conserto.
 *
 * O que ela conserta é provado sem HTTP em `lib/fechamento`: que a leitura é
 * refeita sobre os bytes guardados, que o documento é o mesmo, que a quarentena
 * continua valendo. O que só existe aqui, e é o que decide se quem opera vê
 * "deu certo" ou uma tela em branco:
 *
 * 1. **`200` é ter voltado a valer, e `202` é ter ido para a quarentena.** São
 *    dois `ok` para o `fetch`, e tratá-los igual foi o que já fez alguém subir
 *    o 03.08.20, não ver aviso nenhum e concluir que estava importado.
 * 2. **A recusa vira número por classe** — `404` quando o documento não existe,
 *    `409` quando existe e o estado impede.
 *
 * O arquivo é o 03.08.20 real da 1ª quinzena, o mesmo do caso relatado: 14
 * linhas lidas, das quais **10 são verba**.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;
let nomeDoBanco: string;

/**
 * A amostra do 03.08.20 real vive no pacote que a lê — `lib/fechamento` — e é
 * dado de teste, não módulo: não tem export por onde importá-la. A raiz do
 * workspace é achada subindo até o `pnpm-workspace.yaml`, e não por uma
 * corrente de `..`, que quebra calada quando o arquivo muda de pasta.
 */
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

async function pedir(
  caminho: string,
  init?: RequestInit,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${caminho}`, init);
  return { status: res.status, body: await res.json().catch(() => null) };
}

/**
 * A competência da 1ª quinzena de julho/2026 — o período que o arquivo declara.
 *
 * Cada caso abre a **sua**, variando a unidade: a competência é a trinca
 * (unidade, transportadora, chave), e o índice `(competência, sha256)` recusaria
 * o segundo envio do mesmo arquivo se dois casos dividissem a mesma. O período
 * não pode variar — `recusarPagamentoDeOutroPeriodo` recusaria qualquer outro
 * mês, e o teste passaria a medir aquela recusa.
 */
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

async function enviarPagamento(
  competenciaId: string,
  conteudo: Buffer,
  nome = "03.08.20_1Q_JUL.txt",
): Promise<{ status: number; body: any }> {
  return pedir(`/fechamento/competencias/${competenciaId}/documentos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tipo: "PAGAMENTO",
      filename: nome,
      contentBase64: conteudo.toString("base64"),
    }),
  });
}

async function documentoDoPagamento(competenciaId: string): Promise<any> {
  const { body } = await pedir(`/fechamento/competencias/${competenciaId}`);
  return body.documentos.find((d: any) => d.tipo === "PAGAMENTO" && d.vigente);
}

beforeAll(async () => {
  ctx = await createTestDatabase("api_fechamento_reimportar");
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
  /*
    O pool do processo — o que a rota usa — sai antes do banco: `drop()` sozinho
    falha com "is being accessed by other users", porque quem está acessando é
    o `db` que o próprio módulo da rota abriu.
  */
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

describe("POST /fechamento/documentos/:id/reimportar", () => {
  it("200 e as dez verbas de volta, sem nada ser reenviado", async () => {
    const competenciaId = await abrirCompetencia("volta");
    const enviado = await enviarPagamento(competenciaId, readFileSync(ARQUIVO));
    expect(enviado.status).toBe(201);
    expect(enviado.body.linhasLidas).toBe(14);

    /* O estado relatado da tela: o documento vigente sem as verbas dele. */
    await ctx.pool.query("delete from fechamento_pagamento_item where documento_id = $1", [
      enviado.body.id,
    ]);
    expect(await documentoDoPagamento(competenciaId)).toMatchObject({ verbas: 0 });
    /* E o painel da planilha, um cartão abaixo, sem de onde sair — que é o
       sintoma pelo qual quem opera percebe o problema. */
    const semPainel = await pedir(`/fechamento/competencias/${competenciaId}/de-para?canal=ROTA`);
    expect(semPainel.status).toBe(404);

    const refeito = await pedir(`/fechamento/documentos/${enviado.body.id}/reimportar`, {
      method: "POST",
    });
    expect(refeito.status).toBe(200);
    expect(refeito.body).toMatchObject({ id: enviado.body.id, desfecho: "PROMOVIDO" });
    expect(await documentoDoPagamento(competenciaId)).toMatchObject({ verbas: 10 });

    const painel = await pedir(`/fechamento/competencias/${competenciaId}/de-para?canal=ROTA`);
    expect(painel.status).toBe(200);
    expect(painel.body.painel.quadros.length).toBeGreaterThan(0);
  }, 120_000);

  it("202 quando a releitura manda o arquivo para a quarentena", async () => {
    /* Reimportar refaz a leitura; não a perdoa. O `202` é `ok` para o `fetch` e
       não é sucesso — é a mesma distinção que o envio faz. */
    const competenciaId = await abrirCompetencia("quarentena");
    const truncado = Buffer.from(
      readFileSync(ARQUIVO)
        .toString("latin1")
        .split(/\r?\n/)
        .map((l) => {
          const m = /^(\s*\d{1,3}\s*-\s*.+?\s{2,})((?:-?[\d.]+,\d{2}\s+){5})(-?[\d.]+,\d{2})\s*$/.exec(l);
          return m ? `${m[1]}${m[2]!.trimEnd()}` : l;
        })
        .join("\r\n"),
      "latin1",
    );
    const enviado = await enviarPagamento(competenciaId, truncado, "03.08.20 (truncado).txt");
    expect(enviado.status).toBe(202);

    const refeito = await pedir(`/fechamento/documentos/${enviado.body.id}/reimportar`, {
      method: "POST",
    });
    expect(refeito.status).toBe(202);
    expect(refeito.body.desfecho).toBe("EM_QUARENTENA");
    expect(refeito.body.motivoDaQuarentena).toContain("nenhuma verba");
  }, 120_000);

  it("400 no identificador que não é uuid, 404 no documento que não existe", async () => {
    expect((await pedir("/fechamento/documentos/nada/reimportar", { method: "POST" })).status).toBe(
      400,
    );
    const inexistente = await pedir(
      "/fechamento/documentos/11111111-1111-1111-1111-111111111111/reimportar",
      { method: "POST" },
    );
    expect(inexistente.status).toBe(404);
    expect(inexistente.body.codigo).toBe("DOCUMENTO_NAO_ENCONTRADO");
  }, 120_000);

  it("409 na competência encerrada, com a reabertura na frase", async () => {
    const competenciaId = await abrirCompetencia("encerrada");
    const enviado = await enviarPagamento(competenciaId, readFileSync(ARQUIVO));
    await ctx.pool.query("update fechamento_competencia set estado = 'ENCERRADA' where id = $1", [
      competenciaId,
    ]);

    const recusa = await pedir(`/fechamento/documentos/${enviado.body.id}/reimportar`, {
      method: "POST",
    });
    expect(recusa.status).toBe(409);
    expect(recusa.body.codigo).toBe("COMPETENCIA_ENCERRADA");
    expect(recusa.body.error).toContain("Reabra-a");
  }, 120_000);
});
