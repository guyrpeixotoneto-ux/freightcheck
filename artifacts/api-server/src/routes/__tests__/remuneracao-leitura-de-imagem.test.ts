import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import express from "express";
import { erroEmJson } from "../../middlewares/contrato-json";

/**
 * `POST /remuneracao/planilha/leitura-de-imagem` — a borda entre um modelo e um
 * campo de formulário.
 *
 * A leitura em si é provada sem HTTP em `lib/assistant`. O que se protege aqui
 * é o que só existe nesta fronteira, e que é onde uma leitura torta vira número
 * gravado:
 *
 * 1. **A rota não escreve.** Ela responde o que a imagem diz; quem grava é o
 *    `PUT`, com o "Salvar" de uma pessoa no meio.
 * 2. **A mesma trava do `PUT` roda antes de a tela ver o número.** Um `5,90`
 *    lido como `590` numa alíquota não pode chegar ao campo: ele volta em
 *    `recusadas`, com o motivo escrito, em vez de 400 no clique de salvar —
 *    ou, pior, de um gross-up com divisor errado que atravessa a quinzena.
 * 3. **O corpo é conferido antes da chamada.** Um PDF ou um corpo sem imagem é
 *    400 aqui, e não uma imagem de tokens gasta para descobrir isso lá.
 *
 * Não há banco neste arquivo de propósito: a rota não toca nenhum, e um teste
 * que levanta Postgres para provar isso provaria outra coisa.
 */

const { ler } = vi.hoisted(() => ({ ler: vi.fn() }));

vi.mock("@workspace/assistant", async (original) => {
  const real = await original<typeof import("@workspace/assistant")>();
  return { ...real, lerPlanilhaDaImagem: ler };
});

let servidor: Server;
let base: string;

const CAMINHO = "/remuneracao/planilha/leitura-de-imagem";

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

/** O que o leitor devolveria, com os desfechos de sucesso já preenchidos. */
function leitura(parcial: Partial<{ valores: unknown[]; naoEncontradas: string[] }>) {
  return {
    valores: [],
    naoEncontradas: [],
    motivo: "IA" as const,
    erro: null,
    modelo: "claude-opus-5",
    ...parcial,
  };
}

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

  const { default: remuneracaoRouter } = await import("../remuneracao");

  const app = express();
  app.use(express.json({ limit: "64mb" }));
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    next();
  });
  app.use(remuneracaoRouter);
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
  ler.mockResolvedValue(leitura({}));
});

describe("o corpo que a rota aceita", () => {
  it("recusa o que não é imagem, sem gastar uma chamada", async () => {
    // O PDF é o engano provável: é anexo de aba tanto quanto o print.
    const r = await enviar({ imagem: "AAAA", mimeType: "application/pdf" });

    expect(r.status).toBe(400);
    expect(r.body.error).toContain("image/png");
    expect(ler).not.toHaveBeenCalled();
  });

  it("recusa o corpo sem imagem", async () => {
    const r = await enviar({ mimeType: "image/png" });

    expect(r.status).toBe(400);
    expect(ler).not.toHaveBeenCalled();
  });

  it("aceita o base64 com o prefixo `data:` que o navegador produz", async () => {
    /*
      `reader.result` vem com `data:image/png;base64,` na frente, e cortá-lo é o
      esquecimento de uma linha. A rota corta também — são dois lados de uma
      fronteira, e o que chega nela nunca é só o que a nossa tela manda.
    */
    await enviar({ imagem: "data:image/png;base64,QUJD", mimeType: "image/png" });

    expect(ler).toHaveBeenCalledTimes(1);
    expect(ler.mock.calls[0]![0].imagem).toEqual({ mimeType: "image/png", dados: "QUJD" });
  });

  it("manda o catálogo inteiro, com a faixa de cada linha", async () => {
    /*
      A aba é a mesma para toda unidade — são as trinta linhas do contrato, e
      não um recorte do que aquele `scopeHash` já tem. A faixa vai junto porque
      é ela que desempata os rótulos que a aba repete entre blocos.
    */
    await enviar({ imagem: "QUJD", mimeType: "image/png" });

    const linhas = ler.mock.calls[0]![0].linhas;
    expect(linhas.length).toBeGreaterThanOrEqual(28);
    expect(linhas.every((l: { bloco: string }) => l.bloco !== "")).toBe(true);
    expect(linhas).toContainEqual({
      chave: "aliquota_pis",
      rotulo: "Alíquota PIS no Estado",
      medida: "PERCENTUAL",
      bloco: "ALÍQUOTAS",
    });
  });
});

