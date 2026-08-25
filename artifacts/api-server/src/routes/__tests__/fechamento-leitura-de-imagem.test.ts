import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import express from "express";
import { erroEmJson } from "../../middlewares/contrato-json";

/**
 * `POST /fechamento/documentos/leitura-de-imagem` — a tela do Promax
 * fotografada, transcrita sem catálogo.
 *
 * A leitura em si é provada sem HTTP em `lib/assistant`
 * (`grade-por-imagem.test.ts`). O que se protege aqui é o que só existe
 * nesta fronteira:
 *
 * 1. **A rota não escreve.** Ela devolve o que a imagem mostra; nenhum
 *    documento é gravado, ao contrário de `POST .../documentos`.
 * 2. **Só as duas fontes da frota Promax entram.** É a única tela cuja forma
 *    é esta grade por categoria — as outras cinco fontes não têm este botão.
 * 3. **O corpo é conferido antes da chamada.** Um `tipo` fora da lista, ou
 *    uma imagem ausente, é 400 aqui — não uma chamada de modelo gasta para
 *    descobrir isso lá.
 */

const { ler } = vi.hoisted(() => ({ ler: vi.fn() }));

vi.mock("@workspace/assistant", async (original) => {
  const real = await original<typeof import("@workspace/assistant")>();
  return { ...real, lerGradeDaImagem: ler };
});

let servidor: Server;
let base: string;

const CAMINHO = "/fechamento/documentos/leitura-de-imagem";

interface Resposta {
  status: number;
  body: any;
}

async function enviar(corpo: unknown): Promise<Resposta> {
  const res = await fetch(`${base}${CAMINHO}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  return { status: res.status, body: await res.json() };
}

function leitura(parcial: Partial<{ celulas: unknown[] }> = {}) {
  return {
    celulas: [],
    motivo: "IA" as const,
    erro: null,
    modelo: "claude-opus-5",
    ...parcial,
  };
}

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

  const { default: fechamentoRouter } = await import("../fechamento");

  const app = express();
  app.use(express.json({ limit: "64mb" }));
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = { error: () => {}, warn: () => {}, info: () => {} };
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
}, 60_000);

afterAll(async () => {
  if (servidor) {
    servidor.closeAllConnections();
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  }
});

beforeEach(() => {
  ler.mockReset();
  ler.mockResolvedValue(leitura());
});

describe("o corpo que a rota aceita", () => {
  it("recusa um tipo que não é da frota Promax, sem gastar uma chamada", async () => {
    const r = await enviar({ tipo: "PAGAMENTO", imagem: "QUJD", mimeType: "image/png" });

    expect(r.status).toBe(400);
    expect(r.body.error).toContain("FROTA_PROMAX_ATIVA");
    expect(ler).not.toHaveBeenCalled();
  });

  it("recusa o que não é imagem, sem gastar uma chamada", async () => {
    const r = await enviar({
      tipo: "FROTA_PROMAX_ATIVA",
      imagem: "AAAA",
      mimeType: "application/pdf",
    });

    expect(r.status).toBe(400);
    expect(r.body.error).toContain("image/png");
    expect(ler).not.toHaveBeenCalled();
  });

  it("recusa o corpo sem imagem", async () => {
    const r = await enviar({ tipo: "FROTA_PROMAX_ATIVA", mimeType: "image/png" });

    expect(r.status).toBe(400);
    expect(ler).not.toHaveBeenCalled();
  });

  it("aceita o base64 com o prefixo `data:` que o navegador produz", async () => {
    await enviar({
      tipo: "FROTA_PROMAX_ATIVA",
      imagem: "data:image/png;base64,QUJD",
      mimeType: "image/png",
    });

    expect(ler).toHaveBeenCalledTimes(1);
    expect(ler.mock.calls[0]![0].imagem).toEqual({ mimeType: "image/png", dados: "QUJD" });
  });

  it("manda um contexto diferente para a fonte ativa e a inativa", async () => {
    await enviar({ tipo: "FROTA_PROMAX_ATIVA", imagem: "QUJD", mimeType: "image/png" });
    const contextoAtiva = ler.mock.calls[0]![0].contexto;

    ler.mockClear();
    await enviar({ tipo: "FROTA_PROMAX_INATIVA", imagem: "QUJD", mimeType: "image/png" });
    const contextoInativa = ler.mock.calls[0]![0].contexto;

    expect(contextoAtiva).toContain("01.22.02.00");
    expect(contextoInativa).toContain("01.22.08.00");
    expect(contextoAtiva).not.toEqual(contextoInativa);
  });
});

describe("o que a rota repassa", () => {
  it("devolve as células como o leitor as achou, sem tocar nelas", async () => {
    ler.mockResolvedValue(
      leitura({
        celulas: [
          { linha: "Total Veículos", coluna: "Padrão", valor: 23, comoEstaNaImagem: "23" },
        ],
      }),
    );

    const r = await enviar({ tipo: "FROTA_PROMAX_ATIVA", imagem: "QUJD", mimeType: "image/png" });

    expect(r.status).toBe(200);
    expect(r.body.celulas).toEqual([
      { linha: "Total Veículos", coluna: "Padrão", valor: 23, comoEstaNaImagem: "23" },
    ]);
  });

  it("repassa o desfecho sem chave, para a tela poder dizer o que falta", async () => {
    ler.mockResolvedValue({ celulas: [], motivo: "SEM_CHAVE", erro: null, modelo: "claude-opus-5" });

    const r = await enviar({ tipo: "FROTA_PROMAX_ATIVA", imagem: "QUJD", mimeType: "image/png" });

    expect(r.status).toBe(200);
    expect(r.body.motivo).toBe("SEM_CHAVE");
  });
});
