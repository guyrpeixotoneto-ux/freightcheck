import { describe, expect, it } from "vitest";
import {
  CODIGOS_DA_TABELA_DE_IMPOSTOS,
  CODIGOS_DO_DETALHE_DE_IMPOSTOS,
  alteracoesPorVariavelDeImpostos,
  celulasDoCsvDeImpostos,
  COLUNAS_DO_CSV_DE_IMPOSTOS,
  codigoDaVariavelDeImpostos,
  conferenciaDeAliquotas,
  distribuicaoPorEstadoDeImpostos,
  impactoDeImpostos,
  linhaDeImpostosDaAlteracao,
  linhaDeImpostosSemAlteracao,
  linhasDeImpostos,
  movimentoDeAliquotas,
  resumirImpostos,
  totaisDeImpostosPorVigencia,
  variavelDeImpostosDoCodigo,
  VARIAVEIS_DE_DETALHE_DE_IMPOSTOS,
  VARIAVEIS_DE_IMPOSTOS,
  type AlteracaoDoMotor,
  type ValorDeImposto,
} from "../impostos";

/**
 * O que estes testes prendem.
 *
 * O módulo não compara nada — comparar é do `engine` —, então aqui não há
 * snapshot, banco nem fixture de export. O que se prende é a **tradução** e as
 * quatro decisões que o dado real obrigou a escrever
 * (`docs/ACHADO-IMPOSTOS.md`):
 *
 * 1. alíquota não soma, e o que ela faz é conferir;
 * 2. `valor_icms` é coluna sem dado, e um montante zero nunca vira alíquota
 *    de 0%;
 * 3. o PIS/COFINS de aquisição é PONTUAL e não se mistura com rubrica mensal;
 * 4. os dois tributos nunca somam entre si.
 *
 * Os números dos casos saem do acervo, não de uma conta inventada: 9,250% da
 * nota com desvio zero nos 132 ativos é o PIS/COFINS de aquisição; 9,3 é a
 * alíquota que a carreta declara; 12 é o ICMS de entrada do implemento; zero em
 * 1.215 linhas é o montante de ICMS.
 */

const alteracao = (over: Partial<AlteracaoDoMotor> = {}): AlteracaoDoMotor => ({
  changeType: "VALUE_CHANGED",
  nature: "NUMERIC",
  attributeCode: "cavalo.valor_pis_cofins",
  entityLabel: "QYQ6A80",
  entityType: "CAVALO",
  valueBefore: "37890.84",
  valueAfter: "38890.84",
  isNullBefore: false,
  isNullAfter: false,
  deltaAbsolute: "1000",
  deltaPercent: "2.639429",
  comparability: "COMPARABLE",
  impactConfidence: "CALCULATED",
  impactAmount: "1000",
  impactPeriodicity: "PONTUAL",
  ...over,
});

/** Um ativo de cavalo com o regime medido do acervo: 9,250% da nota. */
const cavalo = (over: Partial<ValorDeImposto> = {}): ValorDeImposto => ({
  ponta: "BASE",
  entityType: "CAVALO",
  entityLabel: "QYQ6A80",
  valorNf: 409_630.16,
  pisCofins: 37_890.79,
  icms: 0,
  percentualPisCofins: null,
  percentualIcms: 12,
  ...over,
});

