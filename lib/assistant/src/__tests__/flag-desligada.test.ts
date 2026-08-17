/**
 * Com a flag desligada, o produto é o de antes.
 *
 * É a promessa que sustenta a migração inteira: enquanto `ASSISTENTE_AGENTE`
 * não for `1`, o agente pode existir, ser importado e ser testado sem que
 * ninguém em produção o encontre. Uma promessa dessas não se cumpre por
 * inspeção — o caminho novo está a um `if` do antigo, e um `if` invertido não
 * quebra nenhum outro teste desta suíte.
 *
 * Aqui ela é verificada onde ela pode falhar de verdade: `investigar` é
 * espionado, e `responder` roda o caminho completo contra o banco. Se a flag
 * desligada chamar o agente uma única vez, este arquivo fica vermelho.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Database } from "@workspace/db";

const espiao = vi.hoisted(() => vi.fn());

vi.mock("../agente", async (original) => {
  const real = await original<typeof import("../agente")>();
  return {
    ...real,
    investigar: (...args: Parameters<typeof real.investigar>) => {
      espiao(...args);
      return real.investigar(...args);
    },
  };
});

const { responder } = await import("../resposta");

const url = process.env.ASSISTANT_EVAL_DATABASE_URL ?? process.env.DATABASE_URL;
const comBanco = url ? describe : describe.skip;

comBanco("a flag desligada não deixa o agente rodar", () => {
  let db: Database;
  let antes: string | undefined;

  beforeEach(() => {
    db = createDb(url!).db;
    antes = process.env.ASSISTENTE_AGENTE;
    delete process.env.ASSISTENTE_AGENTE;
    espiao.mockClear();
  });

  afterEach(() => {
    if (antes === undefined) delete process.env.ASSISTENTE_AGENTE;
    else process.env.ASSISTENTE_AGENTE = antes;
  });

  it("responder não chama investigar", async () => {
    await responder(db, "o que mudou?");
    expect(espiao).not.toHaveBeenCalled();
  });

  it("a resposta continua vindo do planejador, com as consultas de sempre", async () => {
    const r = await responder(db, "o que mudou?");

    // `resumoDaVigencia` é a consulta que o planejador escolhe para MOVIMENTO.
    // Se o agente tivesse rodado, o nome no log seria o da ferramenta.
    expect(r.tecnico.ferramentas).toContain("resumoDaVigencia");
    expect(r.tecnico.ferramentas.some((f) => f.startsWith("alteracoes"))).toBe(false);
  });

  it("duas chamadas seguidas produzem o mesmo texto — o caminho continua determinístico", async () => {
    const a = await responder(db, "o que mudou?", { semIa: true });
    const b = await responder(db, "o que mudou?", { semIa: true });

    expect(a.texto).toBe(b.texto);
    expect(a.tecnico.ferramentas).toEqual(b.tecnico.ferramentas);
    expect(espiao).not.toHaveBeenCalled();
  });
});
