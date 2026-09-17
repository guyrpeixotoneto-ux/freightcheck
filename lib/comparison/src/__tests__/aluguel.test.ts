import { describe, expect, it } from "vitest";
import {
  agruparPorVeiculoDeAluguel,
  conferenciaDoAluguel,
  impactoDeAluguel,
  linhasDeAluguel,
  totaisDeAluguelPorVigencia,
  VARIAVEIS_DE_ALUGUEL,
  VARIAVEIS_DE_DETALHE_DE_ALUGUEL,
  variavelDeAluguelDoCodigo,
  type ValorDeAluguel,
} from "../aluguel";
import { cobertasPorParcelasEm, impactoPorPeriodicidade, linhasDeFiname } from "../finame";
import type { AlteracaoDoMotor } from "../recorte-de-rubrica";

/**
 * A AUDITORIA DE ALUGUEL DE FROTA, sem banco e sem tela.
 *
 * O que estes testes prendem são as decisões que `docs/ACHADO-ALUGUEL.md` mediu
 * e que uma refatoração desatenta desfaria sem nada parecer quebrado:
 *
 * 1. o aluguel **soma** — diferente da aquisição, ele é dinheiro do mês;
 * 2. a parcela FINAME **não** soma aqui, porque nos alugados ela contém o
 *    aluguel — e a recíproca vale do outro lado, onde a parcela sai do total do
 *    FINAME quando o aluguel se move. É o par que impede a dupla contagem, e
 *    está aferido nos dois sentidos;
 * 3. o aluguel do cavalo não soma: zero em 558 linhas, semântica presumida;
 * 4. a conferência só olha quem declara aluguel, e acusa o implemento que
 *    declarasse aluguel e financiamento ao mesmo tempo.
 */

function alteracao(parcial: Partial<AlteracaoDoMotor>): AlteracaoDoMotor {
  return {
    id: 1,
    changeType: "VALUE_CHANGED",
    attributeCode: "carreta.custo_aluguel",
    entityLabel: "CUL0J25",
    entityType: "CARRETA",
    valueBefore: "5363.55",
    valueAfter: "5663.55",
    deltaAbsolute: 300,
    deltaPercent: 5.59,
    comparability: "COMPARABLE",
    impactConfidence: "CALCULATED",
    impactAmount: 300,
    impactPeriodicity: "MENSAL",
    ...parcial,
  };
}

function valor(parcial: Partial<ValorDeAluguel>): ValorDeAluguel {
  return {
    ponta: "BASE",
    entityType: "CARRETA",
    entityLabel: "CUL0J25",
    aluguel: 5363.55,
    parcela: 5363.55,
    amortizacao: 0,
    juros: 0,
    ...parcial,
  };
}

describe("o catálogo", () => {
  it("tem o aluguel como rubrica e a parcela FINAME como conferência", () => {
    const aluguel = VARIAVEIS_DE_ALUGUEL.find((v) => v.chave === "aluguel");
    const parcela = VARIAVEIS_DE_ALUGUEL.find((v) => v.chave === "parcela_finame");
    expect(aluguel?.foraDaSoma).toBeUndefined();
    expect(parcela?.foraDaSoma).toBeTruthy();
  });

  it("é só da carreta — o cavalo não tem aluguel na identidade dele", () => {
    const aluguel = VARIAVEIS_DE_ALUGUEL.find((v) => v.chave === "aluguel");
    expect(aluguel?.codigo.CARRETA).toBe("carreta.custo_aluguel");
    expect(aluguel?.codigo.CAVALO).toBeUndefined();
  });

  it("mantém a coluna do cavalo no detalhe, fora da soma e com a razão escrita", () => {
    const doCavalo = VARIAVEIS_DE_DETALHE_DE_ALUGUEL.find((v) => v.chave === "aluguel_cavalo");
    expect(doCavalo?.codigo.CAVALO).toBe("cavalo.custo_aluguel");
    expect(doCavalo?.foraDaSoma).toBeTruthy();
  });

  it("acha a variável de um código e devolve nada para o que não é da rubrica", () => {
    expect(variavelDeAluguelDoCodigo("carreta.custo_aluguel")?.chave).toBe("aluguel");
    expect(variavelDeAluguelDoCodigo("cavalo.ipva_licenciamento")).toBeUndefined();
  });
});

describe("as linhas", () => {
  it("traduz a alteração do aluguel e descarta o que não é da rubrica", () => {
    const linhas = linhasDeAluguel([
      alteracao({}),
      alteracao({ id: 2, attributeCode: "cavalo.ipva_licenciamento" }),
    ]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      variavel: "aluguel",
      diferenca: 300,
      estado: "ALTERADO",
    });
    expect(linhas[0].foraDaSoma).toBeNull();
  });

  it("deixa passar a entrada e a saída de ativo, que não citam atributo", () => {
    const linhas = linhasDeAluguel([
      alteracao({ changeType: "ENTITY_ADDED", attributeCode: null }),
    ]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].variavel).toBe("veiculo");
    expect(linhas[0].estado).toBe("NOVO_NA_VIGENCIA");
  });
});

