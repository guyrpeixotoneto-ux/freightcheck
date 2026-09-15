import { describe, expect, it } from "vitest";
import {
  CODIGOS_DA_TABELA,
  CODIGOS_DO_DETALHE,
  agruparPorVeiculo,
  alteracoesPorVariavel,
  celulasDoCsv,
  codigoDaVariavel,
  comContextoDoVeiculo,
  distribuicaoPorEstado,
  estadoDaAlteracao,
  impactoPorPeriodicidade,
  linhaDaAlteracao,
  linhaSemAlteracao,
  linhasDeFiname,
  resumirFiname,
  totaisPorVigencia,
  variavelDoCodigo,
  VARIAVEIS_DE_FINAME,
  type AlteracaoDoMotor,
} from "../finame";

/**
 * O que estes testes prendem.
 *
 * O módulo não compara nada — comparar é do `engine` —, então aqui não há
 * snapshot, banco nem fixture de export. O que se prende é a **tradução**: uma
 * linha do motor entra, e sai o estado, o número e a agregação que a tela
 * mostra. Os casos foram escolhidos pelos erros que custariam caro: um nulo
 * lido como zero, uma incomparabilidade classificada como alteração, um total
 * somado junto com as parcelas dele e duas periodicidades no mesmo balde.
 */

const alteracao = (over: Partial<AlteracaoDoMotor> = {}): AlteracaoDoMotor => ({
  changeType: "VALUE_CHANGED",
  nature: "NUMERIC",
  attributeCode: "cavalo.finame_cavalo",
  entityLabel: "ABC1D23",
  entityType: "CAVALO",
  valueBefore: "8450",
  valueAfter: "8760",
  isNullBefore: false,
  isNullAfter: false,
  deltaAbsolute: "310",
  deltaPercent: "3.668639",
  comparability: "COMPARABLE",
  impactConfidence: "CALCULATED",
  impactAmount: "310",
  impactPeriodicity: "MENSAL",
  ...over,
});

describe("o catálogo das variáveis", () => {
  it("dá a cada tipo o código que ele de fato tem", () => {
    const parcela = VARIAVEIS_DE_FINAME.find((v) => v.chave === "parcela")!;
    expect(codigoDaVariavel(parcela, "CAVALO")).toBe("cavalo.finame_cavalo");
    // Decisão B: o implemento, e não `carreta.finame`, que é cavalo + implemento.
    expect(codigoDaVariavel(parcela, "CARRETA")).toBe("carreta.finame_implemento");
    expect(codigoDaVariavel(parcela, "TRECHO")).toBeUndefined();
  });

  it("não força equivalência onde o tipo não tem a coluna", () => {
    const status = variavelDoCodigo("carreta.status_financiamento")!;
    expect(status.codigo.CAVALO).toBeUndefined();
    expect(status.codigo.CARRETA).toBe("carreta.status_financiamento");
  });

  it("mantém o total composto fora do recorte da tabela e dentro do detalhe", () => {
    expect(CODIGOS_DA_TABELA).not.toContain("carreta.finame");
    expect(CODIGOS_DO_DETALHE).toContain("carreta.finame");
    expect(variavelDoCodigo("carreta.finame")!.totalComposto).toBe(true);
  });

  it("recorta as doze variáveis nos dois tipos, sem repetir código", () => {
    expect(new Set(CODIGOS_DA_TABELA).size).toBe(CODIGOS_DA_TABELA.length);
    expect(CODIGOS_DA_TABELA).toContain("cavalo.periodo_finame");
    expect(CODIGOS_DA_TABELA).toContain("carreta.periodo_finame");
  });
});

