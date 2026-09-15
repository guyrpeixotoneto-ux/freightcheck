import { describe, expect, it } from "vitest";
import {
  CODIGOS_DA_TABELA_DE_IPVA,
  CODIGOS_DO_DETALHE_DE_IPVA,
  aliquotaImplicita,
  alteracoesPorVariavelDeIpva,
  celulasDoCsvDeIpva,
  codigoDaVariavelDeIpva,
  distribuicaoPorEstadoDeIpva,
  impactoDeIpva,
  linhaDeIpvaDaAlteracao,
  linhaDeIpvaSemAlteracao,
  linhasDeIpva,
  resumirIpva,
  totaisDeIpvaPorVigencia,
  variavelDeIpvaDoCodigo,
  VARIAVEIS_DE_DETALHE_DE_IPVA,
  VARIAVEIS_DE_IPVA,
  type AlteracaoDoMotor,
  type ValorDeIpva,
} from "../ipva";

/**
 * O que estes testes prendem.
 *
 * O módulo não compara nada — comparar é do `engine` —, então aqui não há
 * snapshot, banco nem fixture de export. O que se prende é a **tradução** e as
 * três decisões que o dado real obrigou a escrever (`docs/ACHADO-IPVA.md`):
 *
 * 1. a coluna "mensal" da carreta nunca entra numa soma;
 * 2. a alíquota implícita distingue fórmula de dado, e é isso que separa uma
 *    queda de R$ 720 mil de uma troca de critério;
 * 3. valor negativo continua somando e sai contado.
 *
 * Os números dos casos saem do acervo, não de uma conta inventada: 1,000% da
 * nota com desvio zero é o regime de Jan–Jun/2026; 0,651% de média com desvio
 * 0,119 é o de Jul/2026; R$ 140–152 fixos é a carreta.
 */

const alteracao = (over: Partial<AlteracaoDoMotor> = {}): AlteracaoDoMotor => ({
  changeType: "VALUE_CHANGED",
  nature: "NUMERIC",
  attributeCode: "cavalo.ipva_licenciamento",
  entityLabel: "QYQ6A80",
  entityType: "CAVALO",
  valueBefore: "4500",
  valueAfter: "2930",
  isNullBefore: false,
  isNullAfter: false,
  deltaAbsolute: "-1570",
  deltaPercent: "-34.888889",
  comparability: "COMPARABLE",
  impactConfidence: "CALCULATED",
  impactAmount: "-1570",
  impactPeriodicity: "ANUAL",
  ...over,
});

describe("o catálogo das variáveis", () => {
  it("dá a cada tipo o código que ele de fato tem", () => {
    const ipva = VARIAVEIS_DE_IPVA.find((v) => v.chave === "ipva")!;
    expect(codigoDaVariavelDeIpva(ipva, "CAVALO")).toBe("cavalo.ipva_licenciamento");
    expect(codigoDaVariavelDeIpva(ipva, "CARRETA")).toBe("carreta.ipva_licenciamento");
    expect(codigoDaVariavelDeIpva(ipva, "TRECHO")).toBeUndefined();
  });

  it("não empresta ao cavalo a coluna mensal, que só a carreta declara", () => {
    const mensal = VARIAVEIS_DE_DETALHE_DE_IPVA.find((v) => v.chave === "ipva_mensal")!;
    expect(codigoDaVariavelDeIpva(mensal, "CARRETA")).toBe(
      "carreta.ipva_licenciamento_mensal",
    );
    expect(codigoDaVariavelDeIpva(mensal, "CAVALO")).toBeUndefined();
  });

  it("deixa a coluna mensal fora da tabela e dentro do detalhe", () => {
    expect(CODIGOS_DA_TABELA_DE_IPVA).not.toContain("carreta.ipva_licenciamento_mensal");
    expect(CODIGOS_DO_DETALHE_DE_IPVA).toContain("carreta.ipva_licenciamento_mensal");
  });

  it("carrega o motivo de a coluna mensal não somar, e não só a proibição", () => {
    const mensal = variavelDeIpvaDoCodigo("carreta.ipva_licenciamento_mensal")!;
    expect(mensal.foraDaSoma).toBeTruthy();
    expect(mensal.foraDaSoma).toContain("5,23×");
  });
});

