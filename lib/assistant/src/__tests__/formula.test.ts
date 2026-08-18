import { afterEach, describe, expect, it, vi } from "vitest";
import { sugerirFormula } from "../formula";

/**
 * A sugestão de fórmula é um rascunho, e é só isso que estes testes prendem.
 *
 * Ela não grava, não confirma, não move status e não destrava soma nenhuma —
 * escreve, no campo "Fórmula de cálculo", uma proposta de como a fonte produz o
 * número, para a pessoa corrigir antes de salvar. As duas fronteiras que a
 * mantêm barata:
 *
 * - **Nunca lança.** A tela de curadoria funciona inteira sem esta sugestão, e
 *   uma exceção vinda daqui derrubaria um pedido que não depende dela.
 * - **Texto só existe quando um modelo escreveu.** Todo desfecho que não é
 *   `IA` devolve `texto: null`. No dia em que um deles passar a devolver uma
 *   frase montada em código, a tela vai escrevê-la dentro do campo com a
 *   etiqueta "escrito por IA" — e é este arquivo que falha antes de uma fórmula
 *   inventada pelo servidor chegar num campo que alguém salva.
 *
 * O caminho com chave configurada não é testado aqui de propósito: ele é uma
 * chamada de rede a um modelo, e um teste que precisa de crédito para passar
 * não roda no CI de ninguém.
 */

afterEach(() => vi.unstubAllEnvs());

describe("o que nem chega a virar chamada", () => {
  it("recusa a coluna sem nome e sem descrição antes de gastar uma chamada", async () => {
    // A chave é falsa de propósito: se o caso sem base não curto-circuitasse,
    // este teste tentaria a rede e falharia de outro jeito — que é o sinal
    // desejado. Sem nome e sem "O que é", o pedido vira "adivinhe como esta
    // coluna é calculada", que é exatamente o que esta função não faz.
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-nao-usada");

    const r = await sugerirFormula({
      nome: "   ",
      nomeDeOrigem: "ipvaLicenc",
      definicao: "  ",
    });

    expect(r.motivo).toBe("SEM_BASE");
    expect(r.texto).toBeNull();
  });

  it("aceita só a descrição, sem nome gerencial", async () => {
    /*
      Dois caminhos reais da tela: quem batizou a coluna e ainda não descreveu,
      e quem abriu um atributo que outra pessoa descreveu sem apelidar. Exigir
      os dois desligaria o botão nos dois casos em que ele mais serve — então o
      corte aqui não pode ser `SEM_BASE`.
    */
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");

    const r = await sugerirFormula({
      nome: "",
      nomeDeOrigem: "ipvaLicenc",
      definicao: "IPVA e licenciamento pagos no ano pelo veículo",
    });

    expect(r.motivo).not.toBe("SEM_BASE");
  });

  it("diz que não há sugestão quando não há chave, em vez de inventar uma", async () => {
    /*
      Aqui não existe o plano B do Assistente. Lá, sem chave, `resposta.ts`
      monta o texto em código a partir do dossiê; escrever a conta de uma coluna
      é o trabalho inteiro, e não há versão determinística dele. Devolver a
      descrição de volta com outras palavras seria fingir ter sugerido.
    */
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");

    const r = await sugerirFormula({
      nome: "IPVA e licenciamento",
      nomeDeOrigem: "ipvaLicenc",
      definicao: "Imposto anual do veículo, cobrado sobre o valor de compra",
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
      sugerirFormula({
        nome: "Preço do diesel",
        nomeDeOrigem: "precoDiesel",
        exemplos: ["5,49", "5,52", "5,61"],
      }),
    ).resolves.toBeDefined();
  });
});

describe("só o modelo escreve texto", () => {
  it("todo desfecho que não é IA volta sem fórmula nenhuma", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");

    for (const nome of ["", "   ", "Vida útil do pneu"]) {
      const r = await sugerirFormula({ nome, nomeDeOrigem: "vidaPneu" });
      expect(r.motivo).not.toBe("IA");
      expect(r.texto).toBeNull();
      // O modelo sai na resposta mesmo sem sugestão: a tela usa isso para dizer
      // qual modelo *escreveria*, e não para afirmar que um escreveu.
      expect(r.modelo).toBeTruthy();
    }
  });
});
