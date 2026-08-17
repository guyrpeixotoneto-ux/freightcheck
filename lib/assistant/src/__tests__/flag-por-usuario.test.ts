/**
 * A porta que liga o agente para uma pessoa só.
 *
 * **O que ela resolve.** Avaliar experiência exige usar o produto. Com a flag
 * global desligada, usar o produto é usar o assistente antigo — então quem
 * precisa julgar a nova experiência não consegue vê-la. Ligar para todos antes
 * do veredito troca o que a base inteira vê por algo ainda não provado melhor.
 * A lista é o meio-termo: quem está nela investiga, quem não está segue igual.
 *
 * **O que estes casos protegem.** Uma porta de liberação errada falha para o
 * lado caro: liga para quem não devia. Os casos abaixo fixam o
 * comportamento nos três pontos em que isso poderia acontecer — variável
 * ausente, variável vazia, e id que não está na lista — e o fixam explicitamente
 * em "ninguém", nunca em "todos".
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { agenteLigado, agenteParaUsuario } from "../agente";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("a flag por usuário", () => {
  it("sem variável nenhuma, ninguém tem o agente", () => {
    vi.stubEnv("ASSISTENTE_AGENTE", "");
    vi.stubEnv("ASSISTENTE_AGENTE_USUARIOS", "");

    expect(agenteLigado()).toBe(false);
    expect(agenteParaUsuario("qualquer-um")).toBe(false);
    expect(agenteParaUsuario(null)).toBe(false);
  });

  it("liga só para quem está na lista", () => {
    vi.stubEnv("ASSISTENTE_AGENTE", "");
    vi.stubEnv("ASSISTENTE_AGENTE_USUARIOS", "abc-123, def-456");

    expect(agenteParaUsuario("abc-123")).toBe(true);
    expect(agenteParaUsuario("def-456"), "espaço em volta do id não pode desligar").toBe(true);
    expect(agenteParaUsuario("ghi-789")).toBe(false);
  });

  /*
    A precedência dita por extenso: a global ligada significa "todos", sem
    exceção e sem lista. A lista só decide quando a global está desligada, que é
    o estado em que o produto está hoje.
  */
  it("a flag global ligada vence a lista", () => {
    vi.stubEnv("ASSISTENTE_AGENTE", "1");
    vi.stubEnv("ASSISTENTE_AGENTE_USUARIOS", "só-este");

    expect(agenteParaUsuario("outro-qualquer")).toBe(true);
    expect(agenteParaUsuario(null)).toBe(true);
  });

  /*
    O caso que justifica o desenho inteiro.

    Uma lista vazia, um `undefined`, um id nulo — todos os caminhos de erro
    levam ao planejador. A alternativa que se escreve sem pensar ("lista vazia
    significa liberar geral") transformaria um erro de digitação no Secret na
    virada de chave que este produto passou uma migração inteira adiando.
  */
  it("erro de configuração deixa o produto como está, e nunca liga para todos", () => {
    for (const valor of ["", "   ", ",,,", " , "]) {
      vi.stubEnv("ASSISTENTE_AGENTE", "");
      vi.stubEnv("ASSISTENTE_AGENTE_USUARIOS", valor);
      expect(
        agenteParaUsuario("alguem"),
        `\`${valor}\` como lista não pode liberar o agente para a base inteira`,
      ).toBe(false);
    }
  });

  /*
    Mesma regra literal da flag global: só "1" liga. "true", "sim" e "yes" são
    tentativas plausíveis e nenhuma delas vale — o valor é fixo de propósito,
    para a virada ser um ato inequívoco.
  */
  it("a flag global só aceita o literal 1", () => {
    vi.stubEnv("ASSISTENTE_AGENTE_USUARIOS", "");
    for (const valor of ["true", "sim", "yes", "0", "ON"]) {
      vi.stubEnv("ASSISTENTE_AGENTE", valor);
      expect(agenteLigado(), `"${valor}" não pode ligar a flag`).toBe(false);
      expect(agenteParaUsuario("alguem")).toBe(false);
    }
    vi.stubEnv("ASSISTENTE_AGENTE", "1");
    expect(agenteLigado()).toBe(true);
  });
});