describe("a linha da tabela", () => {
  it("descarta o que não é de IPVA", () => {
    expect(linhaDeIpvaDaAlteracao(alteracao({ attributeCode: "cavalo.finame_cavalo" }))).toBeNull();
  });

  it("guarda a entrada de frota, que não cita atributo nenhum", () => {
    const linha = linhaDeIpvaDaAlteracao(
      alteracao({ changeType: "ENTITY_ADDED", attributeCode: null }),
    )!;
    expect(linha.variavel).toBe("veiculo");
    expect(linha.estado).toBe("NOVO_NA_VIGENCIA");
  });

  it("deixa a coluna mensal passar, marcada — esconder o achado seria apagá-lo", () => {
    const linha = linhaDeIpvaDaAlteracao(
      alteracao({
        attributeCode: "carreta.ipva_licenciamento_mensal",
        entityType: "CARRETA",
      }),
    )!;
    expect(linha.variavel).toBe("ipva_mensal");
    expect(linha.foraDaSoma).toBeTruthy();
  });

  it("não lê ausência como zero", () => {
    const linha = linhaDeIpvaDaAlteracao(
      alteracao({
        changeType: "ATTRIBUTE_ADDED",
        valueBefore: null,
        deltaAbsolute: null,
        deltaPercent: null,
        comparability: "INCONCLUSIVE",
      }),
    )!;
    expect(linha.base).toBeNull();
    expect(linha.diferenca).toBeNull();
    expect(linha.variacao).toBeNull();
  });

  it("monta a linha igual sem inventar um id de alteração", () => {
    const linha = linhaDeIpvaSemAlteracao({
      entityLabel: "QYQ6A80",
      entityType: "CAVALO",
      attributeCode: "cavalo.ipva_licenciamento",
      valor: "2930",
    })!;
    expect(linha.id).toBeNull();
    expect(linha.estado).toBe("SEM_ALTERACAO");
    expect(linha.base).toBe("2930");
    expect(linha.comparada).toBe("2930");
  });
});

describe("o impacto", () => {
  it("nunca soma a coluna que não se explica", () => {
    const linhas = linhasDeIpva([
      alteracao(),
      alteracao({
        attributeCode: "carreta.ipva_licenciamento_mensal",
        entityType: "CARRETA",
        entityLabel: "RTA9E11",
        impactAmount: "-298",
      }),
    ]);
    const impacto = impactoDeIpva(linhas);
    expect(impacto.porPeriodicidade).toEqual({ ANUAL: -1570 });
    expect(impacto.foraDaSoma).toBe(1);
  });

  it("não põe o valor de nota no mesmo balde do tributo sobre ele", () => {
    const linhas = linhasDeIpva([
      alteracao(),
      alteracao({
        attributeCode: "cavalo.valor_nf_compra",
        impactAmount: "-120000",
        impactPeriodicity: "ANUAL",
      }),
    ]);
    expect(impactoDeIpva(linhas).porPeriodicidade).toEqual({ ANUAL: -1570 });
  });

  it("mantém cada periodicidade no balde dela", () => {
    const linhas = linhasDeIpva([
      alteracao(),
      alteracao({
        entityLabel: "RTA9E11",
        entityType: "CARRETA",
        attributeCode: "carreta.ipva_licenciamento",
        impactAmount: "-9.5",
        impactPeriodicity: "MENSAL",
      }),
    ]);
    const { porPeriodicidade } = impactoDeIpva(linhas);
    expect(porPeriodicidade).toEqual({ ANUAL: -1570, MENSAL: -9.5 });
  });

  it("conta o negativo sem retirá-lo da soma", () => {
    const linhas = linhasDeIpva([
      alteracao({
        entityLabel: "RTA9E11",
        entityType: "CARRETA",
        attributeCode: "carreta.ipva_licenciamento",
        valueBefore: "150",
        valueAfter: "-1709.86",
        deltaAbsolute: "-1859.86",
        impactAmount: "-1859.86",
      }),
    ]);
    const impacto = impactoDeIpva(linhas);
    expect(impacto.valoresNegativos).toBe(1);
    expect(impacto.porPeriodicidade.ANUAL).toBe(-1859.86);
  });

  it("não chama de 'não precificado' o que nunca foi dinheiro", () => {
    const linhas = linhasDeIpva([
      alteracao({
        attributeCode: "cavalo.ano",
        valueBefore: "2021",
        valueAfter: "2022",
        impactConfidence: "NOT_CALCULABLE",
        impactAmount: null,
        impactPeriodicity: null,
      }),
    ]);
    expect(impactoDeIpva(linhas).naoCalculavel).toBe(0);
  });
});

