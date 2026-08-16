import { afterEach, describe, expect, it, vi } from "vitest";
import { interpretarFormula } from "../formula";

/**
 * A leitura da fórmula é o ato mais barato que este produto tem.
 *
 * Ela não grava, não confirma, não move status e não destrava soma nenhuma —
 * pega o texto que uma pessoa digitou em "Fórmula de cálculo" e o devolve em
 * português corrido. O que estes testes prendem são as duas fronteiras que
 * fazem dela um ato barato de verdade:
 *
 * - **Nunca lança.** A tela de curadoria funciona inteira sem esta leitura, e
 *   uma exceção vinda daqui derrubaria um pedido que não depende dela.
 * - **Texto só existe quando um modelo escreveu.** Todo desfecho que não é
 *   `IA` devolve `texto: null`. No dia em que um deles passar a devolver uma
 *   frase montada em código, a tela vai exibi-la com a etiqueta "escrito por
 *   IA" — e é este arquivo que falha antes disso chegar na tela.
 *
 * O caminho com chave configurada não é testado aqui de propósito: ele é uma
 * chamada de rede a um modelo, e um teste que precisa de crédito para passar
 * não roda no CI de ninguém.
 */

afterEach(() => vi.unstubAllEnvs());

describe("o que nem chega a virar chamada", () => {
  it("recusa campo em branco antes de gastar uma chamada", async () => {
    // A chave é falsa de propósito: se o branco não curto-circuitasse, este
    // teste tentaria a rede e falharia de outro jeito — que é o sinal desejado.
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-nao-usada");

    const r = await interpretarFormula({ formula: "   ", nome: "IPVA" });

    expect(r.motivo).toBe("VAZIO");
    expect(r.texto).toBeNull();
  });

  it("diz que não há leitura quando não há chave, em vez de inventar uma", async () => {
    /*
      Aqui não existe o plano B do Assistente. Lá, sem chave, `resposta.ts`
      monta o texto em código a partir do dossiê; reescrever uma fórmula em
      linguagem simples é o trabalho inteiro, e não há versão determinística
      dele. Devolver a própria fórmula de volta seria fingir ter explicado.
    */
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");

    const r = await interpretarFormula({
      formula: "1,000% do valor da nota de compra",
      nome: "IPVA e licenciamento",
      unidade: "BRL",
      periodicidade: "ANUAL",
    });

    expect(r.motivo).toBe("SEM_CHAVE");
    expect(r.texto).toBeNull();
  });

  it("não lança nunca — a tela de curadoria não depende dela", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");

    await expect(
      interpretarFormula({ formula: "menor entre ANP e operadora", nome: "Preço" }),
    ).resolves.toBeDefined();
  });
});

describe("só o modelo escreve texto", () => {
  it("todo desfecho que não é IA volta sem texto", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");

    for (const formula of ["", "   ", "1% da NF"]) {
      const r = await interpretarFormula({ formula, nome: "Coluna" });
      expect(r.motivo).not.toBe("IA");
      expect(r.texto).toBeNull();
      // O modelo sai na resposta mesmo sem leitura: a tela usa isso para dizer
      // qual modelo *leria*, e não para afirmar que um leu.
      expect(r.modelo).toBeTruthy();
    }
  });
});
