import { describe, expect, it } from "vitest";
import { agruparVeiculos } from "../agrupamento-por-veiculo";
import { agruparPorVeiculoDeIpva, type LinhaDeIpva } from "../ipva";
import { agruparPorVeiculoDeLucroFixo, type LinhaDeLucroFixo } from "../lucro-fixo";
import { agruparPorVeiculoDeImpostos, type LinhaDeImpostos } from "../impostos";

/**
 * O AGRUPAMENTO POR VEÍCULO, nas três rubricas que o herdaram do FINAME.
 *
 * O que estes casos prendem não é formatação: é que as quatro telas de custo
 * fixo leem a mesma frota do mesmo jeito. Uma placa tem **um** estado — o mais
 * grave —, a coluna de dinheiro é **uma** variável, e o que não está no recorte
 * fica nulo em vez de virar R$ 0,00.
 */

const deIpva = (over: Partial<LinhaDeIpva> = {}): LinhaDeIpva => ({
  id: 1,
  entityLabel: "QYW6D15",
  entityType: "CAVALO",
  variavel: "ipva",
  rotuloDaVariavel: "IPVA / Licenciamento",
  medida: "DINHEIRO",
  attributeCode: "cavalo.ipva_licenciamento",
  base: "15106.89",
  comparada: "2485.87",
  diferenca: -12621.02,
  variacao: -83.55,
  estado: "ALTERADO",
  motivo: null,
  impactoAmount: -12621.02,
  impactoPeriodicidade: "ANUAL",
  impactoCalculado: true,
  foraDaSoma: null,
  ...over,
});

describe("uma placa é uma linha", () => {
  it("junta as variáveis da mesma placa, e separa cavalo de carreta", () => {
    const veiculos = agruparPorVeiculoDeIpva([
      deIpva(),
      deIpva({ id: 2, variavel: "valor_nf", rotuloDaVariavel: "Valor de NF" }),
      deIpva({ id: 3, entityLabel: "ABC1D23" }),
      /* Mesma placa, outro tipo: são dois equipamentos, e não um. */
      deIpva({ id: 4, entityType: "CARRETA" }),
    ]);

    expect(veiculos).toHaveLength(3);
    expect(veiculos.find((v) => v.entityLabel === "QYW6D15" && v.entityType === "CAVALO")!.linhas)
      .toHaveLength(2);
  });

  it("conta alterações, e conta separado as que são dinheiro", () => {
    const [veiculo] = agruparPorVeiculoDeIpva([
      deIpva(),
      deIpva({ id: 2, variavel: "ano", rotuloDaVariavel: "Ano", medida: "ANO" }),
    ]);

    expect(veiculo.alteracoes).toBe(2);
    expect(veiculo.alteracoesEmDinheiro).toBe(1);
  });

  /* Entrada e saída de ativo explicam as outras linhas da placa, e não são mais
     uma delas: contá-las poria "1 alteração" numa placa que só entrou na frota. */
  it("a linha do veículo não conta como alteração", () => {
    const [veiculo] = agruparPorVeiculoDeIpva([
      deIpva({ variavel: "veiculo", rotuloDaVariavel: "Veículo", estado: "ALTERADO" }),
    ]);

    expect(veiculo.alteracoes).toBe(0);
  });

  it("a linha sem alteração não é contada, mas continua na expansão", () => {
    const [veiculo] = agruparPorVeiculoDeIpva([
      deIpva({ estado: "SEM_ALTERACAO", diferenca: null, variacao: null }),
    ]);

    expect(veiculo.alteracoes).toBe(0);
    expect(veiculo.linhas).toHaveLength(1);
  });
});

describe("o estado da placa é o mais grave", () => {
  it("o conflito ganha da alteração — um veículo tem um estado só", () => {
    const [veiculo] = agruparPorVeiculoDeIpva([
      deIpva(),
      deIpva({
        id: 2,
        variavel: "valor_nf",
        estado: "CONFLITO",
        motivo: "Duas linhas para a mesma placa.",
      }),
    ]);

    expect(veiculo.estado).toBe("CONFLITO");
  });

  it("e a ordem em que as linhas chegam não muda a resposta", () => {
    const linhas = [
      deIpva({ id: 2, variavel: "valor_nf", estado: "CONFLITO", motivo: "x" }),
      deIpva(),
    ];
    expect(agruparPorVeiculoDeIpva(linhas)[0].estado).toBe("CONFLITO");
  });
});