describe("os seis estados", () => {
  it("chama de alterado o que o motor comparou", () => {
    expect(estadoDaAlteracao(alteracao())).toBe("ALTERADO");
  });

  it("chama de novo o veículo e a coluna que aparecem na comparada", () => {
    expect(estadoDaAlteracao(alteracao({ changeType: "ENTITY_ADDED" }))).toBe(
      "NOVO_NA_VIGENCIA",
    );
    expect(estadoDaAlteracao(alteracao({ changeType: "ATTRIBUTE_ADDED" }))).toBe(
      "NOVO_NA_VIGENCIA",
    );
  });

  it("chama de ausente o que existia na base e não aparece na comparada", () => {
    expect(estadoDaAlteracao(alteracao({ changeType: "ENTITY_REMOVED" }))).toBe(
      "AUSENTE_NA_COMPARADA",
    );
    expect(estadoDaAlteracao(alteracao({ changeType: "ATTRIBUTE_REMOVED" }))).toBe(
      "AUSENTE_NA_COMPARADA",
    );
  });

  it("separa dado incompleto de conflito — são buracos diferentes", () => {
    const apareceu = alteracao({
      nature: "APPEARED",
      comparability: "INCONCLUSIVE",
      isNullBefore: true,
      nullReasonBefore: "VALUE_MISSING",
    });
    expect(estadoDaAlteracao(apareceu)).toBe("DADO_INCOMPLETO");

    const sumiu = alteracao({ nature: "DISAPPEARED", comparability: "INCONCLUSIVE" });
    expect(estadoDaAlteracao(sumiu)).toBe("DADO_INCOMPLETO");

    const motivoMudou = alteracao({ nature: "NULL_REASON", comparability: "INCONCLUSIVE" });
    expect(estadoDaAlteracao(motivoMudou)).toBe("DADO_INCOMPLETO");

    const semantica = alteracao({
      nature: "SEMANTICS_DRIFT",
      comparability: "INCONCLUSIVE",
    });
    expect(estadoDaAlteracao(semantica)).toBe("CONFLITO");

    const tipo = alteracao({ nature: "TYPE_CHANGE", comparability: "INCONCLUSIVE" });
    expect(estadoDaAlteracao(tipo)).toBe("CONFLITO");
  });

  it("nunca chama de alterado o que o motor recusou comparar", () => {
    const recusado = alteracao({
      comparability: "INCONCLUSIVE",
      nature: "TYPE_CHANGE",
      deltaAbsolute: null,
      deltaPercent: null,
    });
    expect(estadoDaAlteracao(recusado)).not.toBe("ALTERADO");
  });
});

describe("a linha da tabela", () => {
  it("traz a diferença e a variação como o motor as gravou", () => {
    const linha = linhaDaAlteracao(alteracao())!;
    expect(linha.diferenca).toBe(310);
    expect(linha.variacao).toBeCloseTo(3.668639, 6);
    expect(linha.rotuloDaVariavel).toBe("Parcela FINAME");
    expect(linha.medida).toBe("DINHEIRO");
  });

  it("mantém nulo o que não tem diferença — ausência não vira zero", () => {
    const linha = linhaDaAlteracao(
      alteracao({
        nature: "APPEARED",
        comparability: "INCONCLUSIVE",
        valueBefore: null,
        isNullBefore: true,
        nullReasonBefore: "EMPTY",
        deltaAbsolute: null,
        deltaPercent: null,
        impactConfidence: "NOT_CALCULABLE",
        impactAmount: null,
      }),
    )!;
    expect(linha.diferenca).toBeNull();
    expect(linha.variacao).toBeNull();
    expect(linha.base).toBeNull();
    expect(linha.estado).toBe("DADO_INCOMPLETO");
  });

  it("deixa a variação nula quando a base é zero, com a diferença de pé", () => {
    const linha = linhaDaAlteracao(
      alteracao({
        nature: "FROM_ZERO",
        valueBefore: "0",
        valueAfter: "1200",
        deltaAbsolute: "1200",
        deltaPercent: null,
        impactAmount: "1200",
      }),
    )!;
    expect(linha.diferenca).toBe(1200);
    expect(linha.variacao).toBeNull();
    expect(linha.estado).toBe("ALTERADO");
  });

  it("descarta o que não é de FINAME e o total composto", () => {
    expect(linhaDaAlteracao(alteracao({ attributeCode: "cavalo.valor_pneu" }))).toBeNull();
    expect(
      linhaDaAlteracao(
        alteracao({ attributeCode: "carreta.finame", entityType: "CARRETA" }),
      ),
    ).toBeNull();
  });

  it("mantém a entrada e a saída de ativo, que não citam atributo", () => {
    const entrou = linhaDaAlteracao(
      alteracao({
        changeType: "ENTITY_ADDED",
        attributeCode: null,
        valueBefore: null,
        valueAfter: "presente",
        deltaAbsolute: null,
        deltaPercent: null,
        impactConfidence: "NOT_CALCULABLE",
        impactAmount: null,
      }),
    )!;
    expect(entrou.estado).toBe("NOVO_NA_VIGENCIA");
    expect(entrou.variavel).toBe("veiculo");
  });

  it("monta a linha sem alteração com os dois lados iguais", () => {
    const linha = linhaSemAlteracao({
      entityLabel: "ABC1D23",
      entityType: "CAVALO",
      attributeCode: "cavalo.taxa_finame",
      valor: "9.5",
    })!;
    expect(linha.estado).toBe("SEM_ALTERACAO");
    expect(linha.base).toBe("9.5");
    expect(linha.comparada).toBe("9.5");
    expect(linha.diferenca).toBeNull();
    expect(linha.id).toBeNull();
  });
});

