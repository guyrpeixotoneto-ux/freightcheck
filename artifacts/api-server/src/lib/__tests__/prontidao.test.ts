/**
 * Quando este processo pode receber tráfego de produto — e quando não pode.
 *
 * A prova ponta a ponta, com Postgres e o app inteiro, está em
 * `src/__tests__/janela-da-partida.test.ts`. Aqui se fixa a **decisão**: quais
 * estados do banco fecham o portão, quais deliberadamente não fecham, e as
 * duas propriedades que fazem dele algo que dá para deixar num caminho quente
 * — não custa nada depois de convergir, e não vira enxurrada de consultas
 * enquanto está fechado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { EstadoObservado } from "@workspace/db/diagnostico";

const observarBanco = vi.hoisted(() => vi.fn<() => Promise<EstadoObservado>>());

vi.mock("../migrations", async (original) => ({
  ...(await original<typeof import("../migrations")>()),
  observarBanco,
}));

const { estadoDaProntidao, esquecerProntidao } = await import("../prontidao");
const { portaoDeProntidao, CODIGO_NAO_PRONTO } = await import(
  "../../middlewares/portao-de-prontidao"
);

/** Um banco em dia. */
const EM_DIA: EstadoObservado = {
  configurada: true,
  alcancavel: true,
  aplicadas: 56,
  pendentes: [],
  temSchema: true,
};

/** A fila atrasada — o estado de 22/08/2026. */
const ATRASADO: EstadoObservado = {
  configurada: true,
  alcancavel: true,
  aplicadas: 55,
  pendentes: ["0055_disponibilidade_por_frota"],
  temSchema: true,
};

beforeEach(() => {
  observarBanco.mockReset();
  esquecerProntidao();
});
afterEach(() => vi.restoreAllMocks());

describe("o que fecha o portão", () => {
  it("a fila deste build não aplicada aqui", async () => {
    observarBanco.mockResolvedValue(ATRASADO);

    const estado = await estadoDaProntidao();

    expect(estado.pronto).toBe(false);
    expect(estado.pronto === false && estado.diagnostico.estado).toBe(
      "MIGRATIONS_PENDENTES",
    );
  });

  it("uma migration que falhou — rodar de novo não é a resposta, servir também não", async () => {
    observarBanco.mockResolvedValue({
      ...ATRASADO,
      falha: { tag: "0055_disponibilidade_por_frota", code: "42P01" },
    });

    const estado = await estadoDaProntidao();

    expect(estado.pronto).toBe(false);
    expect(estado.pronto === false && estado.diagnostico.estado).toBe(
      "MIGRATION_FALHOU",
    );
  });

  it("o registro perdido — a fila não consegue nem começar", async () => {
    observarBanco.mockResolvedValue({
      configurada: true,
      alcancavel: true,
      aplicadas: 0,
      pendentes: ["0000_freightcheck_foundation"],
      temSchema: true,
    });

    const estado = await estadoDaProntidao();

    expect(estado.pronto).toBe(false);
    expect(estado.pronto === false && estado.diagnostico.estado).toBe(
      "REGISTRO_PERDIDO",
    );
  });
});

describe("o que deliberadamente não fecha o portão", () => {
  it("um banco em dia", async () => {
    observarBanco.mockResolvedValue(EM_DIA);

    expect((await estadoDaProntidao()).pronto).toBe(true);
  });

  it("schema divergente — a resposta proporcional é da rota que esbarra nele", async () => {
    /*
      Registro completo, e falta um objeto nomeado. Derrubar o produto inteiro
      por causa de uma coluna seria trocar um problema circunscrito por
      indisponibilidade total — e existe resposta circunscrita: o 503 de
      `faltaSchema`, na rota que a lê.
    */
    observarBanco.mockResolvedValue({
      ...EM_DIA,
      objetosAusentes: ["attribute.cost_class"],
    });

    expect((await estadoDaProntidao()).pronto).toBe(true);
  });

  it("bridge pendente — mesma razão, mesmo tamanho", async () => {
    observarBanco.mockResolvedValue({
      ...EM_DIA,
      bridgePendente: { desde: "2026-08-16" },
    });

    expect((await estadoDaProntidao()).pronto).toBe(true);
  });

  it("banco fora — fechar trocaria o erro real por um que esconde a causa", async () => {
    /*
      Com o banco inalcançável, cada chamada já falha dizendo o que houve, e é
      isso que a plataforma precisa ver. Fechar o portão faria uma queda de
      segundos travar o processo inteiro, e pelo motivo errado.
    */
    observarBanco.mockResolvedValue({
      configurada: true,
      alcancavel: false,
      codigoDeConexao: "ECONNREFUSED",
      aplicadas: 0,
      pendentes: [],
    });

    expect((await estadoDaProntidao()).pronto).toBe(true);
  });
});