describe("a coluna de dinheiro é uma variável, e nunca uma soma", () => {
  it("no IPVA é o licenciamento anual — o valor de NF fica de fora", () => {
    const [veiculo] = agruparPorVeiculoDeIpva([
      deIpva(),
      deIpva({
        id: 2,
        variavel: "valor_nf",
        rotuloDaVariavel: "Valor de NF",
        base: "500000",
        comparada: "500000",
        diferenca: 0,
      }),
    ]);

    expect(veiculo.destaque).toEqual({
      base: 15106.89,
      comparada: 2485.87,
      diferenca: -12621.02,
      variacao: -83.55,
    });
  });

  /* Nulo aqui é "não está no recorte", e nunca "não mudou" — um filtro por
     variável que tirasse o destaque não pode fazer a placa valer R$ 0,00. */
  it("fica nula quando a variável de destaque não está no recorte", () => {
    const [veiculo] = agruparPorVeiculoDeIpva([
      deIpva({ variavel: "valor_nf", rotuloDaVariavel: "Valor de NF" }),
    ]);

    expect(veiculo.destaque).toBeNull();
  });

  it("no lucro fixo é a parcela própria, e não a do conjunto", () => {
    const linha = (over: Partial<LinhaDeLucroFixo>): LinhaDeLucroFixo =>
      ({
        id: 1,
        entityLabel: "ABC1D23",
        entityType: "CARRETA",
        variavel: "lucro_fixo",
        rotuloDaVariavel: "Lucro fixo",
        medida: "DINHEIRO",
        attributeCode: "carreta.lucro_fixomodelo_novo_ciclo_carreta",
        base: "1000",
        comparada: "1500",
        diferenca: 500,
        variacao: 50,
        estado: "ALTERADO",
        motivo: null,
        impactoAmount: 500,
        impactoPeriodicidade: "MENSAL",
        impactoCalculado: true,
        foraDaSoma: null,
        ...over,
      }) as LinhaDeLucroFixo;

    const [veiculo] = agruparPorVeiculoDeLucroFixo([
      linha({}),
      linha({
        id: 2,
        variavel: "lucro_fixo_conjunto",
        rotuloDaVariavel: "Lucro fixo do conjunto (cavalo + carreta)",
        base: "9000",
        comparada: "9500",
        diferenca: 500,
        foraDaSoma: "embute a parcela do cavalo vinculado",
      }),
    ]);

    expect(veiculo.destaque?.base).toBe(1000);
  });

  it("nos impostos é o PIS/COFINS — o ICMS não se soma a ele", () => {
    const linha = (over: Partial<LinhaDeImpostos>): LinhaDeImpostos =>
      ({
        id: 1,
        entityLabel: "ABC1D23",
        entityType: "CAVALO",
        variavel: "pis_cofins",
        rotuloDaVariavel: "PIS/COFINS da compra",
        medida: "DINHEIRO",
        tributo: "PIS_COFINS",
        papel: "MONTANTE",
        attributeCode: "cavalo.valor_pis_cofins",
        base: "37890.84",
        comparada: "40000",
        diferenca: 2109.16,
        variacao: 5.57,
        estado: "ALTERADO",
        motivo: null,
        impactoAmount: 2109.16,
        impactoPeriodicidade: "PONTUAL",
        impactoCalculado: true,
        foraDaSoma: null,
        ...over,
      }) as LinhaDeImpostos;

    const [veiculo] = agruparPorVeiculoDeImpostos([
      linha({}),
      linha({
        id: 2,
        variavel: "icms",
        rotuloDaVariavel: "ICMS da compra",
        tributo: "ICMS",
        attributeCode: "cavalo.valor_icms",
        base: "0",
        comparada: "0",
        diferenca: 0,
        foraDaSoma: "Zero nas 1.215 linhas do acervo",
      }),
    ]);

    expect(veiculo.destaque?.diferenca).toBe(2109.16);
    /* O que se moveu no ICMS continua contado, e continua na expansão. */
    expect(veiculo.linhas).toHaveLength(2);
  });
});

describe("as duas ordens, e nenhuma delas é a do motor", () => {
  it("as linhas de dentro seguem o catálogo", () => {
    const [veiculo] = agruparPorVeiculoDeIpva([
      deIpva({ id: 2, variavel: "ano", rotuloDaVariavel: "Ano", medida: "ANO" }),
      deIpva(),
      deIpva({ variavel: "veiculo", rotuloDaVariavel: "Veículo", id: 3 }),
    ]);

    expect(veiculo.linhas.map((l) => l.variavel)).toEqual(["veiculo", "ipva", "ano"]);
  });

  it("as placas seguem o dinheiro — a maior queda não vai para a página quatro", () => {
    const veiculos = agruparPorVeiculoDeIpva([
      deIpva({ entityLabel: "PEQUENA", diferenca: -10 }),
      deIpva({ entityLabel: "GRANDE", diferenca: -9000 }),
      deIpva({ entityLabel: "MEDIA", diferenca: -500 }),
    ]);

    expect(veiculos.map((v) => v.entityLabel)).toEqual(["GRANDE", "MEDIA", "PEQUENA"]);
  });

  it("sem destaque no recorte, desempata pelo número de alterações", () => {
    const veiculos = agruparPorVeiculoDeIpva([
      deIpva({ entityLabel: "UMA", variavel: "ano", medida: "ANO", diferenca: null }),
      deIpva({ entityLabel: "DUAS", variavel: "ano", medida: "ANO", diferenca: null }),
      deIpva({
        entityLabel: "DUAS",
        id: 2,
        variavel: "valor_nf",
        diferenca: null,
        variacao: null,
      }),
    ]);

    expect(veiculos.map((v) => v.entityLabel)).toEqual(["DUAS", "UMA"]);
  });
});

describe("o núcleo, direto — o que ele não sabe de rubrica nenhuma", () => {
  /* A lista de ordem é a régua: o que não está nela vai para o fim, em vez de
     quebrar ou de se ordenar sozinho pelo nome. */
  it("a variável fora do catálogo vai para o fim", () => {
    const [veiculo] = agruparVeiculos(
      [
        { ...deIpva({ variavel: "desconhecida" }) },
        { ...deIpva({ variavel: "ipva", id: 2 }) },
      ],
      { ordemDasVariaveis: ["ipva"], destaque: "ipva" },
    );

    expect(veiculo.linhas.map((l) => l.variavel)).toEqual(["ipva", "desconhecida"]);
  });

  it("uma lista vazia devolve nenhuma placa, e não uma placa vazia", () => {
    expect(agruparVeiculos([], { ordemDasVariaveis: [], destaque: "ipva" })).toEqual([]);
  });
});