describe("o impacto financeiro", () => {
  it("não soma um total junto com as parcelas dele", () => {
    const linhas = linhasDeFiname([
      alteracao({ attributeCode: "cavalo.finame_cavalo", impactAmount: "310" }),
      alteracao({
        attributeCode: "cavalo.juros_finame_cavalo",
        deltaAbsolute: "121.4",
        impactAmount: "121.4",
      }),
      alteracao({
        attributeCode: "cavalo.amortizacao_cavalo",
        deltaAbsolute: "188.6",
        impactAmount: "188.6",
      }),
    ]);
    const impacto = impactoPorPeriodicidade(linhas);
    // 121,40 + 188,60 = 310,00 — a parcela sai porque as partes já a representam.
    expect(impacto.porPeriodicidade.MENSAL).toBe(310);
    expect(impacto.cobertasPorParcelas).toBe(1);
  });

  it("conta a parcela quando as partes dela não se moveram", () => {
    const linhas = linhasDeFiname([alteracao({ impactAmount: "310" })]);
    expect(impactoPorPeriodicidade(linhas).porPeriodicidade).toEqual({ MENSAL: 310 });
    expect(impactoPorPeriodicidade(linhas).cobertasPorParcelas).toBe(0);
  });

  it("nunca mistura periodicidades num total único", () => {
    const linhas = linhasDeFiname([
      alteracao({ impactAmount: "310", impactPeriodicity: "MENSAL" }),
      alteracao({
        attributeCode: "cavalo.valor_nf_compra",
        deltaAbsolute: "5000",
        impactAmount: "5000",
        impactPeriodicity: "UNICO",
      }),
    ]);
    const { porPeriodicidade } = impactoPorPeriodicidade(linhas);
    expect(porPeriodicidade).toEqual({ MENSAL: 310, UNICO: 5000 });
  });

  it("não monetiza taxa e prazo, e não os conta como falha de cálculo", () => {
    const linhas = linhasDeFiname([
      alteracao({
        attributeCode: "cavalo.taxa_finame",
        valueBefore: "9.5",
        valueAfter: "10",
        deltaAbsolute: "0.5",
        deltaPercent: "5.263158",
        impactConfidence: "NOT_CALCULABLE",
        impactAmount: null,
        impactPeriodicity: null,
      }),
      alteracao({
        attributeCode: "cavalo.periodo_finame",
        valueBefore: "60",
        valueAfter: "48",
        deltaAbsolute: "-12",
        deltaPercent: "-20",
        impactConfidence: "NOT_CALCULABLE",
        impactAmount: null,
        impactPeriodicity: null,
      }),
    ]);
    const impacto = impactoPorPeriodicidade(linhas);
    expect(impacto.porPeriodicidade).toEqual({});
    expect(impacto.naoCalculavel).toBe(0);
  });

  it("conta como não precificada a rubrica monetária que o motor não soube calcular", () => {
    const linhas = linhasDeFiname([
      alteracao({ impactConfidence: "NOT_CALCULABLE", impactAmount: null }),
    ]);
    expect(impactoPorPeriodicidade(linhas).naoCalculavel).toBe(1);
  });

  it("ignora o que não foi comparado", () => {
    const linhas = linhasDeFiname([
      alteracao({
        comparability: "INCONCLUSIVE",
        nature: "SEMANTICS_DRIFT",
        deltaAbsolute: null,
        impactConfidence: "NOT_CALCULABLE",
        impactAmount: null,
      }),
    ]);
    expect(impactoPorPeriodicidade(linhas).porPeriodicidade).toEqual({});
  });

  it("inverter o par inverte o sinal da diferença e do impacto", () => {
    const ida = linhasDeFiname([alteracao()]);
    const volta = linhasDeFiname([
      alteracao({
        valueBefore: "8760",
        valueAfter: "8450",
        deltaAbsolute: "-310",
        // 310/8760 — a base do percentual é a outra, então a magnitude muda.
        deltaPercent: "-3.538813",
        impactAmount: "-310",
      }),
    ]);
    expect(ida[0].diferenca).toBe(310);
    expect(volta[0].diferenca).toBe(-310);
    expect(impactoPorPeriodicidade(volta).porPeriodicidade.MENSAL).toBe(-310);
    // O sinal espelha; a magnitude do percentual não — e é assim que tem de ser.
    expect(volta[0].variacao).not.toBeCloseTo(-ida[0].variacao!, 6);
  });
});