describe("os indicadores", () => {
  const frota = { comparados: 62, novos: 2, ausentes: 1 };

  it("conta como 'sem alteração' só o que nenhuma linha tocou", () => {
    const linhas = linhasDeIpva([
      alteracao({ entityLabel: "A" }),
      alteracao({
        entityLabel: "B",
        comparability: "INCONCLUSIVE",
        nature: "TYPE_CHANGED",
      }),
    ]);
    const resumo = resumirIpva(linhas, frota);
    expect(resumo.veiculosComAlteracao).toBe(1);
    expect(resumo.veiculosComConflito).toBe(1);
    // 62 comparados, dois tocados: o que sobra é 60 — e o conflito não é um
    // veículo "em ordem", então ele não pode estar nos dois números.
    expect(resumo.semAlteracao).toBe(60);
  });

  it("não deriva a frota do tamanho da lista", () => {
    const resumo = resumirIpva([], frota);
    expect(resumo.semAlteracao).toBe(62);
    expect(resumo.novosNaVigencia).toBe(2);
    expect(resumo.ausentesNaComparada).toBe(1);
  });

  it("dá a cada veículo uma fatia só, pela gravidade", () => {
    const linhas = linhasDeIpva([
      alteracao({ entityLabel: "A" }),
      alteracao({
        entityLabel: "A",
        attributeCode: "cavalo.valor_nf_compra",
        comparability: "INCONCLUSIVE",
        nature: "TYPE_CHANGED",
      }),
    ]);
    const fatias = distribuicaoPorEstadoDeIpva(linhas, { comparados: 10, novos: 0, ausentes: 0 });
    const soma = fatias.reduce((acc, f) => acc + f.veiculos, 0);
    expect(soma).toBe(10);
    expect(fatias.find((f) => f.estado === "CONFLITO")?.veiculos).toBe(1);
    expect(fatias.find((f) => f.estado === "ALTERADO")).toBeUndefined();
  });

  it("ordena as variáveis pela quantidade de alterações", () => {
    const linhas = linhasDeIpva([
      alteracao({ entityLabel: "A" }),
      alteracao({ entityLabel: "B" }),
      alteracao({ entityLabel: "C", attributeCode: "cavalo.ano" }),
    ]);
    const barras = alteracoesPorVariavelDeIpva(linhas);
    expect(barras.map((b) => b.variavel)).toEqual(["ipva", "ano"]);
    expect(barras[0].alteracoes).toBe(2);
  });
});

describe("os totais por vigência", () => {
  const valor = (over: Partial<ValorDeIpva> = {}): ValorDeIpva => ({
    ponta: "BASE",
    entityType: "CAVALO",
    entityLabel: "A",
    ipva: 2450,
    valorNf: 245000,
    ...over,
  });

  it("soma quem não mudou, e conta os negativos à parte", () => {
    const totais = totaisDeIpvaPorVigencia([
      valor({ entityLabel: "A", ipva: 150, entityType: "CARRETA" }),
      valor({ entityLabel: "B", ipva: -1709.86, entityType: "CARRETA" }),
    ]);
    expect(totais).toHaveLength(1);
    expect(totais[0].total).toBe(-1559.86);
    expect(totais[0].veiculos).toBe(2);
    expect(totais[0].negativos).toBe(1);
  });

  it("não conta como veículo quem não trouxe a rubrica", () => {
    const totais = totaisDeIpvaPorVigencia([valor(), valor({ entityLabel: "B", ipva: null })]);
    expect(totais[0].veiculos).toBe(1);
  });
});

describe("a alíquota implícita", () => {
  const frota = (percentual: number[], ponta: "BASE" | "COMPARADA" = "BASE"): ValorDeIpva[] =>
    percentual.map((p, i) => ({
      ponta,
      entityType: "CAVALO",
      entityLabel: `P${i}`,
      valorNf: 200000,
      ipva: 200000 * (p / 100),
    }));

  it("reconhece a fórmula quando todas as placas caem no mesmo percentual", () => {
    // Jan–Jun/2026: 1,000% da nota, desvio zero, nas 62 placas.
    const [a] = aliquotaImplicita(frota([1, 1, 1, 1, 1, 1, 1]));
    expect(a.media).toBe(1);
    expect(a.desvio).toBe(0);
    expect(a.veredito).toBe("FORMULA_UNICA");
  });

  it("reconhece o cálculo por veículo quando a alíquota se espalha", () => {
    // Jul/2026: mínimo 0,535, máximo 1,193, média 0,651.
    const [a] = aliquotaImplicita(frota([0.535, 0.62, 0.651, 0.7, 1.193, 0.58]));
    expect(a.minima).toBe(0.535);
    expect(a.maxima).toBe(1.193);
    expect(a.veredito).toBe("POR_VEICULO");
  });

  it("não decreta fórmula sobre uma frota pequena demais para dizer isso", () => {
    const [a] = aliquotaImplicita(frota([1, 1, 1]));
    expect(a.veredito).toBe("BASE_INSUFICIENTE");
  });

  it("não deixa uma nota em branco virar 0% e puxar a média", () => {
    const valores = [
      ...frota([1, 1, 1, 1, 1]),
      { ponta: "BASE" as const, entityType: "CAVALO", entityLabel: "X", ipva: 2450, valorNf: 0 },
      { ponta: "BASE" as const, entityType: "CAVALO", entityLabel: "Y", ipva: 2450, valorNf: null },
    ];
    const [a] = aliquotaImplicita(valores);
    expect(a.veiculos).toBe(5);
    expect(a.media).toBe(1);
  });

  it("separa as pontas e os tipos, porque são regimes diferentes", () => {
    const linhas = aliquotaImplicita([
      ...frota([1, 1, 1, 1, 1], "BASE"),
      ...frota([0.535, 0.62, 0.651, 0.7, 1.193], "COMPARADA"),
    ]);
    expect(linhas).toHaveLength(2);
    expect(linhas.find((l) => l.ponta === "BASE")!.veredito).toBe("FORMULA_UNICA");
    expect(linhas.find((l) => l.ponta === "COMPARADA")!.veredito).toBe("POR_VEICULO");
  });
});