describe("as duas propriedades que o deixam num caminho quente", () => {
  it("convergiu uma vez, e não se pergunta mais", async () => {
    observarBanco.mockResolvedValue(EM_DIA);

    await estadoDaProntidao();
    await estadoDaProntidao();
    await estadoDaProntidao();

    expect(observarBanco).toHaveBeenCalledTimes(1);
  });

  it("fechado, as leituras concorrentes dividem uma observação só", async () => {
    /*
      Sem isto, um processo travado por migration que falhou viraria um
      amplificador de carga: cada requisição abriria a sua rodada de consultas
      contra um banco que já está em incidente.
    */
    observarBanco.mockResolvedValue(ATRASADO);

    const juntas = await Promise.all([
      estadoDaProntidao(),
      estadoDaProntidao(),
      estadoDaProntidao(),
    ]);

    expect(juntas.every((e) => !e.pronto)).toBe(true);
    expect(observarBanco).toHaveBeenCalledTimes(1);
  });

  it("e volta a medir na próxima, porque o banco pode ter convergido", async () => {
    observarBanco.mockResolvedValueOnce(ATRASADO);
    expect((await estadoDaProntidao()).pronto).toBe(false);

    /* Outra instância — ou uma pessoa — aplicou a fila. Ninguém reinicia nada. */
    observarBanco.mockResolvedValueOnce(EM_DIA);
    expect((await estadoDaProntidao()).pronto).toBe(true);
  });
});

describe("o portão, como middleware", () => {
  let servidor: Server;
  let base: string;

  beforeEach(async () => {
    const app = express();
    app.use((req, _res, next) => {
      Object.assign(req, {
        log: { warn: () => {}, error: () => {}, info: () => {} },
        id: "req-de-teste",
      });
      next();
    });
    app.use("/api", portaoDeProntidao);
    app.get("/api/healthz", (_req, res) => void res.json({ ok: true }));
    app.get("/api/produto", (_req, res) => void res.json({ chegou: true }));
    app.use(((erro: Error, _req: never, res: any, _next: never) => {
      res.status(500).json({ code: "ERRO_INTERNO", erro: erro.message });
    }) as never);

    servidor = await new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });

  afterEach(
    () =>
      new Promise<void>((resolve) => {
        servidor.close(() => resolve());
      }),
  );

  it("recusa a rota de produto com 503, Retry-After e o diagnóstico", async () => {
    observarBanco.mockResolvedValue(ATRASADO);

    const res = await fetch(`${base}/api/produto`);
    const corpo = (await res.json()) as Record<string, any>;

    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("5");
    expect(corpo["code"]).toBe(CODIGO_NAO_PRONTO);
    expect(corpo["diagnostico"].estado).toBe("MIGRATIONS_PENDENTES");
    /* A rota não recomenda: quem recomenda é o diagnóstico. */
    expect(corpo["contexto"]).not.toMatch(/pnpm|reinici/i);
  });

  it("deixa passar o que existe para diagnosticar o próprio portão", async () => {
    observarBanco.mockResolvedValue(ATRASADO);

    /* Fechar o `/healthz` faria o deployment nunca subir — é para lá que o
       startup probe aponta. */
    expect((await fetch(`${base}/api/healthz`)).status).toBe(200);
    /* E uma barra final não pode ser a diferença entre publicar e não
       publicar: um probe configurado com ela cairia fora da lista. */
    expect((await fetch(`${base}/api/healthz/`)).status).toBe(200);
  });

  it("com o banco em dia, a rota de produto é executada", async () => {
    observarBanco.mockResolvedValue(EM_DIA);

    const res = await fetch(`${base}/api/produto`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ chegou: true });
  });

  it("medir falhando é defeito nosso, e não 'não pronto'", async () => {
    /*
      Um erro ao observar vai para o contrato de erro, que responde 500 com
      `requestId`. Tratá-lo como "não pronto" faria um defeito de código
      parecer banco atrasado, e mandaria alguém rodar migrations.
    */
    observarBanco.mockRejectedValue(new TypeError("x is not a function"));

    const res = await fetch(`${base}/api/produto`);

    expect(res.status).toBe(500);
    const corpo = (await res.json()) as Record<string, unknown>;
    expect(corpo["code"]).toBe("ERRO_INTERNO");
  });
});
