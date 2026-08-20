import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ARREDONDAMENTO_DO_TOTAL,
  DIVERGENCIAS_CONHECIDAS,
  interpretarAmostra,
  reconciliar,
  type LinhaReconciliada,
} from "../reconciliacao";

/**
 * A PROVA DE EQUIVALÊNCIA — o `RESUMO GERAL` real contra o motor.
 *
 * A amostra é o fechamento de **julho/2026, CDD Belém · Horizonte**, extraído
 * da `Fechamento_Remuneracao.xlsb` que a transportadora usa hoje por
 * `src/reconciliar-planilha-cli.ts`. Não é um exemplo montado nem um número
 * copiado à mão: são os parâmetros do cadastro, as 1.907 viagens dos trinta e
 * um dias, as bases dos descontos e o que o resumo imprime — e o motor roda
 * sobre eles do zero.
 *
 * **O que este teste prende.** Não é que a conta dê um número: é que ela dê o
 * **mesmo** número da planilha onde a planilha é consistente, e que dê o número
 * **diferente e nomeado** onde ela não é. As diferenças conhecidas estão
 * afirmadas com o centavo exato de cada uma — se uma delas mudar de tamanho, o
 * teste cai, porque mudou o que o motor faz ou mudou a amostra, e as duas
 * coisas precisam de alguém olhando.
 *
 * **Por que nenhuma tolerância larga.** Uma margem de "quase igual" esconderia
 * justamente o que se está tentando provar. A comparação é a centavo, e o que
 * não fecha a centavo tem nome e motivo escrito.
 */

/*
  Lida do disco, e não por `import ... with { type: "json" }`: a amostra é dado
  de teste, não módulo, e mantê-la fora do grafo de compilação evita que o
  `tsconfig` do pacote precise conhecer um arquivo que só o teste abre.
*/
const CAMINHO_DA_AMOSTRA = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "amostras",
  "julho-2026.json",
);
const fechamento = interpretarAmostra(
  JSON.parse(readFileSync(CAMINHO_DA_AMOSTRA, "utf8")),
);

const proposta = reconciliar(fechamento, "REGRA_PROPOSTA");
const legada = reconciliar(fechamento, "PLANILHA_LEGADA");

const linha = (r: { linhas: LinhaReconciliada[] }, chave: string): LinhaReconciliada => {
  const achada = r.linhas.find((l) => l.chave === chave);
  if (!achada) throw new Error(`a reconciliação não trouxe a linha ${chave}`);
  return achada;
};

const total = (r: { totais: LinhaReconciliada[] }, chave: string): LinhaReconciliada => {
  const achada = r.totais.find((l) => l.chave === chave);
  if (!achada) throw new Error(`a reconciliação não trouxe o total ${chave}`);
  return achada;
};

/**
 * Fecha ao centavo nas duas quinzenas — que é a coluna em que se fatura.
 *
 * A coluna do total é conferida à parte: ela pode divergir R$ 0,01 por ordem de
 * arredondamento, e essa diferença tem seção própria mais abaixo em vez de
 * virar tolerância aqui.
 */
function fechaNasQuinzenas(l: LinhaReconciliada): void {
  expect(l.diferenca.primeira, `${l.rotulo} · 1ª quinzena`).toBe(0);
  expect(l.diferenca.segunda, `${l.rotulo} · 2ª quinzena`).toBe(0);
}

describe("a amostra", () => {
  it("é o fechamento real, com as duas quinzenas e os trinta e um dias", () => {
    expect(fechamento.competencia).toBe("julho/2026 — CDD Belém · Horizonte");
    expect(fechamento.quinzenas.map((q) => q.quinzena)).toEqual([1, 2]);
    expect(fechamento.quinzenas[0]!.dias).toHaveLength(15);
    expect(fechamento.quinzenas[1]!.dias).toHaveLength(16);
  });

  it("traz o cadastro das duas quinzenas, que é o que muda entre elas", () => {
    const [primeira, segunda] = fechamento.quinzenas;
    expect(primeira!.parametros.frotaFixaAtiva).toBe(56);
    expect(primeira!.parametros.remuneracaoFixaDaFrotaAtiva).toBe(1424.91);
    expect(segunda!.parametros.remuneracaoFixaDaFrotaAtiva).toBe(1038.03);
  });
});

