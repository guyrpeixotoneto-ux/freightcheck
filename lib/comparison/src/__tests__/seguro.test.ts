import { describe, expect, it } from "vitest";
import {
  agruparPorVeiculoDeSeguro,
  CODIGOS_DA_TABELA_DE_SEGURO,
  codigosDoRecorteDeSeguro,
  conferenciaDoAparato,
  impactoDeSeguro,
  linhaDeSeguroDaAlteracao,
  resumirSeguro,
  totaisDeSeguroPorVigencia,
  VARIAVEIS_DE_SEGURO,
  type LinhaDeSeguro,
  type ValorDeSeguro,
} from "../seguro";

/**
 * A AUDITORIA DE SEGURO E APARATO.
 *
 * O que estes casos prendem é o achado que dá nome à tela — **o aparato não está
 * no custo fixo que o export declara** — e as três recusas que impedem a tela de
 * inventar um total: o rastreador não soma, o custo fixo não soma, e taxa não é
 * negociação.
 */

const linha = (over: Partial<LinhaDeSeguro> = {}): LinhaDeSeguro => ({
  id: 1,
  entityLabel: "QYN7B31",
  entityType: "CARRETA",
  variavel: "seguro",
  rotuloDaVariavel: "Seguro",
  medida: "DINHEIRO",
  attributeCode: "carreta.seguro",
  base: "573.95",
  comparada: "620.00",
  diferenca: 46.05,
  variacao: 8.02,
  estado: "ALTERADO",
  motivo: null,
  baseNumerica: 573.95,
  impactoAmount: 46.05,
  impactoPeriodicidade: "MENSAL",
  impactoCalculado: true,
  foraDaSoma: null,
  ...over,
});

const valor = (over: Partial<ValorDeSeguro> = {}): ValorDeSeguro => ({
  ponta: "BASE",
  entityType: "CARRETA",
  entityLabel: "QYN7B31",
  seguro: 573.95,
  revestimento: 277.94,
  tacografo: 21.03,
  faixaReflexiva: 15.94,
  rastreador: 0,
  custoFixo: 18269.97,
  finame: 16949.92,
  lucroFixoConjunto: 1320.05,
  ...over,
});

describe("o catálogo — a rubrica é só da carreta", () => {
  it("nenhuma variável tem código de cavalo", () => {
    for (const v of VARIAVEIS_DE_SEGURO) {
      expect(v.codigo.CAVALO).toBeUndefined();
      expect(v.codigo.CARRETA).toBeTruthy();
    }
  });

  /* Lista vazia é a resposta certa, e não "peça tudo": quem chama a lê como
     "não há o que pedir para o cavalo". */
  it("o recorte de cavalo devolve lista vazia", () => {
    expect(codigosDoRecorteDeSeguro("CAVALO")).toEqual([]);
    expect(codigosDoRecorteDeSeguro("CARRETA")).toEqual([...CODIGOS_DA_TABELA_DE_SEGURO]);
  });
});

describe("o impacto, e as três coisas que ele recusa", () => {
  it("soma o seguro por periodicidade", () => {
    const impacto = impactoDeSeguro([linha()]);
    expect(impacto.porPeriodicidade).toEqual({ MENSAL: 46.05 });
  });

  /* Zero em 657 de 657 linhas do acervo. Somá-lo daria um total afirmando que
     rastrear custa R$ 0,00 — a mesma recusa do montante de ICMS. */
  it("o rastreador não entra na soma, e sai contado", () => {
    const impacto = impactoDeSeguro([
      linha({
        variavel: "rastreador",
        rotuloDaVariavel: "Rastreador",
        attributeCode: "carreta.rastreador",
        base: "0",
        comparada: "0",
        foraDaSoma: "Zero nas 657 linhas do acervo.",
      }),
    ]);
    expect(impacto.porPeriodicidade).toEqual({});
    expect(impacto.foraDaSoma).toBe(1);
  });

  it("o custo fixo do conjunto também não entra — ele é total", () => {
    const impacto = impactoDeSeguro([
      linha({
        variavel: "custo_fixo",
        rotuloDaVariavel: "Custo fixo do conjunto",
        attributeCode: "carreta.custo_fixo",
        impactoAmount: 500,
        foraDaSoma: "É total, e não parcela.",
      }),
    ]);
    expect(impacto.porPeriodicidade).toEqual({});
    expect(impacto.foraDaSoma).toBe(1);
  });

  /*
    Taxa e negociação somam do mesmo jeito — o dinheiro é real e sai do mesmo
    bolso —, mas contar as duas juntas faria "657 alterações" ser lido como 657
    negociações, quando é uma tabela que mudou.
  */
  it("a taxa soma, mas sai contada à parte", () => {
    const impacto = impactoDeSeguro([
      linha({
        variavel: "revestimento",
        rotuloDaVariavel: "Revestimento",
        attributeCode: "carreta.revestimento",
        impactoAmount: 12,
      }),
      linha(),
    ]);
    expect(impacto.porPeriodicidade).toEqual({ MENSAL: 58.05 });
    expect(impacto.alteracoesDeTaxa).toBe(1);
  });
});