describe("o catálogo das variáveis", () => {
  it("dá a cada tipo o código que ele de fato tem", () => {
    const pis = VARIAVEIS_DE_IMPOSTOS.find((v) => v.chave === "pis_cofins")!;
    expect(codigoDaVariavelDeImpostos(pis, "CAVALO")).toBe("cavalo.valor_pis_cofins");
    expect(codigoDaVariavelDeImpostos(pis, "CARRETA")).toBe("carreta.valor_pis_cofins");
    expect(codigoDaVariavelDeImpostos(pis, "TRECHO")).toBeUndefined();
  });

  it("não empresta ao cavalo a alíquota de PIS/COFINS, que só a carreta declara", () => {
    const declarada = VARIAVEIS_DE_IMPOSTOS.find(
      (v) => v.chave === "percentual_pis_cofins",
    )!;
    expect(codigoDaVariavelDeImpostos(declarada, "CARRETA")).toBe("carreta.pis_cofins");
    expect(codigoDaVariavelDeImpostos(declarada, "CAVALO")).toBeUndefined();
  });

  it("deixa a segunda alíquota da carreta fora da tabela e dentro do detalhe", () => {
    expect(CODIGOS_DA_TABELA_DE_IMPOSTOS).not.toContain("carreta.icms");
    expect(CODIGOS_DO_DETALHE_DE_IMPOSTOS).toContain("carreta.icms");
    expect(VARIAVEIS_DE_DETALHE_DE_IMPOSTOS.map((v) => v.chave)).toEqual(["icms_entrada"]);
  });

  it("separa montante, alíquota e base — a distinção que decide todo o resto", () => {
    expect(variavelDeImpostosDoCodigo("cavalo.valor_pis_cofins")!.papel).toBe("MONTANTE");
    expect(variavelDeImpostosDoCodigo("carreta.pis_cofins")!.papel).toBe("ALIQUOTA");
    expect(variavelDeImpostosDoCodigo("cavalo.valor_nf_compra")!.papel).toBe("BASE");
  });

  it("carrega o motivo de o ICMS não somar, e não só a proibição", () => {
    const icms = variavelDeImpostosDoCodigo("carreta.valor_icms")!;
    expect(icms.foraDaSoma).toBeTruthy();
    expect(icms.foraDaSoma).toContain("1.215");
  });
});

describe("a linha da tabela", () => {
  it("descarta o que não é de imposto", () => {
    expect(
      linhaDeImpostosDaAlteracao(alteracao({ attributeCode: "cavalo.finame_cavalo" })),
    ).toBeNull();
  });

  it("guarda a entrada de frota, que não cita atributo nenhum", () => {
    const linha = linhaDeImpostosDaAlteracao(
      alteracao({ changeType: "ENTITY_ADDED", attributeCode: null }),
    )!;
    expect(linha.variavel).toBe("veiculo");
    expect(linha.estado).toBe("NOVO_NA_VIGENCIA");
  });

  it("deixa a coluna zerada de ICMS passar, marcada — esconder o achado seria apagá-lo", () => {
    const linha = linhaDeImpostosDaAlteracao(
      alteracao({ attributeCode: "carreta.valor_icms", entityType: "CARRETA" }),
    )!;
    expect(linha.variavel).toBe("icms");
    expect(linha.tributo).toBe("ICMS");
    expect(linha.foraDaSoma).toBeTruthy();
  });

  it("não lê ausência como zero", () => {
    const linha = linhaDeImpostosDaAlteracao(
      alteracao({
        changeType: "ATTRIBUTE_ADDED",
        valueBefore: null,
        deltaAbsolute: null,
        deltaPercent: null,
        comparability: "INCONCLUSIVE",
      }),
    )!;
    expect(linha.estado).toBe("NOVO_NA_VIGENCIA");
    expect(linha.diferenca).toBeNull();
    expect(linha.variacao).toBeNull();
  });

  it("monta a linha igual do alternador, sem id e sem delta", () => {
    const linha = linhaDeImpostosSemAlteracao({
      entityLabel: "QYQ6A80",
      entityType: "CAVALO",
      attributeCode: "cavalo.valor_pis_cofins",
      valor: "37890.84",
    })!;
    expect(linha.id).toBeNull();
    expect(linha.estado).toBe("SEM_ALTERACAO");
    expect(linha.base).toBe(linha.comparada);
  });
});

