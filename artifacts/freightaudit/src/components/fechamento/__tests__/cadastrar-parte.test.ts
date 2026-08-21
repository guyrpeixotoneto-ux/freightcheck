import { describe, expect, it } from "vitest";

import { ROTULOS } from "../cadastrar-parte";

/**
 * O CÓDIGO PEDIDO AQUI É O MESMO QUE A REMUNERAÇÃO PEDE.
 *
 * **O defeito que este arquivo existe para não deixar voltar.** As duas telas
 * que cadastram uma unidade pediam identificadores diferentes sob o mesmo
 * rótulo "Código": esta trazia o exemplo `443`, o número do CDD, e a de
 * Remuneração (`registrar-unidade.tsx`) trazia `12.345.678/0001-99`, o CNPJ da
 * coluna `Unidade - CNPJ` do export. E é justamente por esse campo que uma
 * encontra a outra — `cadastroDaRemuneracao` casa `competencia.unidade_codigo`
 * com `remuneracao_unidade.codigo`.
 *
 * Quem seguia os dois exemplos gravava o número do CDD de um lado e o CNPJ do
 * outro. Nenhuma das duas telas acusava erro, as duas estavam preenchidas como
 * mandavam, e o resumo caía no painel antigo — `em conjunto` em seis linhas —
 * sem que nada dissesse por quê.
 *
 * Um teste de igualdade de strings é pouco para um defeito desse tamanho, e é
 * exatamente do tamanho da causa: a divergência era de exemplo, não de lógica.
 */
describe("o exemplo de código da unidade", () => {
  it("é um CNPJ, e não o número do CDD", () => {
    /* Dígitos suficientes para ser CNPJ — `443` e `081-0443` não passam. */
    const digitos = ROTULOS.UNIDADE.codigo.replace(/\D/g, "");
    expect(digitos).toHaveLength(14);
  });

  it("traz a máscara, porque é assim que o export costuma escrever", () => {
    /*
      O `scope_hash` é somado sobre o texto da célula, não sobre o CNPJ
      canônico: o exemplo mascarado é o que ensina a digitar como está lá.
    */
    expect(ROTULOS.UNIDADE.codigo).toContain("/");
    expect(ROTULOS.UNIDADE.codigo).toContain("-");
  });

  it("usa o mesmo rótulo de campo que a tela de Remuneração", () => {
    expect(ROTULOS.UNIDADE.campoDoCodigo).toBe("Código da unidade");
  });

  /**
   * A transportadora **não** segue a unidade, e não é esquecimento.
   *
   * Não há cadastro de transportadora em Remuneração para esta identidade
   * encontrar: o resumo procura a unidade. Alinhar a transportadora ao CNPJ por
   * simetria trocaria um código que funciona por um que não tem par do outro
   * lado.
   */
  it("a transportadora continua com o número da Ambev", () => {
    expect(ROTULOS.TRANSPORTADORA.codigo).toBe("36");
  });
});