describe("os custos fixos fecham ao centavo nas duas quinzenas", () => {
  for (const chave of [
    "custo_fixo_inativos",
    "custo_vans_inativas",
    "custo_fixo_especiais",
    "custo_fixo_vans",
  ]) {
    it(chave, () => fechaNasQuinzenas(linha(proposta, chave)));
  }

  /*
    O padronizado é a única linha fixa que não fecha nos dois modos, e é por
    isso que ele tem uma seção só sua mais abaixo.
  */
  it("custo_fixo_padronizado fecha na 1ª quinzena nos dois modos", () => {
    expect(linha(proposta, "custo_fixo_padronizado").diferenca.primeira).toBe(0);
    expect(linha(legada, "custo_fixo_padronizado").diferenca.primeira).toBe(0);
  });
});

describe("os descontos fecham ao centavo", () => {
  it("devolução — a base sem imposto, brutada e negativa", () => {
    const l = linha(proposta, "desconto_devolucao_percentual");
    expect(l.motor.primeira).toBe(-18199.19);
    expect(l.motor.segunda).toBe(-21548.23);
    expect(l.diferenca.primeira).toBe(0);
    expect(l.diferenca.segunda).toBe(0);
  });

  it("disponibilidade — mesma regra, base do 03.08.18", () => {
    const l = linha(proposta, "desconto_disponibilidade");
    expect(l.motor.primeira).toBe(-15907.37);
    expect(l.motor.segunda).toBe(-125271.68);
    expect(l.diferenca.primeira).toBe(0);
    expect(l.diferenca.segunda).toBe(0);
  });

  it("complementar negativo — o único que não é brutado", () => {
    const l = linha(proposta, "desconto_complementar_negativo");
    expect(l.motor.segunda).toBe(-14050.54);
    fechaNasQuinzenas(l);
  });
});

describe("o gross-up", () => {
  /**
   * O fator é a média dos dois grossups pesada pela fatia de emissão. Ele
   * aparece na memória de cálculo de cada linha fixa, e é o que o produto
   * registrava como "um fator digitado que não sai de arquivo nenhum".
   */
  it("aparece na memória de cálculo, com a fatia que o produziu", () => {
    const l = linha(proposta, "custo_fixo_padronizado");
    expect(l.memoria.primeira).toContain("1.365455");
    expect(l.memoria.primeira).toContain("56 veículos ativos");
    expect(l.memoria.primeira).toContain("os dois do cadastro");
    expect(l.memoria.segunda).toContain("1.366960");
  });

  it("difere entre as quinzenas só pela fatia de emissão", () => {
    const [primeira, segunda] = fechamento.quinzenas;
    expect(primeira!.parametros.parcelaDentroDoMunicipio).toBe(0.0316);
    expect(segunda!.parametros.parcelaDentroDoMunicipio).toBe(0.0238);
    /* As alíquotas são as mesmas; só o peso muda. */
    expect(primeira!.parametros.aliquotas).toEqual(segunda!.parametros.aliquotas);
  });
});

describe("a remuneração variável", () => {
  it("o agregado fecha na 1ª quinzena e diverge R$ 0,06 na 2ª", () => {
    const l = linha(proposta, "custo_variavel_agregado");
    expect(l.diferenca.primeira).toBe(0);
    /* Seis viagens Spot de R$ 0,01 que a tabela de tarifa da planilha não pega. */
    expect(l.diferenca.segunda).toBe(0.06);
  });

  it("a frota fixa diverge exatamente o que os três dias sem BM/BN valem", () => {
    const l = linha(proposta, "custo_variavel_frota_fixa");
    /* Dia 12 (+851,99) e dia 15 (−79,93) na 1ª; dia 27 (−81,01) na 2ª. */
    expect(l.diferenca.primeira).toBe(772.06);
    expect(l.diferenca.segunda).toBe(-81.01);
  });

  it("a indisponibilidade do quadro variável é o desconto de disponibilidade", () => {
    expect(linha(proposta, "indisponibilidade_variavel").motor.segunda).toBe(-125271.68);
    fechaNasQuinzenas(linha(proposta, "indisponibilidade_variavel"));
  });

  it("o DVS herda as diferenças do variável e a da recarga/noturna quebrada", () => {
    const l = linha(proposta, "rota_dvs");
    expect(l.diferenca.segunda).toBe(-80.95);
    /* Na 1ª, os R$ 6.344,78 do cache da linha 129 dominam a diferença. */
    expect(l.diferenca.primeira).toBe(-5572.72);
  });
});