describe("o impacto", () => {
  it("não soma alíquota com dinheiro — conta-as à parte", () => {
    const linhas = linhasDeImpostos([
      alteracao(),
      alteracao({
        attributeCode: "carreta.pis_cofins",
        entityType: "CARRETA",
        entityLabel: "QYQ1B11",
        valueBefore: "9.3",
        valueAfter: "12",
        deltaAbsolute: "2.7",
        impactAmount: null,
        impactConfidence: null,
        impactPeriodicity: null,
      }),
    ]);
    const impacto = impactoDeImpostos(linhas);
    expect(impacto.porPeriodicidade).toEqual({ PONTUAL: 1000 });
    expect(impacto.aliquotasAlteradas).toBe(1);
    /* A alíquota não é "dinheiro que faltou precificar": ela não é dinheiro. */
    expect(impacto.naoCalculavel).toBe(0);
  });

  it("não soma a coluna zerada de ICMS, e diz quantas linhas ficaram fora", () => {
    const linhas = linhasDeImpostos([
      alteracao({
        attributeCode: "cavalo.valor_icms",
        valueBefore: "0",
        valueAfter: "1200",
        deltaAbsolute: "1200",
        impactAmount: "1200",
      }),
    ]);
    const impacto = impactoDeImpostos(linhas);
    expect(impacto.porPeriodicidade).toEqual({});
    expect(impacto.foraDaSoma).toBe(1);
  });

  it("não soma a base com o tributo que incide sobre ela", () => {
    const linhas = linhasDeImpostos([
      alteracao({
        attributeCode: "cavalo.valor_nf_compra",
        valueBefore: "409630.16",
        valueAfter: "419630.16",
        deltaAbsolute: "10000",
        impactAmount: "10000",
      }),
    ]);
    expect(impactoDeImpostos(linhas).porPeriodicidade).toEqual({});
  });

  it("mantém cada periodicidade no seu balde — PONTUAL não vira mensal", () => {
    const linhas = linhasDeImpostos([
      alteracao(),
      alteracao({
        entityLabel: "QYQ7C21",
        impactAmount: "500",
        impactPeriodicity: "MENSAL",
      }),
    ]);
    expect(impactoDeImpostos(linhas).porPeriodicidade).toEqual({
      PONTUAL: 1000,
      MENSAL: 500,
    });
  });
});

describe("os indicadores", () => {
  const frota = { comparados: 62, novos: 1, ausentes: 2 };

  it("conta como sem alteração o que nenhuma linha tocou", () => {
    const linhas = linhasDeImpostos([
      alteracao(),
      alteracao({
        entityLabel: "QYQ7C21",
        comparability: "INCONCLUSIVE",
        nature: "TYPE_CHANGED",
        inconclusiveReason: "Tipo mudou entre as vigências",
      }),
    ]);
    const resumo = resumirImpostos(linhas, frota);
    expect(resumo.veiculosComAlteracao).toBe(1);
    expect(resumo.veiculosComConflito).toBe(1);
    expect(resumo.semAlteracao).toBe(60);
  });

  it("ordena as variáveis pela quantidade de alterações", () => {
    const linhas = linhasDeImpostos([
      alteracao(),
      alteracao({ entityLabel: "QYQ7C21" }),
      alteracao({
        attributeCode: "cavalo.percentual_icms",
        valueBefore: "12",
        valueAfter: "7",
        deltaAbsolute: "-5",
      }),
    ]);
    const barras = alteracoesPorVariavelDeImpostos(linhas);
    expect(barras[0]).toMatchObject({ variavel: "pis_cofins", alteracoes: 2 });
    expect(barras[1]).toMatchObject({ variavel: "percentual_icms", alteracoes: 1 });
  });

  it("dá a um veículo uma fatia só, a mais grave", () => {
    const linhas = linhasDeImpostos([
      alteracao(),
      alteracao({
        attributeCode: "cavalo.percentual_icms",
        comparability: "INCONCLUSIVE",
        nature: "TYPE_CHANGED",
      }),
    ]);
    const fatias = distribuicaoPorEstadoDeImpostos(linhas, frota);
    const soma = fatias.reduce((acc, f) => acc + f.veiculos, 0);
    expect(soma).toBe(65);
    expect(fatias.find((f) => f.estado === "CONFLITO")!.veiculos).toBe(1);
    expect(fatias.find((f) => f.estado === "ALTERADO")).toBeUndefined();
  });
});

/**
 * O MOVIMENTO DA ALÍQUOTA — a grandeza que o seletor dos Impostos passou a levar.
 *
 * Ele existe porque a coluna de dinheiro daquele menu é `R$ 0,00` por
 * construção: o montante de ICMS é zero nas 1.215 linhas do acervo e o
 * PIS/COFINS de aquisição é 9,250% da nota em todas elas. Num módulo de
 * imposto a pergunta é em quantos pontos a taxa andou, e o que estes casos
 * prendem são as três recusas que a resposta tem de manter — não somar pontos,
 * não juntar tributos, não inventar direção — mais a distinção entre alterada
 * sem medida e alterada em zero.
 */
