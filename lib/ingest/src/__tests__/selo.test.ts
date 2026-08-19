import { describe, expect, it } from "vitest";
import {
  CODIGOS_QUE_BLOQUEIAM_PROMOCAO,
  CODIGOS_QUE_ISOLAM_A_CHAVE,
  rotuloDoSelo,
} from "../apontamentos";

/**
 * O selo do apontamento — o contrato que o pipeline e as telas leem juntos.
 *
 * Não há banco aqui de propósito: o que se protege é uma tabela de decisão, e
 * ela erra de um jeito que nenhuma bateria de integração pega. Um código que
 * volte para a lista errada continua produzindo importações que funcionam; o
 * que muda é a frase que a tela escreve — e uma tela dizendo "Erro bloqueante"
 * sobre um arquivo que entrou manda a pessoa procurar um impedimento que não
 * existe, enquanto "Erro" sobre um registro em quarentena manda procurar uma
 * linha suja na planilha quando o que falta está no quadro.
 */
describe("as três consequências de um apontamento", () => {
  it("a linha suja recusa a linha, e o selo diz só isso", () => {
    expect(rotuloDoSelo("ERROR", "LINHA_SEM_CHAVE")).toBe("Erro");
  });

  it("a chave em conflito retira o registro, e o arquivo entra", () => {
    expect(rotuloDoSelo("ERROR", "ENTIDADE_DUPLICADA_CONFLITANTE")).toBe(
      "Registro não importado",
    );
    // A afirmação que carrega a decisão: o conflito **não** bloqueia mais.
    expect(CODIGOS_QUE_BLOQUEIAM_PROMOCAO.has("ENTIDADE_DUPLICADA_CONFLITANTE")).toBe(
      false,
    );
  });

  it("o arquivo que não é o que disse ser bloqueia a importação inteira", () => {
    expect(rotuloDoSelo("ERROR", "TIPO_DIVERGE_DA_DECLARACAO")).toBe("Erro bloqueante");
    expect(rotuloDoSelo("ERROR", "ABA_REBAIXADA_COM_TIPO_DECLARADO")).toBe(
      "Erro bloqueante",
    );
  });

  it("aviso e informação não seguraram nada, e o selo não insinua que sim", () => {
    expect(rotuloDoSelo("WARNING", "MIXED_TYPE_COLUMN")).toBe("Aviso");
    expect(rotuloDoSelo("INFO", "ENTIDADE_DUPLICADA_CONSOLIDADA")).toBe("Informação");
  });

  /*
    As duas listas descrevem consequências diferentes sobre o mesmo arquivo:
    "o arquivo não entra" e "o arquivo entra sem esta chave". Um código nas
    duas seria uma contradição que o selo resolveria em silêncio, pela ordem do
    `if` — e a tela passaria a esconder metade do que aconteceu.
  */
  it("nenhum código bloqueia e isola ao mesmo tempo", () => {
    const nas_duas = [...CODIGOS_QUE_ISOLAM_A_CHAVE].filter((c) =>
      CODIGOS_QUE_BLOQUEIAM_PROMOCAO.has(c),
    );
    expect(nas_duas).toEqual([]);
  });
});
