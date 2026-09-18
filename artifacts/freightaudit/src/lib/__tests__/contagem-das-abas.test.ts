import { describe, expect, it } from "vitest";
import {
  agruparPorVeiculo,
  linhasDeFiname,
  resumirFiname,
  type AlteracaoDoMotor,
} from "@workspace/comparison/finame";
import { contagemPorAba, filtrar, FILTROS_VAZIOS } from "../finame";

/**
 * A CONTAGEM DAS ABAS — em veículos, como tudo o mais nesta tela.
 *
 * O defeito que estes casos prendem chegou como uma pergunta sobre dois números
 * que não se conversavam: a aba dizia "Alterados (22)" e o cartão ao lado,
 * "Veículos com alteração: 10". Os dois estavam certos e falavam de coisas
 * diferentes — a aba contava alterações, o cartão contava placas —, e a tabela
 * embaixo desenhava dez linhas sob o rótulo que prometia vinte e duas.
 *
 * A régua passou a ser uma só. O que se prende aqui é a igualdade entre as
 * três leituras da mesma frota: a aba, a tabela e o cartão.
 */

const alteracao = (over: Partial<AlteracaoDoMotor> = {}): AlteracaoDoMotor => ({
  changeType: "VALUE_CHANGED",
  nature: "NUMERIC",
  attributeCode: "cavalo.finame_cavalo",
  entityLabel: "QYP3G72",
  entityType: "CAVALO",
  valueBefore: "9847.35",
  valueAfter: "4677.85",
  isNullBefore: false,
  isNullAfter: false,
  deltaAbsolute: "-5169.5",
  deltaPercent: "-52.5",
  comparability: "COMPARABLE",
  impactConfidence: "CALCULATED",
  impactAmount: "-5169.5",
  impactPeriodicity: "MENSAL",
  ...over,
});

/* Uma placa que moveu três variáveis e outra que moveu uma: quatro alterações
   em dois veículos — a forma exata do desencontro relatado. */
const linhas = linhasDeFiname([
  alteracao(),
  alteracao({ attributeCode: "cavalo.juros_finame_cavalo", impactAmount: "-2000" }),
  alteracao({ attributeCode: "cavalo.taxa_finame", impactAmount: null }),
  alteracao({ entityLabel: "QYQ6A80", attributeCode: "cavalo.finame_cavalo" }),
  alteracao({
    entityLabel: "CUL0J25",
    entityType: "CARRETA",
    attributeCode: "carreta.finame_implemento",
    changeType: "ENTITY_REMOVED",
  }),
]);

describe("quantos a aba promete, e quantos a tabela entrega", () => {
  it("a aba Alterados conta placas, e não alterações", () => {
    const contagem = contagemPorAba(linhas, FILTROS_VAZIOS);
    expect(linhas.filter((l) => l.estado === "ALTERADO")).toHaveLength(4);
    expect(contagem.ALTERADO).toBe(2);
  });

  it("cada aba promete exatamente as linhas que o clique nela abre", () => {
    const contagem = contagemPorAba(linhas, FILTROS_VAZIOS);
    for (const estado of ["TODAS", "ALTERADO", "AUSENTE_NA_COMPARADA"] as const) {
      const naTabela = agruparPorVeiculo(filtrar(linhas, { ...FILTROS_VAZIOS, estado }));
      expect(contagem[estado]).toBe(naTabela.length);
    }
  });

  it("a aba e o cartão do topo dão o mesmo número sob o mesmo rótulo", () => {
    const resumo = resumirFiname(linhas, { comparados: 109, novos: 26, ausentes: 1 });
    expect(contagemPorAba(linhas, FILTROS_VAZIOS).ALTERADO).toBe(resumo.veiculosComAlteracao);
    /* Quantas variáveis se moveram não some: continua na nota do cartão, onde
       a palavra é "variáveis" e não "veículos". */
    expect(resumo.variaveisAlteradas).toBe(4);
  });

  it("o recorte por variável continua sendo sobre a linha — e a contagem, sobre a placa", () => {
    const contagem = contagemPorAba(linhas, { ...FILTROS_VAZIOS, variavel: "parcela" });
    expect(contagem.ALTERADO).toBe(2);
    expect(contagemPorAba(linhas, { ...FILTROS_VAZIOS, variavel: "taxa" }).ALTERADO).toBe(1);
  });
});
