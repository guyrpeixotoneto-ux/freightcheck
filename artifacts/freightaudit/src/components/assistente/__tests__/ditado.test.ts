import { describe, expect, it } from "vitest";
import { ditadoDisponivel, juntarDitado } from "../ditado";

/**
 * O que o ditado escreve no campo.
 *
 * A parte imperativa — abrir o microfone, ouvir, parar — é do navegador e não
 * se testa aqui. O que é deste produto é a decisão de **como** a fala entra no
 * rascunho, e é ela que estes casos travam: ditar continua a frase, não a
 * substitui, e não inventa espaço onde já há um.
 */
describe("juntarDitado", () => {
  it("começa a pergunta quando o campo está vazio", () => {
    expect(juntarDitado("", "qual foi a maior perda")).toBe("qual foi a maior perda");
  });

  it("continua o que já estava escrito, com um espaço", () => {
    expect(juntarDitado("qual foi", "a maior perda")).toBe("qual foi a maior perda");
  });

  it("não dobra o espaço quando o rascunho já termina em um", () => {
    expect(juntarDitado("qual foi ", "a maior perda")).toBe("qual foi a maior perda");
  });

  it("ignora o resultado vazio, que é o silêncio antes da primeira palavra", () => {
    expect(juntarDitado("qual foi", "   ")).toBe("qual foi");
  });

  it("não deixa o campo vazio virar espaço", () => {
    expect(juntarDitado("", "  ")).toBe("");
  });
});

describe("ditadoDisponivel", () => {
  /*
    O ambiente do teste não tem `SpeechRecognition` — é o mesmo caso do Firefox,
    e a resposta correta ali é `false`: sem a API, a tela não desenha o
    microfone.
  */
  it("é falso onde o navegador não transcreve fala", () => {
    expect(ditadoDisponivel()).toBe(false);
  });

  it("é verdadeiro com a API prefixada do Safari", () => {
    const janela = globalThis as unknown as Record<string, unknown>;
    janela.webkitSpeechRecognition = class {};
    try {
      expect(ditadoDisponivel()).toBe(true);
    } finally {
      delete janela.webkitSpeechRecognition;
    }
  });
});
