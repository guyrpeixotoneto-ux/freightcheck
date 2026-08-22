import { describe, expect, it } from "vitest";
import { enderecoDoAssistente } from "../entrada-do-assistente";
import { completarRecorte, type ContextoDisponivel } from "@/components/assistente/recorte";

/**
 * ETAPA 0, item 2 — o recorte atravessa o link de entrada.
 *
 * O que se prova aqui é pequeno e é a metade que faltava: enquanto o endereço
 * do Assistente fosse `/assistente` nu, escolher a unidade na tela dele não
 * ajudava quem chegava pela barra lateral — a conversa abria no padrão do
 * banco, que é a unidade da importação mais recente.
 */
describe("o endereço do Assistente carrega o recorte de onde se clica", () => {
  it("leva unidade, canal e vigência", () => {
    expect(enderecoDoAssistente("?scopeHash=abc&canal=EMPURRADA&period=2026-08-01")).toBe(
      "/assistente?scopeHash=abc&canal=EMPURRADA&period=2026-08-01",
    );
  });

  it("funciona com ou sem a interrogação", () => {
    expect(enderecoDoAssistente("scopeHash=abc")).toBe("/assistente?scopeHash=abc");
  });

  it("sem recorte na origem, o endereço fica nu — e não inventa parâmetro", () => {
    expect(enderecoDoAssistente("")).toBe("/assistente");
    expect(enderecoDoAssistente("?aba=composicao&placa=ABC1D23")).toBe("/assistente");
  });

  /*
    A asserção que impede a cópia preguiçosa da query inteira: um filtro da tela
    de origem não pode virar um pedido que o Assistente não sabe ler.
  */
  it("só os três parâmetros do recorte atravessam", () => {
    const url = enderecoDoAssistente("?scopeHash=abc&atributo=cavalo.ipva&aba=linhas");
    expect(url).toContain("scopeHash=abc");
    expect(url).not.toContain("atributo");
    expect(url).not.toContain("aba");
  });

  it("valores vazios não viram parâmetro", () => {
    expect(enderecoDoAssistente("?scopeHash=&canal=")).toBe("/assistente");
  });
});

describe("o recorte escolhido se ajusta ao que a unidade tem", () => {
  const contextos: ContextoDisponivel[] = [
    {
      scopeHash: "uber",
      channel: "EMPURRADA",
      label: "UBERLÂNDIA · EMPURRADA",
      scopes: [{ scopeType: "UNIDADE", code: "2", name: "UBERLÂNDIA" }],
      latestPeriod: "2026-09-01",
      periodosDisponiveis: ["2026-09-01", "2026-08-02"],
    },
    {
      scopeHash: "cama",
      channel: "EMPURRADA",
      label: "CAMAÇARI · EMPURRADA",
      scopes: [{ scopeType: "UNIDADE", code: "1", name: "CAMAÇARI" }],
      latestPeriod: "2026-08-01",
      periodosDisponiveis: ["2026-08-01", "2026-07-02"],
    },
    {
      scopeHash: "cama",
      channel: "PUXADA",
      label: "CAMAÇARI · PUXADA",
      scopes: [{ scopeType: "UNIDADE", code: "1", name: "CAMAÇARI" }],
      latestPeriod: "2026-08-01",
      periodosDisponiveis: ["2026-08-01"],
    },
  ];

  it("sem pedido, cai no primeiro contexto — e isso fica visível", () => {
    expect(completarRecorte(contextos, {}).atual?.scopeHash).toBe("uber");
  });

  it("a unidade pedida vence", () => {
    const { atual } = completarRecorte(contextos, { scopeHash: "cama" });
    expect(atual?.scopeHash).toBe("cama");
  });

  it("o canal pedido vence dentro da unidade", () => {
    const { atual } = completarRecorte(contextos, { scopeHash: "cama", canal: "PUXADA" });
    expect(atual?.channel).toBe("PUXADA");
  });

  /*
    O caso que o seletor tem de acertar sozinho: trocar de unidade com uma
    vigência selecionada que a nova unidade não tem. Mantê-la produziria um
    pedido que o servidor não pode atender — e é assim que se volta ao fallback
    silencioso por outro caminho.
  */
  it("uma vigência que a unidade escolhida não tem é descartada", () => {
    const { atual, period } = completarRecorte(contextos, {
      scopeHash: "cama",
      period: "2026-09-01",
    });
    expect(atual?.scopeHash).toBe("cama");
    expect(period).toBeUndefined();
  });

  it("uma vigência que a unidade tem é preservada", () => {
    const { period } = completarRecorte(contextos, {
      scopeHash: "cama",
      period: "2026-07-02",
    });
    expect(period).toBe("2026-07-02");
  });

  it("banco vazio não produz recorte inventado", () => {
    expect(completarRecorte([], { scopeHash: "cama" }).atual).toBeNull();
  });
});
