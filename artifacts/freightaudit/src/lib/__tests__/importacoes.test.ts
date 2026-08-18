/**
 * As caras do cartão de upload, uma por estado do pipeline.
 *
 * O defeito que este arquivo fixa foi visto na tela: um run recusado por
 * VALIDATION_ERROR aparecia como "Lendo o arquivo…" com o nome interno do
 * enum vazando embaixo ("validation_error… nada entra sem sua aprovação"),
 * sem o motivo gravado, e com o polling rodando para sempre.
 *
 * A lista abaixo é uma cópia do enum `import_run_status`
 * (lib/db/src/schema/enums.ts), para que um estado criado lá sem cara aqui
 * falhe este teste em vez de vazar cru na tela.
 */
import { describe, expect, it } from "vitest";
import { estadoDaImportacao, faceDoCartao } from "@/lib/importacoes";

const IMPORT_RUN_STATUS = [
  "PENDING",
  "READING",
  "STAGED",
  "PREVIEWED",
  "PROMOTING",
  "PROMOTED",
  "FAILED",
  "ABORTED",
  "SKIPPED_DUPLICATE",
  "SKIPPED_DUPLICATE_DATA",
  "VALIDATION_ERROR",
] as const;

/** Os únicos estados em que o run ainda muda sozinho. */
const EM_ANDAMENTO = new Set(["PENDING", "READING", "STAGED", "PROMOTING"]);

describe("faceDoCartao", () => {
  it("trata a recusa por validação como fim de linha, não como leitura", () => {
    const cara = faceDoCartao("VALIDATION_ERROR");
    expect(cara.face).toBe("recusada");
    expect(cara.emAndamento).toBe(false);
    expect(cara.titulo).toMatch(/não fecha/i);
  });

  it("só continua perguntando ao servidor enquanto o pipeline trabalha", () => {
    for (const status of IMPORT_RUN_STATUS) {
      expect(faceDoCartao(status).emAndamento, status).toBe(
        EM_ANDAMENTO.has(status),
      );
    }
    // Sem resposta ainda não há estado nenhum: continua perguntando.
    expect(faceDoCartao(undefined).emAndamento).toBe(true);
  });

  it("nenhum título vaza o nome interno do enum", () => {
    for (const status of IMPORT_RUN_STATUS) {
      const { titulo } = faceDoCartao(status);
      expect(titulo, status).not.toMatch(/_/);
      expect(titulo, status).not.toContain(status);
    }
  });

  it("duplicata não é erro: cara própria, dizendo que nada entrou de novo", () => {
    expect(faceDoCartao("SKIPPED_DUPLICATE").face).toBe("duplicata");
    expect(faceDoCartao("SKIPPED_DUPLICATE_DATA").face).toBe("duplicata");
  });

  it("todo desfecho sem resumo tem o que dizer quando o run não gravou motivo", () => {
    for (const status of IMPORT_RUN_STATUS) {
      const cara = faceDoCartao(status);
      if (cara.face !== "lendo" && cara.face !== "conferida") {
        expect(cara.motivoPadrao, status).toBeTruthy();
      }
    }
  });

  it("um estado que o cartão não conhece espera, em vez de recusar", () => {
    // O pipeline pode ganhar estados intermediários; o cartão espera e mostra
    // o rótulo de estadoDaImportacao — nunca o nome interno.
    expect(faceDoCartao("REBALANCING").face).toBe("lendo");
    expect(faceDoCartao("REBALANCING").emAndamento).toBe(true);
  });
});

describe("estadoDaImportacao", () => {
  it("nomeia todo estado do pipeline para quem opera", () => {
    for (const status of IMPORT_RUN_STATUS) {
      const estado = estadoDaImportacao(status);
      expect(estado.rotulo, status).not.toMatch(/_/);
    }
  });

  it("um estado desconhecido cai no rótulo minúsculo, em tom de espera", () => {
    expect(estadoDaImportacao("REBALANCING")).toEqual({
      rotulo: "rebalancing",
      tom: "espera",
    });
  });
});
