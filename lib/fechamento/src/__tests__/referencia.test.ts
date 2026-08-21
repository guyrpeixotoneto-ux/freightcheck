import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import {
  ABA_DO_RESUMO,
  AbaDoResumoNaoEncontrada,
  CelulaRecusada,
  COLUNA_DA_QUINZENA,
  LINHA_NO_RESUMO,
  lerReferenciaDaPlanilha,
} from "../referencia";

/**
 * A PORTA DA RÉGUA — o que ela deixa entrar, e tudo o que ela recusa.
 *
 * Esta suíte existe por um critério só, e ele é o mais importante do módulo:
 * **nunca converter ausência ou erro em zero**. Um zero suposto numa linha do
 * `RESUMO GERAL` não vira um erro visível — vira uma linha que "bate" contra um
 * devido que também é zero, ou uma diferença inventada contra um que não é. As
 * duas leituras erradas parecem leituras certas.
 *
 * Por isso cada forma de a célula estar quebrada tem um teste próprio, e todos
 * afirmam a mesma coisa: o arquivo **inteiro** é recusado, com o endereço da
 * célula no diagnóstico.
 */

/** Uma pasta com a aba do resumo preenchida célula a célula. */
function planilha(valores: Record<string, XLSX.CellObject | number>): Buffer {
  const aba: XLSX.WorkSheet = {};
  const enderecos = Object.keys(valores);
  for (const endereco of enderecos) {
    const bruto = valores[endereco]!;
    aba[endereco] = typeof bruto === "number" ? { t: "n", v: bruto } : bruto;
  }
  aba["!ref"] = enderecos.length > 0 ? `A1:BZ100` : "A1:A1";
  const pasta = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(pasta, aba, ABA_DO_RESUMO);
  return XLSX.write(pasta, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** Todas as células que o leitor pede, com um valor por linha. */
function completa(valor: (chave: string, quinzena: 1 | 2) => XLSX.CellObject | number) {
  const celulas: Record<string, XLSX.CellObject | number> = {};
  for (const quinzena of [1, 2] as const) {
    for (const [chave, linha] of Object.entries(LINHA_NO_RESUMO)) {
      celulas[`${COLUNA_DA_QUINZENA[quinzena]}${linha}`] = valor(chave, quinzena);
    }
  }
  return celulas;
}

describe("o leitor da referência aceita o que é número", () => {
  it("traz cada linha das duas quinzenas com a célula de onde saiu", () => {
    const bytes = planilha(completa((_, q) => (q === 1 ? 313318.87 : 327503.6)));
    const { numeros } = lerReferenciaDaPlanilha(bytes);

    expect(numeros).toHaveLength(Object.keys(LINHA_NO_RESUMO).length * 2);

    const dvs1 = numeros.find((n) => n.chave === "rota_dvs" && n.quinzena === 1)!;
    expect(dvs1.valor).toBe(313318.87);
    expect(dvs1.celula).toBe("AI7");

    const dvs2 = numeros.find((n) => n.chave === "rota_dvs" && n.quinzena === 2)!;
    expect(dvs2.valor).toBe(327503.6);
    expect(dvs2.celula).toBe("AJ7");
  });

  /**
   * Zero é afirmação, e por isso passa.
   *
   * `INDISPONIBILIDADE` vale 0,00 nas duas quinzenas de julho/2026 e
   * `DESCONTO COMPLEMENTAR NEGATIVO` vale 0,00 na 1ª. São zeros que a planilha
   * escreve. Recusá-los confundiria "a planilha diz zero" com "a célula está
   * quebrada" — o erro simétrico do que esta porta existe para impedir.
   */
  it("zero escrito na célula é zero, e não ausência", () => {
    const { numeros } = lerReferenciaDaPlanilha(planilha(completa(() => 0)));
    expect(numeros.every((n) => n.valor === 0)).toBe(true);
  });

  it("negativo passa — os descontos são negativos no resumo", () => {
    const { numeros } = lerReferenciaDaPlanilha(planilha(completa(() => -18199.19)));
    const desconto = numeros.find((n) => n.chave === "desconto_devolucao_percentual")!;
    expect(desconto.valor).toBe(-18199.19);
  });

  /**
   * A planilha guarda dez casas em células intermediárias; o que se compara é o
   * que ela **publica** contra o que o motor **paga**, e os dois a centavo.
   */
  it("arredonda a centavo na entrada, e não deixa a dízima para a comparação", () => {
    const { numeros } = lerReferenciaDaPlanilha(planilha(completa(() => 13088.6240000001)));
    expect(numeros[0]!.valor).toBe(13088.62);
  });
});

describe("o leitor recusa o arquivo inteiro em vez de supor", () => {
  it("sem a aba do resumo, recusa nomeando as abas que achou", () => {
    const pasta = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(pasta, XLSX.utils.aoa_to_sheet([[1]]), "Outra Coisa");
    const bytes = XLSX.write(pasta, { type: "buffer", bookType: "xlsx" }) as Buffer;

    expect(() => lerReferenciaDaPlanilha(bytes)).toThrow(AbaDoResumoNaoEncontrada);
    expect(() => lerReferenciaDaPlanilha(bytes)).toThrow(/Outra Coisa/);
  });

  it("célula vazia recusa, e nomeia o endereço", () => {
    const celulas = completa(() => 1);
    delete celulas["AJ13"];
    let erro: unknown;
    try {
      lerReferenciaDaPlanilha(planilha(celulas));
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(CelulaRecusada);
    const recusa = erro as CelulaRecusada;
    expect(recusa.celula).toBe("AJ13");
    expect(recusa.chave).toBe("custo_fixo_vans");
    expect(recusa.quinzena).toBe(2);
    expect(recusa.motivo).toMatch(/vazia/);
  });

  it("erro do Excel recusa — `#REF!` não vale zero", () => {
    const celulas = completa(() => 1);
    /* `t: "e"` é como o xlsx representa `#REF!`, `#N/A`, `#VALUE!`. */
    celulas["AI7"] = { t: "e", v: 0x17, w: "#REF!" };
    expect(() => lerReferenciaDaPlanilha(planilha(celulas))).toThrow(/AI7/);
    expect(() => lerReferenciaDaPlanilha(planilha(celulas))).toThrow(/erro do Excel/);
  });

  it("texto onde tem de haver número recusa, e mostra o texto", () => {
    const celulas = completa(() => 1);
    celulas["AI8"] = { t: "s", v: "731.502,84" };
    expect(() => lerReferenciaDaPlanilha(planilha(celulas))).toThrow(/AI8/);
    expect(() => lerReferenciaDaPlanilha(planilha(celulas))).toThrow(/texto/);
  });

  it("booleano recusa", () => {
    const celulas = completa(() => 1);
    celulas["AI9"] = { t: "b", v: true };
    expect(() => lerReferenciaDaPlanilha(planilha(celulas))).toThrow(/AI9/);
  });

  /**
   * Uma pasta vazia recusa na primeira célula, e não devolve zero em dezoito
   * linhas. É a diferença entre "esta planilha publica só zeros" e "isto não é
   * uma planilha de fechamento".
   */
  it("pasta com a aba certa e nenhuma célula recusa na primeira que falta", () => {
    expect(() => lerReferenciaDaPlanilha(planilha({}))).toThrow(CelulaRecusada);
  });

  it("a mensagem diz que nada foi suposto — é o que quem opera precisa ler", () => {
    const celulas = completa(() => 1);
    delete celulas["AI7"];
    expect(() => lerReferenciaDaPlanilha(planilha(celulas))).toThrow(/nenhum valor foi suposto/);
  });
});

/**
 * A trava contra duas verdades sobre o mesmo arquivo.
 *
 * `reconciliar-planilha-cli.ts` tem o seu próprio mapa de linhas, porque serve a
 * outra pergunta (o motor sobre os insumos da planilha, contra os resultados
 * dela) e precisa também dos parâmetros, das viagens e das bases. Os dois mapas
 * podem divergir em silêncio no dia em que alguém mexer num só — e aí a mesma
 * célula teria dois endereços no mesmo repositório.
 *
 * Este teste não funde os dois: exige que **concordem onde se sobrepõem**.
 */
describe("os dois mapas de célula não podem divergir", () => {
  it("o leitor e o CLI da prova apontam para a mesma linha em toda chave comum", async () => {
    const { LINHA_NO_RESUMO: doCli } = await import("../reconciliar-planilha-cli");

    const comuns = Object.keys(doCli).filter((c) => LINHA_NO_RESUMO[c] !== undefined);
    /* Se o filtro esvaziar, o teste vira decorativo — então ele também é preso. */
    expect(comuns.length).toBeGreaterThan(10);

    for (const chave of comuns) {
      expect(LINHA_NO_RESUMO[chave], `${chave} divergiu entre os dois mapas`).toBe(doCli[chave]);
    }
  });

  it("os totais existem só no mapa da tela — é a diferença deliberada entre os dois", async () => {
    const { LINHA_NO_RESUMO: doCli } = await import("../reconciliar-planilha-cli");
    for (const total of [
      "total_remuneracao_rota",
      "total_remuneracao_rota_variavel",
      "total_outros_custos",
      "total_geral_unidade",
    ]) {
      expect(LINHA_NO_RESUMO[total], `${total} sumiu do mapa da tela`).toBeGreaterThan(0);
      expect(doCli[total], `${total} apareceu no mapa do CLI`).toBeUndefined();
    }
  });
});