describe("o movimento das alíquotas do par", () => {
  const icms = (over: Partial<AlteracaoDoMotor> = {}) =>
    alteracao({
      attributeCode: "cavalo.percentual_icms",
      valueBefore: "12",
      valueAfter: "14",
      deltaAbsolute: "2",
      deltaPercent: "16.666667",
      impactConfidence: "NOT_APPLICABLE",
      impactAmount: null,
      impactPeriodicity: null,
      ...over,
    });

  it("não soma pontos — três carretas que sobem 2 p.p. cada não somam 6", () => {
    const linhas = linhasDeImpostos([
      icms(),
      icms({ entityLabel: "QYQ7C21" }),
      icms({ entityLabel: "QYQ8D32" }),
    ]);

    expect(movimentoDeAliquotas(linhas)).toEqual([
      { tributo: "ICMS", alteradas: 3, maior: 2, ambasDirecoes: false },
    ]);
  });

  it("publica o maior movimento, e não o último que passou", () => {
    const linhas = linhasDeImpostos([
      icms(),
      icms({ entityLabel: "QYQ7C21", valueAfter: "18", deltaAbsolute: "6" }),
      icms({ entityLabel: "QYQ8D32", valueAfter: "13", deltaAbsolute: "1" }),
    ]);

    expect(movimentoDeAliquotas(linhas)[0]!.maior).toBe(6);
  });

  it("nunca junta ICMS com PIS/COFINS, e sai sempre na mesma ordem", () => {
    const linhas = linhasDeImpostos([
      alteracao({
        attributeCode: "carreta.pis_cofins",
        entityType: "CARRETA",
        valueBefore: "9.3",
        valueAfter: "9.25",
        deltaAbsolute: "-0.05",
        impactConfidence: "NOT_APPLICABLE",
        impactAmount: null,
      }),
      icms(),
    ]);

    expect(movimentoDeAliquotas(linhas).map((m) => m.tributo)).toEqual([
      "ICMS",
      "PIS_COFINS",
    ]);
    expect(movimentoDeAliquotas(linhas)[1]!.maior).toBe(-0.05);
  });

  /*
    Uma sobe 2 p.p., outra cai 6: o maior em módulo é o −6, e um "−6,000 p.p."
    sem ressalva diria que a frota inteira andou para baixo.
  */
  it("avisa quando o par andou para os dois lados", () => {
    const linhas = linhasDeImpostos([
      icms(),
      icms({ entityLabel: "QYQ7C21", valueAfter: "6", deltaAbsolute: "-6" }),
    ]);

    expect(movimentoDeAliquotas(linhas)[0]).toMatchObject({
      maior: -6,
      ambasDirecoes: true,
    });
  });

  /*
    Alterada e comparável, e ainda assim sem delta: é o que o motor devolve
    quando a coluna chega como texto ("12%" virando "14%") e a subtração não
    existe. A linha conta como alíquota que andou — porque andou —, e o
    movimento sai `null`: escrever `0,000 p.p.` ali afirmaria uma medição que
    ninguém fez, que é a mesma recusa do montante de ICMS.
  */
  it("conta a alterada sem medida, e não a mede em zero", () => {
    const linhas = linhasDeImpostos([
      icms({ nature: "TEXT_CHANGED", deltaAbsolute: null, deltaPercent: null }),
    ]);

    expect(movimentoDeAliquotas(linhas)).toEqual([
      { tributo: "ICMS", alteradas: 1, maior: null, ambasDirecoes: false },
    ]);
  });

  it("não devolve balde para o tributo que não se moveu", () => {
    /* Montante alterado, alíquota parada: o dinheiro é da outra coluna. */
    expect(movimentoDeAliquotas(linhasDeImpostos([alteracao()]))).toEqual([]);
  });

  it("ignora a base — valor de nota não é alíquota de nada", () => {
    const linhas = linhasDeImpostos([
      alteracao({
        attributeCode: "cavalo.valor_nf_compra",
        valueBefore: "409630.16",
        valueAfter: "412000",
        deltaAbsolute: "2369.84",
      }),
    ]);

    expect(movimentoDeAliquotas(linhas)).toEqual([]);
  });
});

