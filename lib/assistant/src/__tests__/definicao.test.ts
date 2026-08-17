import { afterEach, describe, expect, it, vi } from "vitest";
import { rascunharDefinicao } from "../definicao";

/**
 * O rascunho de "O que é" escreve dentro de um campo que alguém vai salvar.
 *
 * É o que o separa da leitura da fórmula: aquela sai numa caixa e morre ali;
 * esta cai no textarea, vira documentação da coluna assim que a pessoa apertar
 * salvar. Por isso as duas fronteiras presas aqui são as mesmas de sempre, e
 * valem mais:
 *
 * - **Nunca lança.** A tela de curadoria funciona inteira sem rascunho nenhum,
 *   e uma exceção vinda daqui derrubaria um pedido que não depende dela.
 * - **Texto só existe quando um modelo escreveu.** Todo desfecho que não é `IA`
 *   devolve `texto: null`. No dia em que um deles passar a devolver uma frase
 *   montada em código, ela entraria no campo com cara de descrição escrita por
 *   gente — e é este arquivo que falha antes disso chegar ao banco.
 *
 * O caminho com chave configurada não é testado aqui de propósito: ele é uma
 * chamada de rede a um modelo, e um teste que precisa de crédito para passar
 * não roda no CI de ninguém.
 */

afterEach(() => vi.unstubAllEnvs());

describe("o que nem chega a virar chamada", () => {
  it("recusa nome em branco antes de gastar uma chamada", async () => {
    // A chave é falsa de propósito: se o branco não curto-circuitasse, este
    // teste tentaria a rede e falharia de outro jeito — que é o sinal desejado.
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-nao-usada");

    const r = await rascunharDefinicao({ nome: "   ", nomeDeOrigem: "vidaCombustivel" });

    expect(r.motivo).toBe("SEM_NOME");
    expect(r.texto).toBeNull();
  });

  it("diz que não há rascunho quando não há chave, em vez de inventar um", async () => {
    /*
      Não há plano B aqui, pelo mesmo motivo da fórmula: escrever a frase é o
      trabalho inteiro. Devolver o nome gerencial de volta como se fosse a
      descrição seria preencher o campo com nada.
    */
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");

    const r = await rascunharDefinicao({
      nome: "Vida útil do pneu em contrato",
      nomeDeOrigem: "vidaPneu",
      unidade: "MESES",
      periodicidade: "PONTUAL",
      exemplos: ["60", "48"],
    });

    expect(r.motivo).toBe("SEM_CHAVE");
    expect(r.texto).toBeNull();
  });

  it("não lança nunca — a tela de curadoria não depende dela", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");

    await expect(
      rascunharDefinicao({ nome: "IPVA e licenciamento", nomeDeOrigem: "ipva" }),
    ).resolves.toBeDefined();
  });
});

describe("só o modelo escreve texto", () => {
  it("todo desfecho que não é IA volta sem texto", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");

    for (const nome of ["", "   ", "Custo de pneu por quilômetro"]) {
      const r = await rascunharDefinicao({ nome, nomeDeOrigem: "coluna" });
      expect(r.motivo).not.toBe("IA");
      expect(r.texto).toBeNull();
      // O modelo sai na resposta mesmo sem rascunho: a tela usa isso para dizer
      // qual modelo *escreveria*, e não para afirmar que um escreveu.
      expect(r.modelo).toBeTruthy();
    }
  });
});
