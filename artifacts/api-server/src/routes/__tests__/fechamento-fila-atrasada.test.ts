import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import express from "express";
import { createDb, encerrarPoolDoProcesso } from "@workspace/db";
import { readMigrations } from "@workspace/db/migrate";
import { erroEmJson } from "../../middlewares/contrato-json";

/**
 * O envio que a fila atrasada recusa — e o que a tela passa a ler.
 *
 * **O caso vivido, 22/08/2026.** A tela do fechamento já oferecia as duas
 * casinhas do 03.08.18 — a `0055` separou `DISPONIBILIDADE_FF` de
 * `DISPONIBILIDADE_VAN` —, o arquivo subiu inteiro, e o banco daquele ambiente
 * ainda aplicava a lista fechada de antes em `fechamento_documento.tipo`. A
 * gravação morreu em `23514` e a tela mostrou **"O servidor falhou ao
 * processar este pedido. Nada foi gravado por esta chamada."**, que é a frase
 * que manda procurar defeito num arquivo perfeito. É o mesmo beco do Book do
 * Operador, uma classe de erro abaixo: lá faltava a tabela e o SQLSTATE dizia;
 * aqui a coluna existe e o que é de antes é a **versão** da regra.
 *
 * Este arquivo monta exatamente aquele estado — código da cabeça da fila,
 * banco parado na `0054` — e trava o que a rota responde nele. Não é um teste
 * de classificação (isso está em `middlewares/__tests__/contrato-json`): é a
 * prova de que a corrente inteira chega lá, do `receberDocumento` ao corpo que
 * a tela lê, com o Postgres de verdade levantando o erro de verdade.
 */

const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const temBanco = Boolean(
  process.env.TEST_ADMIN_DATABASE_URL ?? process.env.DATABASE_URL,
);

/** A última migration antes da que separa o 03.08.18 por frota. */
const ANTES_DA_0055 = "0054_regra_de_alteracao";

const NOME = `fc_test_fila_atrasada_${process.pid}`;

/**
 * O 03.08.18 mínimo que o leitor aceita: as quatro colunas exigidas e a que
 * declara a frota.
 *
 * Ele precisa ser **legível** — um arquivo ilegível pararia antes, na recusa
 * do leitor, e o teste mediria aquela recusa em vez desta. O conteúdo não
 * importa além disso: o que se exercita é a gravação.
 */
function disponibilidadeDe(frota: "FF" | "Van"): Buffer {
  const linhas = [
    ["Data", "Canal", "Contratada", "Desconto Total", "Tipo Frota"],
    ["16/07/2026", "Rota", "8", "300,00", frota],
  ];
  return Buffer.from(linhas.map((l) => l.join(";")).join("\r\n"), "latin1");
}

/** A casinha e a frota que ela admite — a leitura corta por ela, na porta. */
const FROTA_DA_CASINHA = {
  DISPONIBILIDADE_FF: "FF",
  DISPONIBILIDADE_VAN: "Van",
} as const;

let servidor: Server;
let base: string;