describe("o CSV", () => {
  it("leva o aviso da linha que não soma para dentro do arquivo", () => {
    const linha = linhaDeIpvaDaAlteracao(
      alteracao({
        attributeCode: "carreta.ipva_licenciamento_mensal",
        entityType: "CARRETA",
      }),
    )!;
    const celulas = celulasDoCsvDeIpva(linha);
    expect(celulas).toHaveLength(10);
    expect(String(celulas[9])).toContain("5,23×");
  });

  it("não escreve R$ nem decide o separador — isso é do escritor do arquivo", () => {
    const linha = linhaDeIpvaDaAlteracao(alteracao())!;
    const celulas = celulasDoCsvDeIpva(linha);
    expect(celulas[5]).toBe(-1570);
    expect(celulas[7]).toBe("Alterado");
  });
});

/**
 * O veredito de taxa fixa nasceu de um defeito visto na primeira renderização
 * da tela, e não de uma hipótese: a carreta aparecia como "calculado veículo a
 * veículo" — exatamente o contrário do que acontece com ela. Ninguém calcula
 * nada por carreta; é a mesma taxa de licenciamento para todas, e são as notas
 * que variam. Uma taxa fixa sobre notas diferentes produz alíquotas diferentes,
 * e a dispersão do percentual sozinha não distingue as duas coisas.
 */
describe("a taxa fixa, que a alíquota espalhada escondia", () => {
  /** Uma carreta: R$ 150 de licenciamento sobre um implemento de valor próprio. */
  const carreta = (valorNf: number, ipva = 150): ValorDeIpva => ({
    ponta: "BASE",
    entityType: "CARRETA",
    entityLabel: `C${valorNf}`,
    ipva,
    valorNf,
  });

  it("lê R$ 140–152 sobre notas diferentes como taxa fixa, não como cálculo por ativo", () => {
    const [a] = aliquotaImplicita([
      carreta(156000, 140.34),
      carreta(283000, 140.34),
      carreta(198000, 150),
      carreta(221000, 150),
      carreta(174000, 152),
      carreta(240000, 150),
    ]);
    // A alíquota se espalha — de ~0,050% a ~0,097% — e mesmo assim não houve
    // cálculo nenhum por veículo: o que é constante é o valor em reais.
    expect(a.desvio).toBeGreaterThan(0.005);
    expect(a.veredito).toBe("VALOR_FIXO");
  });

  it("não chama de taxa fixa o percentual único, em que os reais variam com a nota", () => {
    const [a] = aliquotaImplicita(
      [200000, 350000, 480000, 260000, 310000, 420000].map((nf) => ({
        ponta: "BASE" as const,
        entityType: "CAVALO",
        entityLabel: `P${nf}`,
        valorNf: nf,
        ipva: nf * 0.01,
      })),
    );
    expect(a.veredito).toBe("FORMULA_UNICA");
  });

  it("continua chamando de cálculo por ativo o que não é fixo dos dois lados", () => {
    // Jul/2026: nem percentual único, nem taxa única — alguém olhou cada placa.
    const [a] = aliquotaImplicita(
      [
        [200000, 0.535],
        [350000, 0.62],
        [480000, 0.651],
        [260000, 0.7],
        [310000, 1.193],
        [420000, 0.58],
      ].map(([nf, p]) => ({
        ponta: "BASE" as const,
        entityType: "CAVALO",
        entityLabel: `P${nf}`,
        valorNf: nf,
        ipva: nf * (p / 100),
      })),
    );
    expect(a.veredito).toBe("POR_VEICULO");
  });
});