describe("a trava que roda antes de a tela ver o número", () => {
  it("deixa passar o que a regra da linha aceita", async () => {
    ler.mockResolvedValue(
      leitura({
        valores: [{ chave: "aliquota_pis", valor: 5.9, comoEstaNaImagem: "5,90%" }],
      }),
    );

    const r = await enviar({ imagem: "QUJD", mimeType: "image/png" });

    expect(r.status).toBe(200);
    expect(r.body.valores).toEqual([
      { chave: "aliquota_pis", valor: 5.9, comoEstaNaImagem: "5,90%" },
    ]);
    expect(r.body.recusadas).toEqual([]);
  });

  it("segura a alíquota lida como 590 e diz por quê, em vez de 500", async () => {
    /*
      Este é **o** erro que a foto produz: a vírgula lida ao contrário. Ele não
      tem sintoma visível — vira um gross-up com divisor errado que atravessa a
      quinzena inteira parecendo apurado. Parar aqui, com o texto da célula ao
      lado, é o que permite a quem confere ver o que aconteceu.
    */
    ler.mockResolvedValue(
      leitura({
        valores: [
          { chave: "aliquota_pis", valor: 590, comoEstaNaImagem: "5,90%" },
          { chave: "frota_fixa_ativos", valor: 42, comoEstaNaImagem: "42" },
        ],
      }),
    );

    const r = await enviar({ imagem: "QUJD", mimeType: "image/png" });

    expect(r.status).toBe(200);
    expect(r.body.valores.map((v: { chave: string }) => v.chave)).toEqual(["frota_fixa_ativos"]);
    expect(r.body.recusadas).toHaveLength(1);
    expect(r.body.recusadas[0].chave).toBe("aliquota_pis");
    expect(r.body.recusadas[0].comoEstaNaImagem).toBe("5,90%");
    expect(r.body.recusadas[0].motivo).toContain("percentual");
  });

  it("segura a contagem quebrada, que é a mesma vírgula em outro campo", async () => {
    ler.mockResolvedValue(
      leitura({
        valores: [{ chave: "frota_fixa_ativos", valor: 42.5, comoEstaNaImagem: "42,5" }],
      }),
    );

    const r = await enviar({ imagem: "QUJD", mimeType: "image/png" });

    expect(r.status).toBe(200);
    expect(r.body.valores).toEqual([]);
    expect(r.body.recusadas[0].chave).toBe("frota_fixa_ativos");
  });

  it("repassa a lacuna nomeada, que é o que impede lê-la como zero", async () => {
    ler.mockResolvedValue(leitura({ naoEncontradas: ["van_custo_fixo"] }));

    const r = await enviar({ imagem: "QUJD", mimeType: "image/png" });

    expect(r.body.naoEncontradas).toEqual(["van_custo_fixo"]);
  });

  it("repassa o desfecho sem chave, para a tela poder dizer o que falta", async () => {
    ler.mockResolvedValue({
      valores: [],
      naoEncontradas: [],
      motivo: "SEM_CHAVE",
      erro: null,
      modelo: "claude-opus-5",
    });

    const r = await enviar({ imagem: "QUJD", mimeType: "image/png" });

    expect(r.status).toBe(200);
    expect(r.body.motivo).toBe("SEM_CHAVE");
  });
});