describe("os totais por vigência", () => {
  it("nunca soma ICMS com PIS/COFINS", () => {
    const totais = totaisDeImpostosPorVigencia([cavalo(), cavalo({ entityLabel: "QYQ7C21" })]);
    const tributos = totais.map((t) => t.tributo);
    expect(new Set(tributos)).toEqual(new Set(["ICMS", "PIS_COFINS"]));
    expect(totais.find((t) => t.tributo === "PIS_COFINS")!.total).toBe(75_781.58);
    expect(totais.find((t) => t.tributo === "ICMS")!.total).toBe(0);
  });

  it("conta os zeros em vez de escondê-los — um total de R$ 0,00 tem de dizer de quantos", () => {
    const icms = totaisDeImpostosPorVigencia([cavalo(), cavalo({ entityLabel: "QYQ7C21" })]).find(
      (t) => t.tributo === "ICMS",
    )!;
    expect(icms.ativos).toBe(2);
    expect(icms.zerados).toBe(2);
  });

  it("não inventa linha para o tributo que a vigência não trouxe", () => {
    const totais = totaisDeImpostosPorVigencia([cavalo({ icms: null })]);
    expect(totais.map((t) => t.tributo)).toEqual(["PIS_COFINS"]);
  });
});

describe("a conferência entre a alíquota declarada e a medida", () => {
  const frotaDeCavalos = (over: Partial<ValorDeImposto> = {}): ValorDeImposto[] =>
    Array.from({ length: 10 }, (_, i) =>
      cavalo({ entityLabel: `CAV${i}`, ...over }),
    );

  it("lê o regime do acervo como fórmula, e não como dado", () => {
    /* 9,250% da nota em todos os ativos, sem alíquota declarada: é fórmula. */
    const pis = conferenciaDeAliquotas(
      frotaDeCavalos().map((v) => ({
        ...v,
        pisCofins: Number((v.valorNf! * 0.0925).toFixed(2)),
      })),
    ).find((c) => c.tributo === "PIS_COFINS")!;
    expect(pis.medidaMedia).toBeCloseTo(9.25, 3);
    expect(pis.medidaDesvio).toBe(0);
    expect(pis.veredito).toBe("FORMULA_UNICA");
  });

  it("chama de ausente, e não de zero, a coluna que ninguém preencheu", () => {
    /*
      O ICMS do acervo: alíquota declarada em todas as linhas, montante zero em
      todas elas. Lido como medida, daria "0,000% da nota, desvio zero,
      percentual único" — uma frase verdadeira e inteiramente enganosa.
    */
    const icms = conferenciaDeAliquotas(frotaDeCavalos()).find(
      (c) => c.tributo === "ICMS",
    )!;
    expect(icms.veredito).toBe("SEM_MONTANTE");
    expect(icms.ativos).toBe(0);
    expect(icms.zerados).toBe(10);
    expect(icms.comDeclarada).toBe(10);
    expect(icms.medidaMedia).toBeNull();
  });

  it("aceita como igual a declarada escrita com menos dígitos", () => {
    /* Declarada 9,3 contra medida 9,250: 0,05 p.p. é arredondamento, não achado. */
    const conferencia = conferenciaDeAliquotas(
      frotaDeCavalos().map((v) => ({
        ...v,
        entityType: "CARRETA",
        pisCofins: Number((v.valorNf! * 0.0925).toFixed(2)),
        percentualPisCofins: 9.3,
      })),
    ).find((c) => c.tributo === "PIS_COFINS")!;
    expect(conferencia.divergentes).toBe(0);
    expect(conferencia.veredito).toBe("CONFEREM");
  });

  it("acusa a divergência quando a taxa declarada não é a que o dinheiro revela", () => {
    const conferencia = conferenciaDeAliquotas(
      frotaDeCavalos().map((v) => ({
        ...v,
        entityType: "CARRETA",
        pisCofins: Number((v.valorNf! * 0.0925).toFixed(2)),
        percentualPisCofins: 0,
      })),
    ).find((c) => c.tributo === "PIS_COFINS")!;
    expect(conferencia.conferidos).toBe(10);
    expect(conferencia.divergentes).toBe(10);
    expect(conferencia.maiorDiferenca).toBeCloseTo(9.25, 2);
    expect(conferencia.veredito).toBe("DIVERGEM");
  });

  it("não conta como divergente quem não declarou taxa nenhuma", () => {
    const conferencia = conferenciaDeAliquotas(
      frotaDeCavalos().map((v) => ({
        ...v,
        pisCofins: Number((v.valorNf! * 0.0925).toFixed(2)),
      })),
    ).find((c) => c.tributo === "PIS_COFINS")!;
    expect(conferencia.conferidos).toBe(0);
    expect(conferencia.divergentes).toBe(0);
  });

  it("recusa o veredito quando a base não o sustenta", () => {
    const conferencia = conferenciaDeAliquotas([
      cavalo({ pisCofins: 37_890.79 }),
      cavalo({ entityLabel: "CAV2", pisCofins: 12_000 }),
    ]).find((c) => c.tributo === "PIS_COFINS")!;
    expect(conferencia.veredito).toBe("BASE_INSUFICIENTE");
  });

  it("deixa de fora o ativo sem nota, em vez de tratá-lo como 0%", () => {
    const conferencia = conferenciaDeAliquotas([
      ...frotaDeCavalos().map((v) => ({
        ...v,
        pisCofins: Number((v.valorNf! * 0.0925).toFixed(2)),
      })),
      cavalo({ entityLabel: "SEM_NOTA", valorNf: 0, pisCofins: 5_000 }),
      cavalo({ entityLabel: "SEM_NOTA_2", valorNf: null, pisCofins: 5_000 }),
    ]).find((c) => c.tributo === "PIS_COFINS")!;
    expect(conferencia.ativos).toBe(10);
    expect(conferencia.medidaMedia).toBeCloseTo(9.25, 3);
  });

  it("lê como variável por ativo o que não tem taxa declarada nem desvio zero", () => {
    const conferencia = conferenciaDeAliquotas(
      frotaDeCavalos().map((v, i) => ({
        ...v,
        entityLabel: `CAV${i}`,
        pisCofins: Number((v.valorNf! * (0.08 + i / 1000)).toFixed(2)),
      })),
    ).find((c) => c.tributo === "PIS_COFINS")!;
    expect(conferencia.veredito).toBe("POR_VEICULO");
  });
});

