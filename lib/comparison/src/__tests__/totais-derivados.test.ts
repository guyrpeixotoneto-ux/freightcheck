import { describe, expect, it } from "vitest";

import {
  formulaDoTotalDerivado,
  separarTotaisDerivados,
  totalDerivado,
} from "../totais-derivados";

/**
 * O total que é a conta das suas parcelas — o que o catálogo declara, e o que
 * ele deliberadamente não declara.
 */
describe("a composição declarada", () => {
  it("a parcela do FINAME se abre em juros e amortização nos dois tipos", () => {
    expect(totalDerivado("cavalo.finame_cavalo")).toEqual({
      resultado: "cavalo.finame_cavalo",
      parcelas: ["cavalo.juros_finame_cavalo", "cavalo.amortizacao_cavalo"],
      forma: "SOMA",
    });
  });

  it("e, na carreta, também no aluguel — a terceira parcela que só ela tem", () => {
    /*
      `finameImplemento = amortização + juros + aluguel` fecha em 1.314 de 1.314
      linhas do acervo, e sem o aluguel falha nas 36 dos implementos alugados
      (`docs/ACHADO-ALUGUEL.md`). No cavalo ele não entra: a identidade de lá é
      amortização + juros + lucro fixo.
    */
    expect(totalDerivado("carreta.finame_implemento")?.parcelas).toEqual([
      "carreta.juros_finame_implemento",
      "carreta.amortizacao_implemento",
      "carreta.custo_aluguel",
    ]);
  });

  it("uma parcela que não se aplica a um tipo não derruba a composição dele", () => {
    /*
      A regra distingue a parcela que **falta** — chave inexistente, que é erro
      de escrita e derruba tudo — da que **não se aplica**, como o aluguel no
      cavalo. Antes desta distinção, declarar a terceira parcela apagava a
      composição do cavalo inteira, e a justificativa da parcela dele voltava a
      ser escrita à mão sem que nada reclamasse.
    */
    const doCavalo = totalDerivado("cavalo.finame_cavalo");
    expect(doCavalo?.parcelas).not.toContain("cavalo.custo_aluguel");
    expect(doCavalo?.parcelas).toHaveLength(2);
  });

  it("os trios do QLP são produto, e não soma", () => {
    const despesa = totalDerivado("qlp_administrativo.despesa_ordenados");
    expect(despesa?.forma).toBe("PRODUTO");
    expect(despesa?.parcelas).toHaveLength(2);
  });

  /*
    `carreta.finame` é marcado como total composto e **não** diz de que colunas
    se compõe. Deduzir as parcelas pelo nome é a única forma de este módulo
    errar; sem `parcelas` declaradas, ele não é total derivado nenhum.
  */
  it("o total composto da carreta não vira derivado, porque não declara parcelas", () => {
    expect(totalDerivado("carreta.finame")).toBeNull();
  });

  it("uma variável comum não é total de nada", () => {
    expect(totalDerivado("cavalo.juros_finame_cavalo")).toBeNull();
    expect(totalDerivado(null)).toBeNull();
  });

  it("a fórmula sai com o sinal da forma e os rótulos de quem chama", () => {
    expect(formulaDoTotalDerivado("Parcela FINAME", "SOMA", ["Juros FINAME", "Amortização"])).toBe(
      "Parcela FINAME = Juros FINAME + Amortização",
    );
    expect(formulaDoTotalDerivado("Despesa", "PRODUTO", ["Quantidade", "Valor"])).toBe(
      "Despesa = Quantidade × Valor",
    );
  });
});

const alvo = (entityLabel: string, attributeCode: string) => ({ entityLabel, attributeCode });

describe("o que a fila pergunta e o que ela deduz", () => {
  it("o total sai da fila quando uma parcela dele está na mesma lista", () => {
    const { fila, derivados } = separarTotaisDerivados([
      alvo("QYX1E98", "cavalo.finame_cavalo"),
      alvo("QYX1E98", "cavalo.juros_finame_cavalo"),
      alvo("QYX1E98", "cavalo.amortizacao_cavalo"),
      alvo("QYX1E98", "cavalo.periodo_finame"),
    ]);
    expect(fila.map((a) => a.attributeCode)).toEqual([
      "cavalo.juros_finame_cavalo",
      "cavalo.amortizacao_cavalo",
      "cavalo.periodo_finame",
    ]);
    expect(derivados).toHaveLength(1);
    expect(derivados[0].parcelas).toHaveLength(2);
  });

  /* Uma parcela só já explica o total: se só os juros se moveram, a parcela se
     moveu por causa deles. */
  it("basta uma parcela na lista", () => {
    const { fila, derivados } = separarTotaisDerivados([
      alvo("QYX1E98", "cavalo.finame_cavalo"),
      alvo("QYX1E98", "cavalo.juros_finame_cavalo"),
    ]);
    expect(fila).toHaveLength(1);
    expect(derivados[0].parcelas.map((p) => p.attributeCode)).toEqual([
      "cavalo.juros_finame_cavalo",
    ]);
  });

  it("o total aberto sozinho continua sendo perguntado", () => {
    const { fila, derivados } = separarTotaisDerivados([alvo("QYX1E98", "cavalo.finame_cavalo")]);
    expect(fila).toHaveLength(1);
    expect(derivados).toHaveLength(0);
  });

  /* A seleção do Painel atravessa placas: a amortização de uma não explica a
     parcela de outra. */
  it("parcela de outra placa não tira o total da fila", () => {
    const { fila } = separarTotaisDerivados([
      alvo("QYX1E98", "cavalo.finame_cavalo"),
      alvo("QYW6D15", "cavalo.juros_finame_cavalo"),
    ]);
    expect(fila).toHaveLength(2);
  });
});