describe("os indicadores e as séries", () => {
  const frota = { comparados: 310, novos: 5, ausentes: 3 };

  it("conta veículos, não linhas", () => {
    const linhas = linhasDeFiname([
      alteracao(),
      alteracao({ attributeCode: "cavalo.juros_finame_cavalo", impactAmount: "121.4" }),
      alteracao({ entityLabel: "DEF2G45", entityType: "CARRETA", attributeCode: "carreta.finame_implemento" }),
    ]);
    const resumo = resumirFiname(linhas, frota);
    expect(resumo.veiculosComAlteracao).toBe(2);
    expect(resumo.variaveisAlteradas).toBe(3);
    expect(resumo.veiculosComparados).toBe(310);
    expect(resumo.semAlteracao).toBe(308);
    expect(resumo.novosNaVigencia).toBe(5);
    expect(resumo.ausentesNaComparada).toBe(3);
  });

  it("não chama de 'sem alteração' o veículo que caiu em conflito", () => {
    /*
      O caso que a primeira renderização sobre dado real mostrou: 62 veículos
      com `data_fim_contrato` entregue com dois tipos no mesmo import. Eles não
      mudaram de valor e também não estão em ordem — e o cartão não pode
      contá-los junto com quem passou limpo, ou ele e a rosca ao lado dizem
      números diferentes sobre os mesmos veículos.
    */
    const linhas = linhasDeFiname([
      alteracao({
        entityLabel: "GHI3J67",
        attributeCode: "cavalo.data_fim_contrato",
        comparability: "INCONCLUSIVE",
        nature: "TYPE_CHANGE",
        deltaAbsolute: null,
        deltaPercent: null,
        impactConfidence: "NOT_CALCULABLE",
        impactAmount: null,
      }),
      alteracao({ entityLabel: "JKL4M89", nature: "APPEARED", comparability: "INCONCLUSIVE" }),
    ]);
    const resumo = resumirFiname(linhas, frota);
    expect(resumo.veiculosComConflito).toBe(1);
    expect(resumo.veiculosComDadoIncompleto).toBe(1);
    expect(resumo.veiculosComAlteracao).toBe(0);
    // 310 comparados − 1 em conflito − 1 incompleto.
    expect(resumo.semAlteracao).toBe(308);

    // E o cartão fecha com a rosca: as duas leituras contam os mesmos veículos.
    const fatias = distribuicaoPorEstado(linhas, frota);
    expect(fatias.find((f) => f.estado === "SEM_ALTERACAO")!.veiculos).toBe(
      resumo.semAlteracao,
    );
  });

  it("diz 'nada mudou' quando nada mudou, em vez de zerar o comparado", () => {
    const resumo = resumirFiname([], frota);
    expect(resumo.semAlteracao).toBe(310);
    expect(resumo.veiculosComAlteracao).toBe(0);
    expect(resumo.impacto.porPeriodicidade).toEqual({});
  });

  it("ordena as variáveis pela quantidade de alterações", () => {
    const linhas = linhasDeFiname([
      alteracao(),
      alteracao({ entityLabel: "DEF2G45" }),
      alteracao({ attributeCode: "cavalo.taxa_finame", impactConfidence: "NOT_CALCULABLE", impactAmount: null }),
    ]);
    const barras = alteracoesPorVariavel(linhas);
    expect(barras.map((b) => [b.variavel, b.alteracoes])).toEqual([
      ["parcela", 2],
      ["taxa", 1],
    ]);
  });

  /*
    O defeito que este caso prende: o cartão dizia "31 variáveis alteradas" ao
    lado de um gráfico cuja legenda somava 19, sobre as mesmas linhas. As doze
    que faltavam eram de variáveis que só o detalhe mostra — a TJLP, que se move
    para a frota inteira de uma vez —, descartadas por um filtro que só olhava o
    catálogo da tabela.
  */
  it("conta também as variáveis que só o detalhe mostra, e fecha com o cartão", () => {
    const linhas = linhasDeFiname([
      alteracao(),
      alteracao({ entityLabel: "DEF2G45" }),
      alteracao({
        attributeCode: "cavalo.tjlp",
        impactConfidence: "NOT_CALCULABLE",
        impactAmount: null,
        impactPeriodicity: null,
      }),
      alteracao({
        entityLabel: "DEF2G45",
        attributeCode: "cavalo.tjlp",
        impactConfidence: "NOT_CALCULABLE",
        impactAmount: null,
        impactPeriodicity: null,
      }),
    ]);
    const barras = alteracoesPorVariavel(linhas);
    expect(barras.map((b) => [b.variavel, b.alteracoes])).toEqual([
      ["parcela", 2],
      ["tjlp", 2],
    ]);
    // A legenda do gráfico e o cartão contam a mesma coisa — sempre.
    expect(barras.reduce((acc, b) => acc + b.alteracoes, 0)).toBe(
      resumirFiname(linhas, frota).variaveisAlteradas,
    );
  });

  /* O total composto da carreta continua fora, e por onde sempre esteve: ele
     não chega a virar linha. */
  it("não dá barra ao total composto da carreta", () => {
    const linhas = linhasDeFiname([
      alteracao({ entityType: "CARRETA", attributeCode: "carreta.finame" }),
    ]);
    expect(linhas).toHaveLength(0);
    expect(alteracoesPorVariavel(linhas)).toEqual([]);
  });

  it("dá um estado por veículo, e as fatias fecham no total", () => {
    const linhas = linhasDeFiname([
      alteracao(),
      alteracao({
        attributeCode: "cavalo.valor_pis_cofins",
        comparability: "INCONCLUSIVE",
        nature: "SEMANTICS_DRIFT",
      }),
      alteracao({ entityLabel: "DEF2G45", entityType: "CARRETA", attributeCode: "carreta.finame_implemento" }),
    ]);
    const fatias = distribuicaoPorEstado(linhas, frota);
    const soma = fatias.reduce((acc, f) => acc + f.veiculos, 0);
    expect(soma).toBe(318);
    expect(fatias.reduce((acc, f) => acc + f.fracao, 0)).toBeCloseTo(1, 6);
    // ABC1D23 tem uma alteração e um conflito: ele conta uma vez, como conflito.
    expect(fatias.find((f) => f.estado === "CONFLITO")!.veiculos).toBe(1);
    expect(fatias.find((f) => f.estado === "ALTERADO")!.veiculos).toBe(1);
  });

  it("soma o total por vigência só pela parcela, sem juros nem total composto", () => {
    const totais = totaisPorVigencia([
      { ponta: "BASE", entityType: "CAVALO", attributeCode: "cavalo.finame_cavalo", valor: 8450 },
      { ponta: "BASE", entityType: "CAVALO", attributeCode: "cavalo.juros_finame_cavalo", valor: 2180 },
      { ponta: "BASE", entityType: "CAVALO", attributeCode: "cavalo.finame_cavalo", valor: 1550 },
      { ponta: "COMPARADA", entityType: "CAVALO", attributeCode: "cavalo.finame_cavalo", valor: 8760 },
      { ponta: "BASE", entityType: "CARRETA", attributeCode: "carreta.finame", valor: 11570 },
      { ponta: "BASE", entityType: "CARRETA", attributeCode: "carreta.finame_implemento", valor: 3120 },
      { ponta: "BASE", entityType: "CARRETA", attributeCode: "carreta.finame_implemento", valor: null },
    ]);
    expect(totais).toEqual([
      { ponta: "BASE", entityType: "CARRETA", total: 3120, veiculos: 1 },
      { ponta: "BASE", entityType: "CAVALO", total: 10000, veiculos: 2 },
      { ponta: "COMPARADA", entityType: "CAVALO", total: 8760, veiculos: 1 },
    ]);
  });
});

