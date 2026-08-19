import { beforeEach, describe, expect, it, vi } from "vitest";
import { alertar, zerarJanelaDeAlertas } from "../alerta";

/**
 * O alerta operacional mínimo — as três propriedades que o tornam confiável.
 *
 * 1. Com webhook, o evento chega com um `text` legível (o formato que
 *    Slack/Teams aceitam sem adaptador) e o código estável do tipo.
 * 2. Uma tempestade não vira uma tempestade: um por tipo por janela, os demais
 *    contados e ditos no próximo.
 * 3. O alerta nunca lança — um aviso que derruba o fluxo que o emitiu seria o
 *    segundo incidente.
 */

beforeEach(() => {
  zerarJanelaDeAlertas();
  process.env["ALERTA_WEBHOOK_URL"] = "https://alerta.exemplo/webhook";
});

describe("alertar", () => {
  it("envia o evento com text legível e o código do tipo", async () => {
    const enviados: { url: string; corpo: unknown }[] = [];
    await alertar(
      { tipo: "BACKUP_FALHOU", resumo: "O backup automático falhou." },
      async (url, corpo) => {
        enviados.push({ url, corpo });
      },
    );

    expect(enviados).toHaveLength(1);
    const corpo = enviados[0].corpo as { text: string; tipo: string };
    expect(corpo.tipo).toBe("BACKUP_FALHOU");
    expect(corpo.text).toContain("FreightCheck");
    expect(corpo.text).toContain("O backup automático falhou.");
  });

  it("suprime repetições do mesmo tipo na janela, e conta o que suprimiu", async () => {
    const enviar = vi.fn(async () => {});
    for (let i = 0; i < 5; i++) {
      await alertar({ tipo: "HTTP_500", resumo: `500 em GET /x (${i})` }, enviar);
    }
    // Tipos diferentes não competem pela mesma janela.
    await alertar({ tipo: "MIGRATION_FALHOU", resumo: "outra coisa" }, enviar);

    expect(enviar).toHaveBeenCalledTimes(2);
  });

  it("nunca lança — nem quando o webhook falha", async () => {
    await expect(
      alertar({ tipo: "HTTP_500", resumo: "x" }, async () => {
        throw new Error("webhook fora");
      }),
    ).resolves.toBeUndefined();
  });

  it("sem webhook configurado, só o log responde — e também não lança", async () => {
    delete process.env["ALERTA_WEBHOOK_URL"];
    const enviar = vi.fn(async () => {});
    await alertar({ tipo: "RECONVERGENCIA_INCOMPLETA", resumo: "x" }, enviar);
    expect(enviar).not.toHaveBeenCalled();
  });
});
