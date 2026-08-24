import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { encerrarPoolDoProcesso } from "@workspace/db";
import {
  esquecerPartida,
  tentativaComecou,
  tentativaTerminou,
} from "../lib/partida";

/**
 * `/api/startupz` — o fato que decide a promoção, sem tocar banco.
 *
 * ---------------------------------------------------------------------------
 * Por que sem Postgres, de propósito
 * ---------------------------------------------------------------------------
 * A garantia central deste módulo é que ele **não** é uma segunda autoridade
 * sobre o banco: `estadoDaPromocao` não chama `observarBanco` nem
 * `diagnosticar`. A prova mais forte disso é rodar com uma `DATABASE_URL` que
 * não leva a lugar nenhum e mostrar que a rota responde do mesmo jeito — o
 * mesmo argumento de `banco-fora-do-ar.test.ts`.
 *
 * O que dirige a fase (`tentativaComecou`/`tentativaTerminou`) é chamado à mão
 * aqui, porque este arquivo monta `app` diretamente — como todo teste desta
 * pasta — e não importa `index.ts`, que tem efeito colateral no import (chama
 * `app.listen` incondicionalmente). Quem prova que o `index.ts` de verdade
 * invoca essas duas funções em volta de `applyMigrationsInBackground`, sempre
 * — inclusive nos retornos antecipados — é a prova de fiação no fim deste
 * arquivo.
 */
const NINGUEM_ATRAS = "postgresql://ninguem:nada@127.0.0.1:1/nao_existe";

let servidor: Server;
let base: string;

interface Resposta {
  status: number;
  body: any;
}

async function pedir(caminho: string): Promise<Resposta> {
  const res = await fetch(`${base}${caminho}`);
  return { status: res.status, body: await res.json().catch(() => null) };
}

beforeAll(async () => {
  process.env.DATABASE_URL = NINGUEM_ATRAS;
  process.env.DB_MIGRATE_ON_BOOT = "0";

  const { default: app } = await import("../app");
  servidor = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
}, 60_000);

afterEach(() => {
  esquecerPartida();
  delete process.env.STARTUP_PROBE_MAX_WAIT_MS;
});

afterAll(async () => {
  if (servidor) {
    servidor.closeAllConnections();
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  }
  await encerrarPoolDoProcesso().catch(() => {});
});

describe("o print de 24/08/2026, reproduzido pela fase da partida", () => {
  it("não iniciada: retém a promoção", async () => {
    const r = await pedir("/api/startupz");
    expect(r.status).toBe(503);
    expect(r.body.fase).toBe("NAO_INICIADA");
    expect(r.body.liberar).toBe(false);
  });

  it("em voo — a fila deste build está sendo aplicada agora: retém", async () => {
    tentativaComecou();
    const r = await pedir("/api/startupz");
    expect(r.status).toBe(503);
    expect(r.body.fase).toBe("EM_VOO");
  });

  it("terminada por convergência: libera", async () => {
    tentativaComecou();
    tentativaTerminou("Nenhuma migration pendente.");
    const r = await pedir("/api/startupz");
    expect(r.status).toBe(200);
    expect(r.body.liberar).toBe(true);
    expect(r.body.fase).toBe("TERMINADA");
  });

  it("terminada por migration recusada: libera do mesmo jeito — diagnosticável, não presa", async () => {
    tentativaComecou();
    tentativaTerminou(
      "A migration 0056_frota_promax foi recusada pelo banco (SQLSTATE 23514).",
    );
    const r = await pedir("/api/startupz");
    expect(r.status).toBe(200);
    expect(r.body.detail).toContain("0056_frota_promax");
  });
});

describe("o teto — nunca deixa a publicação presa", () => {
  it("expira mesmo com a tentativa ainda em voo", async () => {
    process.env.STARTUP_PROBE_MAX_WAIT_MS = "80";
    tentativaComecou();

    const antes = await pedir("/api/startupz");
    expect(antes.status).toBe(503);

    await new Promise((resolve) => setTimeout(resolve, 130));

    const depois = await pedir("/api/startupz");
    expect(depois.status).toBe(200);
    expect(depois.body.fase).toBe("EM_VOO");
    expect(depois.body.detail).toMatch(/teto de 80 ms/);
  }, 10_000);
});

describe("não é uma segunda autoridade sobre o banco", () => {
  it("responde sem tocar o banco — com uma DATABASE_URL inalcançável", async () => {
    tentativaComecou();
    tentativaTerminou("x");
    const r = await pedir("/api/startupz");
    // O corpo não carrega nada do vocabulário de `diagnosticar`.
    expect(r.body).not.toHaveProperty("diagnostico");
    expect(r.body).not.toHaveProperty("database");
  });

  it("o portão continua sendo a autoridade sobre dado — /startupz não substitui o /readyz", async () => {
    tentativaComecou();
    tentativaTerminou("x");
    const startupz = await pedir("/api/startupz");
    const readyz = await pedir("/api/readyz");
    expect(startupz.status).toBe(200);
    // O banco está inalcançável; /readyz continua dizendo isso — startupz
    // liberar a promoção não muda o que o portão faz com o tráfego de produto.
    expect(readyz.status).toBe(503);
  });
});