describe("a exportação", () => {
  it("leva número cru e o rótulo do estado, sem formatar dinheiro", () => {
    const linha = linhaDaAlteracao(alteracao())!;
    expect(celulasDoCsv(linha)).toEqual([
      "ABC1D23",
      "CAVALO",
      null,
      null,
      "Parcela FINAME",
      "8450",
      "8760",
      310,
      3.668639,
      "Alterado",
      null,
      null,
    ]);
  });

  it("leva o contexto do veículo e a justificativa que o gestor escreveu", () => {
    const [linha] = comContextoDoVeiculo([linhaDaAlteracao(alteracao())!], {
      comparada: [
        {
          entityLabel: "ABC1D23",
          entityType: "CAVALO",
          periodo: "60",
          dataDeCadastro: "2019-05-10",
        },
      ],
    });
    expect(celulasDoCsv(linha!, "Fim do contrato em 2024.").slice(2, 4)).toEqual([
      "60",
      "2019-05-10",
    ]);
    expect(celulasDoCsv(linha!, "Fim do contrato em 2024.").at(-1)).toBe(
      "Fim do contrato em 2024.",
    );
  });

  it("leva o motivo da recusa quando não há número", () => {
    const linha = linhaDaAlteracao(
      alteracao({
        comparability: "INCONCLUSIVE",
        nature: "TYPE_CHANGE",
        deltaAbsolute: null,
        deltaPercent: null,
        inconclusiveReason: "O tipo do valor mudou entre os dois snapshots.",
      }),
    )!;
    expect(celulasDoCsv(linha).slice(7)).toEqual([
      null,
      null,
      "Conflito",
      "O tipo do valor mudou entre os dois snapshots.",
      null,
    ]);
  });
});

