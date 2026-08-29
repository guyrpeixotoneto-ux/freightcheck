import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * O que este teste protege: `modelo` é configuração, `modeloProvider` é prova.
 *
 * Antes desta separação, um gate de auditoria não conseguia distinguir "pedi
 * claude-opus-5" de "claude-opus-5 respondeu": os dois campos que a API expunha
 * (`capabilities.modelo` e `tecnico.ia.modelo`) saíam da mesma constante local,
 * e continuavam iguais com a chamada falhando, com a chave ausente e com um
 * `ASSISTENTE_MODELO` apontando para um modelo que não existe.
 *
 * `modeloProvider` sai de `response.model` — o que a Anthropic devolveu. Ele é
 * `null` exatamente quando não houve resposta, que é o caso em que ninguém pode
 * afirmar qual modelo serviu.
 */

const criar = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    beta = { messages: { create: criar } };
  },
}));

const dossieVazio = {
  pergunta: "quanto foi o impacto?",
  trechos: [],
  book: [],
  numeros: [],
  evidencias: [],
  lacunas: [],
  documentos: [],
  anexos: [],
  plano: { intencao: "MOVIMENTO" },
} as never;

beforeEach(() => {
  criar.mockReset();
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-de-teste");
  vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("modeloProvider", () => {
  it("grava o modelo que o provedor devolveu, e não o configurado", async () => {
    const { redigir } = await import("../llm");
    criar.mockResolvedValue({
      // Deliberadamente diferente da constante local: é assim que o teste
      // falharia se alguém voltasse a copiar MODELO para este campo.
      model: "claude-opus-5-20260101",
      stop_reason: "end_turn",
      usage: { input_tokens: 120, output_tokens: 45 },
      content: [{ type: "text", text: "O impacto foi apurado." }],
    });

    const { medicao } = await redigir({ pergunta: "quanto?", dossie: dossieVazio });

    expect(medicao.modeloProvider).toBe("claude-opus-5-20260101");
    expect(medicao.modelo).not.toBe(medicao.modeloProvider);
    expect(medicao.desfecho).toBe("IA");
    expect(medicao.origemDosTokens).toBe("usage");
  });

  it("deixa null quando a chamada falha — ninguém pode afirmar o modelo servido", async () => {
    const { redigir } = await import("../llm");
    criar.mockRejectedValue(new Error("401 authentication_error"));

    const { medicao } = await redigir({ pergunta: "quanto?", dossie: dossieVazio });

    expect(medicao.modeloProvider).toBeNull();
    expect(medicao.desfecho).toBe("ERRO");
    expect(medicao.origemDosTokens).toBe("estimativa");
  });

  it("deixa null quando não há chave — nenhuma chamada acontece", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    const { redigir } = await import("../llm");

    const { medicao } = await redigir({ pergunta: "quanto?", dossie: dossieVazio });

    expect(medicao.modeloProvider).toBeNull();
    expect(medicao.desfecho).toBe("SEM_CHAVE");
    expect(criar).not.toHaveBeenCalled();
  });
});
