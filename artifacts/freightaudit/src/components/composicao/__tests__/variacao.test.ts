import { describe, expect, it } from "vitest";
import { tomDaVariacao } from "../farol";

/**
 * A cor da variação — o teste que impede a inversão de voltar.
 *
 * Ela já esteve invertida nas duas telas da Composição, com uma justificativa
 * escrita no código: "esta é uma tela de custo, e um aumento é saída de caixa
 * maior". A premissa é que era falsa. `PLANO_DA_DRE` põe
 * `receita.remuneracao_fixa` e as irmãs dela dentro de `RECEITA_BRUTA` — "o que
 * a Ambev paga por este equipamento nesta vigência" — e `@workspace/knowledge`
 * lê cada alteração como "aumenta a nossa remuneração" ou "reduz a nossa
 * remuneração". O dinheiro entra; não sai.
 */
describe("tomDaVariacao", () => {
  it("pinta de verde o mês que nos paga mais", () => {
    expect(tomDaVariacao(11_916.7)).toBe("text-emerald-600");
    expect(tomDaVariacao(0.01)).toBe("text-emerald-600");
  });

  it("pinta de vermelho o mês que nos paga menos", () => {
    expect(tomDaVariacao(-52_223.9)).toBe("text-brand-red");
    expect(tomDaVariacao(-0.01)).toBe("text-brand-red");
  });

  /*
    Zero não é alta pequena nem queda pequena: é o mês em que nada se moveu, e
    a lista tem 62 linhas em que ele é a resposta certa. Pintá-lo de qualquer
    uma das duas cores poria notícia onde não há nenhuma.
  */
  it("deixa sem cor o mês em que nada se moveu", () => {
    expect(tomDaVariacao(0)).toBe("text-muted-foreground");
  });
});