describe("o contexto do veículo", () => {
  const linhas = () => [
    linhaDaAlteracao(alteracao())!,
    linhaDaAlteracao(
      alteracao({ entityLabel: "XYZ9K88", attributeCode: "cavalo.amortizacao_cavalo" }),
    )!,
  ];

  it("repete o prazo e a data do veículo em todas as linhas dele", () => {
    const comContexto = comContextoDoVeiculo(linhas(), {
      comparada: [
        {
          entityLabel: "ABC1D23",
          entityType: "CAVALO",
          periodo: "60",
          dataDeCadastro: "2019-05-10",
        },
      ],
    });
    expect(comContexto[0]!.periodoFiname).toBe("60");
    expect(comContexto[0]!.dataDeCadastro).toBe("2019-05-10");
    // O veículo que a leitura não trouxe continua sem contexto — e não com zero.
    expect(comContexto[1]!.periodoFiname).toBeNull();
    expect(comContexto[1]!.dataDeCadastro).toBeNull();
    expect(comContexto).toHaveLength(2);
  });

  it("deixa a comparada mandar, e usa a base só para o veículo que saiu", () => {
    const comContexto = comContextoDoVeiculo(linhas(), {
      base: [
        {
          entityLabel: "ABC1D23",
          entityType: "CAVALO",
          periodo: "48",
          dataDeCadastro: "2018-01-02",
        },
        {
          entityLabel: "XYZ9K88",
          entityType: "CAVALO",
          periodo: "36",
          dataDeCadastro: "2017-03-04",
        },
      ],
      comparada: [
        {
          entityLabel: "ABC1D23",
          entityType: "CAVALO",
          periodo: "60",
          dataDeCadastro: "2019-05-10",
        },
      ],
    });
    expect(comContexto[0]!.periodoFiname).toBe("60");
    expect(comContexto[0]!.dataDeCadastro).toBe("2019-05-10");
    // Ausente na comparada: o contexto da base é o único que existe.
    expect(comContexto[1]!.periodoFiname).toBe("36");
    expect(comContexto[1]!.dataDeCadastro).toBe("2017-03-04");
  });

  it("não deixa um campo em branco apagar o que a base já dizia", () => {
    const [linha] = comContextoDoVeiculo([linhaDaAlteracao(alteracao())!], {
      base: [
        {
          entityLabel: "ABC1D23",
          entityType: "CAVALO",
          periodo: "48",
          dataDeCadastro: "2018-01-02",
        },
      ],
      comparada: [
        {
          entityLabel: "ABC1D23",
          entityType: "CAVALO",
          periodo: "",
          dataDeCadastro: null,
        },
      ],
    });
    expect(linha!.periodoFiname).toBe("48");
    expect(linha!.dataDeCadastro).toBe("2018-01-02");
  });
});