async function pedir(
  caminho: string,
  init?: RequestInit,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${caminho}`, init);
  return { status: res.status, body: await res.json().catch(() => null) };
}

beforeAll(async () => {
  if (!temBanco) return;

  const admin = createDb(ADMIN);
  await admin.pool.query(`DROP DATABASE IF EXISTS "${NOME}"`);
  await admin.pool.query(`CREATE DATABASE "${NOME}"`);
  await admin.pool.end();

  const url = ADMIN.replace(/\/[^/?]*(\?|$)/, `/${NOME}$1`);
  const { pool } = createDb(url);
  /*
    A fila **com registro**, e parada na `0054`: é o estado de uma Production
    real que ainda não recebeu a última migration — schema e carimbos
    coerentes. Um banco sem registro seria outro diagnóstico (`REGISTRO_
    PERDIDO`), e não é o que aconteceu.
  */
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
       id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
  );
  for (const m of readMigrations()) {
    for (const comando of m.statements) await pool.query(comando);
    await pool.query(
      `INSERT INTO "drizzle"."__drizzle_migrations" ("hash","created_at") VALUES ($1,$2)`,
      [m.hash, m.when],
    );
    if (m.tag === ANTES_DA_0055) break;
  }
  await pool.end();

  process.env.DATABASE_URL = url;
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
  await encerrarPoolDoProcesso().catch(() => {});
  if (!temBanco) return;
  const admin = createDb(ADMIN);
  await admin.pool.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [NOME],
  );
  await admin.pool.query(`DROP DATABASE IF EXISTS "${NOME}" WITH (FORCE)`);
  await admin.pool.end();
});

describe.skipIf(!temBanco)("o 03.08.18 enviado a um banco parado antes da 0055", () => {
  async function abrirCompetencia(sufixo: string): Promise<string> {
    const { body } = await pedir("/fechamento/competencias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ano: 2026,
        mes: 7,
        quinzena: 1,
        unidade: { codigo: `081-0443-${sufixo}`, nome: "CRBS SA - CDD Belem" },
        transportadora: { codigo: "36", nome: "HORIZONTE LOGISTICA LTDA" },
        tipoDeOperacao: "PROPRIA",
      }),
    });
    return body.id as string;
  }

  const enviar = (competenciaId: string, tipo: keyof typeof FROTA_DA_CASINHA) =>
    pedir(`/fechamento/competencias/${competenciaId}/documentos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tipo,
        /* Cada casinha recebe o arquivo da frota dela: mandar o da outra é
           recusa do leitor, e o teste passaria a medir aquela recusa. */
        filename: `03.08.18_${FROTA_DA_CASINHA[tipo]}.csv`,
        contentBase64: disponibilidadeDe(FROTA_DA_CASINHA[tipo]).toString("base64"),
      }),
    });

  it("responde 503 com o diagnóstico, e não o 500 que manda olhar o arquivo", async () => {
    const { status, body } = await enviar(await abrirCompetencia("ff"), "DISPONIBILIDADE_FF");

    expect(status).toBe(503);
    expect(body.code).toBe("SCHEMA_AUSENTE");
    /*
      A frase que a tela mostrava. Ela não pode voltar por este caminho: era o
      que fazia quem recebeu um arquivo perfeito procurar defeito nele.
    */
    expect(JSON.stringify(body)).not.toMatch(/O servidor falhou ao processar/);
  });

  it("o diagnóstico nomeia a fila, e a ação é a única que resolve", async () => {
    const { body } = await enviar(await abrirCompetencia("van"), "DISPONIBILIDADE_VAN");

    expect(body.diagnostico.estado).toBe("MIGRATIONS_PENDENTES");
    expect(body.diagnostico.acao.codigo).toBe("APLICAR_MIGRATIONS");
    expect(body.diagnostico.acao.comando).toMatch(/run migrate/);
    /* Nada se perdeu — e é isso que a tela precisa poder dizer a quem enviou. */
    expect(body.diagnostico.risco.emRisco).toBe(false);
    expect(body.contexto).toMatch(/nada foi gravado/i);
  });

  it("a fonte que a lista antiga já admitia continua entrando", async () => {
    /*
      O contraponto que impede este caminho de virar "tudo é falta de schema":
      no mesmo banco atrasado, uma fonte cujo nome a `0043` já tinha admitido
      grava normalmente. Foi o que aconteceu de verdade — o 2Art da tela subiu
      com 878 linhas na mesma quinzena em que o 03.08.18 morria.
    */
    const competenciaId = await abrirCompetencia("cte");
    const { status } = await pedir(
      `/fechamento/competencias/${competenciaId}/documentos`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: "CTE",
          filename: "03.08.15.csv",
          contentBase64: Buffer.from("nada", "latin1").toString("base64"),
        }),
      },
    );

    /* Não é 503: o banco tem tudo o que esta fonte precisa. O arquivo é que
       não presta, e a recusa do leitor é a resposta certa para ele. */
    expect(status).not.toBe(503);
    expect(status).not.toBe(500);
  });
});