describe("o CSV", () => {
  /*
    A justificativa é a última coluna, e o cabeçalho é a prova de que ela
    está alinhada: uma célula a mais do que os títulos desloca tudo o que
    vem antes na planilha de quem recebe o arquivo, em silêncio.
  */
  it("leva a justificativa do gestor como última coluna", () => {
    const [linha] = linhasDeImpostos([alteracao()]);
    const explicada = celulasDoCsvDeImpostos(linha, "Conforme a regra: contrato renegociado.");
    expect(explicada).toHaveLength(COLUNAS_DO_CSV_DE_IMPOSTOS.length);
    expect(COLUNAS_DO_CSV_DE_IMPOSTOS.at(-1)).toBe("Justificativa");
    expect(explicada.at(-1)).toBe("Conforme a regra: contrato renegociado.");

    /* Pendente é célula vazia, e não a palavra "pendente": quem soma a
       coluna no Excel conta o que está escrito nela. */
    expect(celulasDoCsvDeImpostos(linha).at(-1)).toBeNull();
  });

  it("diz por extenso o que é montante e o que é alíquota", () => {
    const [montante] = linhasDeImpostos([alteracao()]);
    const [taxa] = linhasDeImpostos([
      alteracao({
        attributeCode: "carreta.pis_cofins",
        entityType: "CARRETA",
        valueBefore: "9.3",
        valueAfter: "12",
      }),
    ]);
    expect(celulasDoCsvDeImpostos(montante)[4]).toBe("Montante (R$)");
    expect(celulasDoCsvDeImpostos(taxa)[4]).toBe("Alíquota (%)");
  });

  it("leva o aviso da coluna zerada para dentro do arquivo", () => {
    const [linha] = linhasDeImpostos([
      alteracao({ attributeCode: "cavalo.valor_icms" }),
    ]);
    const celulas = celulasDoCsvDeImpostos(linha);
    expect(celulas).toHaveLength(13);
    expect(String(celulas[11])).toContain("1.215");
  });
});