describe("o agrupamento por veículo", () => {
  /* Duas placas: uma que moveu parcela, juros e prazo, e outra que moveu só a
     amortização — o recorte mínimo em que a ordem e a contagem importam. */
  const recorte = () =>
    linhasDeFiname([
      alteracao({ entityLabel: "ABC1D23", attributeCode: "cavalo.finame_cavalo" }),
      alteracao({
        entityLabel: "ABC1D23",
        attributeCode: "cavalo.juros_finame_cavalo",
        valueBefore: "2180",
        valueAfter: "2301",
        deltaAbsolute: "121",
        deltaPercent: "5.550459",
      }),
      alteracao({
        entityLabel: "ABC1D23",
        attributeCode: "cavalo.periodo_finame",
        valueBefore: "60",
        valueAfter: "48",
        deltaAbsolute: "-12",
        deltaPercent: "-20",
        impactConfidence: "NOT_APPLICABLE",
        impactAmount: null,
        impactPeriodicity: null,
      }),
      alteracao({
        entityLabel: "XYZ9K88",
        attributeCode: "cavalo.amortizacao_cavalo",
        valueBefore: "6270",
        valueAfter: "5900",
        deltaAbsolute: "-370",
        deltaPercent: "-5.901116",
      }),
    ]);

  it("junta as variáveis da mesma placa numa linha só, sem perder nenhuma", () => {
    const veiculos = agruparPorVeiculo(recorte());
    expect(veiculos).toHaveLength(2);
    const abc = veiculos.find((v) => v.entityLabel === "ABC1D23")!;
    expect(abc.linhas).toHaveLength(3);
    expect(abc.alteracoes).toBe(3);
    // Prazo é mês, e não dinheiro: conta como alteração, não como alteração em R$.
    expect(abc.alteracoesEmDinheiro).toBe(2);
  });

  it("põe a parcela FINAME antes das duas parcelas que a compõem", () => {
    /* A ordem do motor punha o total entre as duas metades dele — "Amortização,
       Parcela FINAME, Juros" —, e quem lia somava as três. O catálogo manda:
       primeiro a parcela, depois juros e amortização. */
    const foraDeOrdem = linhasDeFiname([
      alteracao({ entityLabel: "QYW6D15", attributeCode: "cavalo.amortizacao_cavalo" }),
      alteracao({ entityLabel: "QYW6D15", attributeCode: "cavalo.data_fim_contrato" }),
      alteracao({ entityLabel: "QYW6D15", attributeCode: "cavalo.finame_cavalo" }),
      alteracao({ entityLabel: "QYW6D15", attributeCode: "cavalo.juros_finame_cavalo" }),
    ]);
    const [veiculo] = agruparPorVeiculo(foraDeOrdem);
    expect(veiculo!.linhas.map((l) => l.variavel)).toEqual([
      "parcela",
      "juros",
      "amortizacao",
      "data_fim_contrato",
    ]);
  });

  it("mostra a parcela FINAME da placa — e não a soma das monetárias dela", () => {
    const abc = agruparPorVeiculo(recorte()).find((v) => v.entityLabel === "ABC1D23")!;
    expect(abc.parcela).toEqual({
      base: 8450,
      comparada: 8760,
      diferenca: 310,
      variacao: 3.668639,
    });
  });

  it("deixa a parcela nula quando a linha dela não está no recorte", () => {
    // A placa que só moveu a amortização: somar os 370 aqui diria que a parcela
    // caiu 370 — e a parcela dela pode não ter se movido.
    const xyz = agruparPorVeiculo(recorte()).find((v) => v.entityLabel === "XYZ9K88")!;
    expect(xyz.parcela).toBeNull();
    expect(xyz.alteracoes).toBe(1);
  });

  it("ordena pela maior mexida de parcela, e a placa desempata", () => {
    const veiculos = agruparPorVeiculo(recorte());
    expect(veiculos.map((v) => v.entityLabel)).toEqual(["ABC1D23", "XYZ9K88"]);
  });

  it("dá à placa o pior estado das linhas dela, como a rosca faz", () => {
    const veiculos = agruparPorVeiculo(
      linhasDeFiname([
        alteracao({ entityLabel: "ABC1D23" }),
        alteracao({
          entityLabel: "ABC1D23",
          attributeCode: "cavalo.taxa_finame",
          comparability: "INCONCLUSIVE",
          nature: "TYPE_CHANGE",
          deltaAbsolute: null,
          deltaPercent: null,
          inconclusiveReason: "O tipo do valor mudou entre os dois snapshots.",
        }),
      ]),
    );
    expect(veiculos[0]!.estado).toBe("CONFLITO");
    // O conflito não some da contagem de alterações da placa: ele não é uma.
    expect(veiculos[0]!.alteracoes).toBe(1);
  });

  it("leva o prazo e a data de cadastro para a linha da placa", () => {
    const veiculos = agruparPorVeiculo(
      comContextoDoVeiculo(recorte(), {
        comparada: [
          {
            entityLabel: "ABC1D23",
            entityType: "CAVALO",
            periodo: "48",
            dataDeCadastro: "2019-05-10",
          },
        ],
      }),
    );
    const abc = veiculos.find((v) => v.entityLabel === "ABC1D23")!;
    expect(abc.periodoFiname).toBe("48");
    expect(abc.dataDeCadastro).toBe("2019-05-10");
    const xyz = veiculos.find((v) => v.entityLabel === "XYZ9K88")!;
    expect(xyz.periodoFiname).toBeNull();
  });
});