describe("a inconsistência conhecida entre Cadastro!F50 e Mapa Rota!AJ119", () => {
  /**
   * A 1ª quinzena pesa os dois lados pelo cadastro; a 2ª pesa o lado de fora
   * pelo diário. Os pesos da 2ª somam 0,9998274 e não 1 — e é essa fração
   * perdida, não a troca de fonte, que produz a diferença.
   */
  it("reproduzindo a planilha, o padronizado fecha em R$ 0,00 nas três colunas", () => {
    fechaNasQuinzenas(linha(legada, "custo_fixo_padronizado"));
    expect(linha(legada, "custo_fixo_padronizado").motor.segunda).toBe(739274);
  });

  it("pela regra proposta, o padronizado sobe R$ 128,05 na 2ª quinzena", () => {
    const l = linha(proposta, "custo_fixo_padronizado");
    expect(l.motor.segunda).toBe(739402.05);
    expect(l.diferenca.segunda).toBe(128.05);
    expect(l.diferenca.total).toBe(128.05);
  });

  it("a memória diz qual fonte pesou, e com que pesos", () => {
    expect(linha(legada, "custo_fixo_padronizado").memoria.segunda).toContain("Mapa Rota!AJ119");
    expect(linha(legada, "custo_fixo_padronizado").memoria.segunda).toContain("0.9998274");
    expect(linha(proposta, "custo_fixo_padronizado").memoria.segunda).toContain("= 1");
  });

  it("os R$ 128,05 atravessam o total geral da unidade", () => {
    const geral = total(proposta, "geral");
    const geralLegado = total(legada, "geral");
    expect(geral.motor.segunda! - geralLegado.motor.segunda!).toBeCloseTo(128.05, 2);
  });
});

describe("o centavo de arredondamento, que só aparece no total", () => {
  /**
   * A planilha soma as duas quinzenas com dez casas e arredonda no fim; o motor
   * arredonda cada quinzena — que é o que se fatura — e soma. Duas linhas de
   * julho/2026 caem perto de meio centavo e diferem em R$ 0,01.
   */
  it("as duas linhas afetadas divergem exatamente um centavo, e só no total", () => {
    for (const [chave, esperado] of [
      ["custo_vans_inativas", -0.01],
      ["desconto_devolucao_percentual", 0.01],
    ] as const) {
      const l = linha(proposta, chave);
      expect(l.diferenca.primeira, `${l.rotulo} · 1ª`).toBe(0);
      expect(l.diferenca.segunda, `${l.rotulo} · 2ª`).toBe(0);
      expect(l.diferenca.total, `${l.rotulo} · total`).toBe(esperado);
    }
  });

  it("a linha diz que a diferença é de arredondamento, e não de conta", () => {
    expect(linha(proposta, "custo_vans_inativas").divergencia).toBe(ARREDONDAMENTO_DO_TOTAL);
  });

  it("a soma das metades arredondadas é o que o motor devolve", () => {
    const l = linha(proposta, "custo_vans_inativas");
    expect(l.motor.primeira! + l.motor.segunda!).toBeCloseTo(l.motor.total!, 2);
  });
});

describe("o placar da reconciliação", () => {
  /**
   * Quarenta e duas células — catorze linhas × três colunas. O que não fecha
   * está inteiramente contido nas quatro linhas do variável e, no modo
   * proposto, na do padronizado.
   */
  it("no modo que reproduz a planilha, só o variável não fecha", () => {
    expect(legada.placar.iguais).toBe(32);
    expect(legada.placar.diferentes).toBe(10);
    const naoFecham = legada.linhas
      .filter((l) => l.diferenca.primeira !== 0 || l.diferenca.segunda !== 0)
      .map((l) => l.chave)
      .sort();
    expect(naoFecham).toEqual([
      "custo_variavel_agregado",
      "custo_variavel_frota_fixa",
      "rota_dvs",
    ]);
  });

  it("pela regra proposta, entra também o padronizado", () => {
    expect(proposta.placar.iguais).toBe(30);
    expect(proposta.placar.diferentes).toBe(12);
  });

  it("toda linha que não fecha tem o motivo escrito", () => {
    for (const l of [...proposta.linhas, ...legada.linhas]) {
      const fecha = l.diferenca.primeira === 0 && l.diferenca.segunda === 0;
      if (fecha) continue;
      expect(l.divergencia, `${l.rotulo} não fecha e não diz por quê`).toBeTruthy();
      expect(DIVERGENCIAS_CONHECIDAS[l.chave]).toBeTruthy();
    }
  });
});