describe("o impacto", () => {
  it("soma o aluguel no balde mensal", () => {
    const impacto = impactoDeAluguel(linhasDeAluguel([alteracao({})]));
    expect(impacto.porPeriodicidade).toEqual({ MENSAL: 300 });
    expect(impacto.alugueisAlterados).toBe(1);
  });

  it("não soma a parcela FINAME junto, que nos alugados é o mesmo dinheiro", () => {
    /*
      O caso real: nos implementos alugados a parcela **é** o aluguel, e as duas
      chegam alteradas pelo mesmo valor. Somar as duas publicaria R$ 600,00 de
      aumento onde houve R$ 300,00.
    */
    const impacto = impactoDeAluguel(
      linhasDeAluguel([
        alteracao({}),
        alteracao({ id: 2, attributeCode: "carreta.finame_implemento" }),
      ]),
    );
    expect(impacto.porPeriodicidade).toEqual({ MENSAL: 300 });
    expect(impacto.foraDaSoma).toBe(1);
  });

  it("não soma o aluguel do cavalo", () => {
    const impacto = impactoDeAluguel(
      linhasDeAluguel([
        alteracao({ attributeCode: "cavalo.custo_aluguel", entityType: "CAVALO" }),
      ]),
    );
    expect(impacto.porPeriodicidade).toEqual({});
    expect(impacto.foraDaSoma).toBe(1);
  });
});

describe("a outra metade da garantia, do lado do FINAME", () => {
  it("tira a parcela do total quando o aluguel do mesmo veículo se move", () => {
    /*
      A recíproca do teste acima, medida pela régua do FINAME: com a parcela e o
      aluguel alterados no mesmo implemento, quem sai do total de lá é a parcela.
      É a regra de `cobertasPorParcelasEm` — agora com a terceira parcela dentro
      dela —, e é ela que fecha o par que impede a dupla contagem.
    */
    const linhas = linhasDeFiname([
      alteracao({ id: 1, attributeCode: "carreta.custo_aluguel" }),
      alteracao({ id: 2, attributeCode: "carreta.finame_implemento" }),
    ]);
    const cobertas = cobertasPorParcelasEm(linhas);
    expect(cobertas.size).toBe(1);

    const impacto = impactoPorPeriodicidade(linhas);
    /* O aluguel sai por ser rubrica de outro módulo; a parcela, por estar
       coberta pelas parcelas dela. Nada sobra para o FINAME somar. */
    expect(impacto.porPeriodicidade).toEqual({});
    expect(impacto.cobertasPorParcelas).toBe(1);
    expect(impacto.foraDaSoma).toBe(1);
  });

  it("continua somando a parcela quando o aluguel não se move", () => {
    /* A frota financiada não muda de comportamento por causa desta mudança. */
    const linhas = linhasDeFiname([
      alteracao({
        id: 3,
        attributeCode: "carreta.finame_implemento",
        entityLabel: "QYW6D15",
      }),
    ]);
    expect(impactoPorPeriodicidade(linhas).porPeriodicidade).toEqual({ MENSAL: 300 });
  });
});

describe("a conferência da parcela", () => {
  it("chama de aluguel integral quando a parcela é o aluguel em todos", () => {
    const [c] = conferenciaDoAluguel([valor({}), valor({ entityLabel: "FCW7D86" })]);
    expect(c.veredito).toBe("ALUGUEL_INTEGRAL");
    expect(c.alugados).toBe(2);
    expect(c.parcelaEhOAluguel).toBe(2);
    expect(c.totalMensal).toBe(10727.1);
  });

  it("acusa o implemento que declara aluguel e financiamento ao mesmo tempo", () => {
    const [c] = conferenciaDoAluguel([
      valor({}),
      valor({ entityLabel: "FCW7D86", amortizacao: 1000, parcela: 6363.55 }),
    ]);
    expect(c.veredito).toBe("MISTO");
    expect(c.mistos).toBe(1);
  });

  it("não cobra a identidade de quem não declara aluguel", () => {
    const [c] = conferenciaDoAluguel([
      valor({ aluguel: 0, parcela: 8500, amortizacao: 7000, juros: 1500 }),
    ]);
    expect(c.veredito).toBe("SEM_ALUGUEL");
    expect(c.alugados).toBe(0);
  });

  it("tolera um centavo de arredondamento, como a composição", () => {
    const [c] = conferenciaDoAluguel([valor({ parcela: 5363.56 })]);
    expect(c.veredito).toBe("ALUGUEL_INTEGRAL");
  });
});

describe("o total mensal", () => {
  it("soma só os alugados, e diz que fração da frota eles são", () => {
    const totais = totaisDeAluguelPorVigencia([
      valor({ aluguel: 5363.55 }),
      valor({ entityLabel: "FCW7D86", aluguel: 6414.37 }),
      valor({ entityLabel: "QYW6D15", aluguel: 0 }),
      valor({ entityLabel: "QYW2F98", aluguel: 0 }),
    ]);
    expect(totais).toHaveLength(1);
    expect(totais[0]).toMatchObject({ total: 11777.92, ativos: 4, alugados: 2 });
    expect(totais[0].fracaoAlugada).toBe(0.5);
  });

  it("separa as pontas e os tipos", () => {
    const totais = totaisDeAluguelPorVigencia([
      valor({}),
      valor({ ponta: "COMPARADA" }),
      valor({ entityType: "CAVALO", aluguel: 0 }),
    ]);
    expect(totais).toHaveLength(3);
  });
});

describe("o agrupamento por placa", () => {
  it("junta o aluguel e a parcela da mesma placa numa linha só", () => {
    const veiculos = agruparPorVeiculoDeAluguel(
      linhasDeAluguel([
        alteracao({}),
        alteracao({ id: 2, attributeCode: "carreta.finame_implemento" }),
      ]),
    );
    expect(veiculos).toHaveLength(1);
    expect(veiculos[0].alteracoes).toBe(2);
  });
});