describe("a conferência contra o custo fixo declarado", () => {
  /*
    O achado do acervo, reproduzido: custo_fixo = finame + lucro_fixo, e a sobra
    é zero — logo o aparato está fora.
  */
  it("com a sobra zerada, o veredito é FORA_DO_TOTAL", () => {
    const [c] = conferenciaDoAparato([valor()]);
    expect(c.veredito).toBe("FORA_DO_TOTAL");
    expect(c.ativos).toBe(1);
    expect(c.dentro).toBe(0);
    expect(c.foraEmReais).toBe(888.86);
  });

  it("com a sobra igual ao aparato, o veredito é DENTRO_DO_TOTAL", () => {
    /* 16.949,92 + 1.320,05 + 888,86 de aparato = 19.158,83. */
    const [c] = conferenciaDoAparato([valor({ custoFixo: 19158.83 })]);
    expect(c.veredito).toBe("DENTRO_DO_TOTAL");
    expect(c.dentro).toBe(1);
    expect(c.foraEmReais).toBe(0);
  });

  /* O pior dos vereditos: nenhum total da casa poderia ser somado sem olhar
     linha a linha. */
  it("uma dentro e outra fora dá MISTO", () => {
    const [c] = conferenciaDoAparato([
      valor({ entityLabel: "A", custoFixo: 19158.83 }),
      valor({ entityLabel: "B" }),
    ]);
    expect(c.veredito).toBe("MISTO");
    expect(c.ativos).toBe(2);
    expect(c.dentro).toBe(1);
  });

  it("sem as parcelas do total não há o que conferir", () => {
    const [c] = conferenciaDoAparato([valor({ finame: null })]);
    expect(c.veredito).toBe("BASE_INSUFICIENTE");
    expect(c.ativos).toBe(0);
  });

  /* Um ativo sem aparato nenhum não diz nada sobre a pergunta, e contá-lo como
     "fora" inflaria o veredito com linha vazia. */
  it("o ativo sem aparato fica fora da contagem", () => {
    const [c] = conferenciaDoAparato([
      valor({ seguro: 0, revestimento: 0, tacografo: 0, faixaReflexiva: 0 }),
    ]);
    expect(c.veredito).toBe("BASE_INSUFICIENTE");
  });
});

describe("os totais por vigência", () => {
  it("separa o que é negociado do que é tabela, e não soma o rastreador", () => {
    const [t] = totaisDeSeguroPorVigencia([valor()]);
    expect(t.seguro).toBe(573.95);
    expect(t.taxas).toBe(314.91);
    expect(t.total).toBe(888.86);
    expect(t.veiculos).toBe(1);
  });

  /* 99 das 657 no acervo. É o único zero desta rubrica que convive com valor na
     mesma coluna, e por isso o único que merece contagem. */
  it("conta as carretas sem tacógrafo tarifado", () => {
    const totais = totaisDeSeguroPorVigencia([
      valor({ entityLabel: "A", tacografo: 0 }),
      valor({ entityLabel: "B" }),
    ]);
    expect(totais[0].semTacografo).toBe(1);
  });
});

describe("o resumo e o agrupamento", () => {
  it("o destaque da placa é o seguro, e não a soma do aparato", () => {
    const [veiculo] = agruparPorVeiculoDeSeguro([
      linha(),
      linha({
        id: 2,
        variavel: "revestimento",
        rotuloDaVariavel: "Revestimento",
        base: "277.94",
        comparada: "290.00",
        diferenca: 12.06,
      }),
    ]);
    expect(veiculo.destaque?.base).toBe(573.95);
    expect(veiculo.alteracoes).toBe(2);
  });

  it("sem alteração sai da frota, e não do tamanho da lista", () => {
    const resumo = resumirSeguro([], { comparados: 73, novos: 0, ausentes: 0 });
    expect(resumo.semAlteracao).toBe(73);
    expect(resumo.veiculosComAlteracao).toBe(0);
  });
});

describe("a tradução do motor", () => {
  it("a alteração de uma coluna do aparato vira linha", () => {
    const l = linhaDeSeguroDaAlteracao({
      id: 7,
      changeType: "ATTRIBUTE_CHANGED",
      attributeCode: "carreta.seguro",
      entityLabel: "QYN7B31",
      entityType: "CARRETA",
      valueBefore: "573.95",
      valueAfter: "620.00",
      deltaAbsolute: "46.05",
      deltaPercent: "8.02",
      comparability: "COMPARABLE",
    });
    expect(l?.variavel).toBe("seguro");
    expect(l?.estado).toBe("ALTERADO");
    expect(l?.diferenca).toBe(46.05);
  });

  it("o que não é desta rubrica não vira linha", () => {
    const l = linhaDeSeguroDaAlteracao({
      changeType: "ATTRIBUTE_CHANGED",
      attributeCode: "cavalo.finame_cavalo",
      entityLabel: "QYQ6A80",
      entityType: "CAVALO",
      valueBefore: "1",
      valueAfter: "2",
      deltaAbsolute: "1",
      deltaPercent: null,
      comparability: "COMPARABLE",
    });
    expect(l).toBeNull();
  });
});
