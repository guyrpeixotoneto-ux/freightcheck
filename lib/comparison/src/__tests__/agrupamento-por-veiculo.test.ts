import { describe, expect, it } from "vitest";
import {
  agruparVeiculos,
  contarVeiculos,
  medidaDoDestaque,
  rubricaTemDinheiro,
} from "../agrupamento-por-veiculo";
import { AGRUPAMENTO_DE_FINAME } from "../finame";
import {
  AGRUPAMENTO_DE_MANUTENCAO,
  agruparPorVeiculoDeManutencao,
  type LinhaDeManutencao,
} from "../manutencao";
import { AGRUPAMENTO_DE_IPVA, agruparPorVeiculoDeIpva, type LinhaDeIpva } from "../ipva";
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

/**
 * O QUE A LINHA-MÃE MOSTRA — e por que quatro travessões eram uma mentira.
 *
 * A RZN6A79 da Manutenção moveu o R$/km do BID de 0,4400 para 0,4500, e a tela
 * escrevia, na linha dela: "Alterado", "1 (0 em R$)" e quatro travessões. Os
 * três estavam certos pela régua antiga e os três liam errado — o complemento
 * dizia da rubrica (que não tem reais) o que parecia dizer da placa, e o
 * travessão, que significa "não há valor aplicável", estava no lugar de um
 * valor que existia uma linha abaixo.
 *
 * Nada do que estes casos prendem é de Manutenção: a régua é a **medida** do
 * destaque de cada rubrica, e é a mesma nas oito.
 */
const deManutencao = (over: Partial<LinhaDeManutencao> = {}): LinhaDeManutencao => ({
  id: 1,
  entityLabel: "RZN6A79",
  entityType: "CAVALO",
  variavel: "bid",
  rotuloDaVariavel: "R$/km do BID",
  medida: "REAIS_POR_KM",
  attributeCode: "cavalo.manutencao_bid",
  base: "0.44",
  comparada: "0.45",
  diferenca: 0.01,
  variacao: 2.27,
  estado: "ALTERADO",
  motivo: null,
  impactoAmount: null,
  impactoPeriodicidade: null,
  impactoCalculado: false,
  foraDaSoma: null,
  ...over,
});

const reaisKm = (over: Partial<LinhaDeManutencao> = {}): LinhaDeManutencao =>
  deManutencao({
    id: 9,
    variavel: "reais_km",
    rotuloDaVariavel: "Manutenção R$/km",
    attributeCode: "cavalo.manutencao_reais_km",
    ...over,
  });

describe("o destaque exibido — o que a placa mostra quando o declarado não veio", () => {
  it("só o BID mexeu: a linha-mãe mostra o BID, dizendo que é o BID", () => {
    const [veiculo] = agruparPorVeiculoDeManutencao([deManutencao()]);

    expect(veiculo.destaque).toBeNull(); // o `reais_km` continua fora do recorte
    expect(veiculo.destaqueExibido).toEqual({
      tipo: "SUBSTITUTO",
      variavel: "bid",
      rotulo: "R$/km do BID",
      medida: "REAIS_POR_KM",
      estado: "ALTERADO",
      valores: { base: 0.44, comparada: 0.45, diferenca: 0.01, variacao: 2.27 },
    });
  });

  it("o R$/km resolvido no recorte manda, e o BID não o disputa", () => {
    const [veiculo] = agruparPorVeiculoDeManutencao([
      deManutencao(),
      reaisKm({ base: "0.34", comparada: "0.36", diferenca: 0.02, variacao: 5.88 }),
    ]);

    expect(veiculo.destaqueExibido).toMatchObject({
      tipo: "PRINCIPAL",
      variavel: "reais_km",
      valores: { base: 0.34, comparada: 0.36 },
    });
  });

  /* Duas candidatas e nenhuma regra de desempate que alguém tenha pedido: a
     linha-mãe conta, e a expansão tem as duas escritas. */
  it("duas variáveis em R$/km alteradas: a placa conta, e não elege", () => {
    const [veiculo] = agruparPorVeiculoDeManutencao([
      deManutencao(),
      deManutencao({
        id: 2,
        variavel: "contrato",
        rotuloDaVariavel: "R$/km do contrato",
        attributeCode: "cavalo.manutencao_contrato",
        base: "0.34",
        comparada: "0.36",
        diferenca: 0.02,
        variacao: 5.88,
      }),
    ]);

    expect(veiculo.destaqueExibido).toEqual({
      tipo: "MULTIPLOS",
      medida: "REAIS_POR_KM",
      variaveis: ["R$/km do BID", "R$/km do contrato"],
    });
  });

  it("o que mexeu em outra medida não assume a linha: meses não é R$/km", () => {
    const [veiculo] = agruparPorVeiculoDeManutencao([
      deManutencao({
        variavel: "vida_meses",
        rotuloDaVariavel: "Vida em meses",
        medida: "MESES",
        attributeCode: "cavalo.manutencao_vida_meses",
        base: "59.8",
        comparada: "47.8",
        diferenca: -12,
        variacao: -20.07,
      }),
    ]);

    expect(veiculo.alteracoes).toBe(1);
    expect(veiculo.destaqueExibido).toBeNull();
  });

  /* `valor_reajustado` é `manutencao_contrato` com outro nome — o mesmo número
     em 558 de 558 linhas do acervo. Deixá-la representar a placa escreveria o
     contrato como se fosse um segundo achado. */
  it("a coluna fora da soma não vira o número da placa", () => {
    const [veiculo] = agruparPorVeiculoDeManutencao([
      deManutencao({
        variavel: "valor_reajustado",
        rotuloDaVariavel: "Valor reajustado",
        attributeCode: "cavalo.valor_reajustado",
        foraDaSoma: "É `cavalo.manutencao_contrato` com outro nome.",
      }),
    ]);

    expect(veiculo.destaqueExibido).toBeNull();
  });

  it("nada da medida do destaque no recorte: nulo, que é o travessão da tela", () => {
    const [veiculo] = agruparPorVeiculoDeManutencao([
      deManutencao({
        variavel: "percentual_reajuste",
        rotuloDaVariavel: "Reajuste aplicado",
        medida: "PERCENTUAL",
        attributeCode: "cavalo.percentual_reajuste_aplicado",
      }),
    ]);

    expect(veiculo.destaqueExibido).toBeNull();
  });
});

describe("zero medido, ausência e parada são três coisas", () => {
  it("o zero do R$/km é zero, e chega escrito como zero", () => {
    const [veiculo] = agruparPorVeiculoDeManutencao([
      reaisKm({ base: "0.34", comparada: "0", diferenca: -0.34, variacao: -100 }),
    ]);

    expect(veiculo.destaqueExibido).toMatchObject({
      tipo: "PRINCIPAL",
      estado: "ALTERADO",
      valores: { base: 0.34, comparada: 0, diferenca: -0.34 },
    });
  });

  it("a ponta que não existe é nula — e nulo não é zero", () => {
    const [veiculo] = agruparPorVeiculoDeManutencao([
      reaisKm({
        base: null,
        comparada: "0.34",
        diferenca: null,
        variacao: null,
        estado: "NOVO_NA_VIGENCIA",
      }),
    ]);

    expect(veiculo.destaqueExibido).toMatchObject({
      estado: "NOVO_NA_VIGENCIA",
      valores: { base: null, comparada: 0.34 },
    });
  });

  it("a variável presente e parada é SEM_ALTERACAO, com as duas pontas escritas", () => {
    const [veiculo] = agruparPorVeiculoDeManutencao([
      reaisKm({
        id: null,
        base: "0.34",
        comparada: "0.34",
        diferenca: 0,
        variacao: 0,
        estado: "SEM_ALTERACAO",
      }),
    ]);

    expect(veiculo.alteracoes).toBe(0);
    expect(veiculo.destaqueExibido).toMatchObject({
      tipo: "PRINCIPAL",
      estado: "SEM_ALTERACAO",
      valores: { base: 0.34, comparada: 0.34, diferenca: 0 },
    });
  });
});

describe("a rubrica tem dinheiro, ou não tem — e quem responde é o catálogo", () => {
  it("a Manutenção não tem: R$/km, meses e percentual, e mais nada", () => {
    expect(rubricaTemDinheiro(AGRUPAMENTO_DE_MANUTENCAO)).toBe(false);
    expect(medidaDoDestaque(AGRUPAMENTO_DE_MANUTENCAO)).toBe("REAIS_POR_KM");
  });

  it("FINAME e IPVA têm, e o destaque das duas é em reais", () => {
    for (const agrupamento of [AGRUPAMENTO_DE_FINAME, AGRUPAMENTO_DE_IPVA]) {
      expect(rubricaTemDinheiro(agrupamento)).toBe(true);
      expect(medidaDoDestaque(agrupamento)).toBe("DINHEIRO");
    }
  });

  /* A contagem separada só diz alguma coisa onde as duas medidas convivem: no
     IPVA, o ano é alteração e não é dinheiro; na Manutenção, nenhuma é. */
  it("no IPVA a mistura é real: três alterações, uma em reais", () => {
    const [veiculo] = agruparPorVeiculoDeIpva([
      deIpva(),
      deIpva({ id: 2, variavel: "ano", rotuloDaVariavel: "Ano", medida: "ANO" }),
      deIpva({
        id: 3,
        variavel: "aliquota",
        rotuloDaVariavel: "Alíquota",
        medida: "PERCENTUAL",
      }),
    ]);

    expect(veiculo.alteracoes).toBe(3);
    expect(veiculo.alteracoesEmDinheiro).toBe(1);
  });

  it("na Manutenção a contagem em reais é sempre zero — e por isso não se escreve", () => {
    const [veiculo] = agruparPorVeiculoDeManutencao([
      deManutencao(),
      deManutencao({
        id: 2,
        variavel: "vida_meses",
        rotuloDaVariavel: "Vida em meses",
        medida: "MESES",
      }),
    ]);

    expect(veiculo.alteracoes).toBe(2);
    expect(veiculo.alteracoesEmDinheiro).toBe(0);
  });

  /* Sem catálogo declarado, o núcleo responde o que respondia antes — nenhuma
     rubrica muda de comportamento por ter ficado para trás. */
  it("sem `medidas`, o destaque é dinheiro e a rubrica tem dinheiro", () => {
    const opcoes = { ordemDasVariaveis: ["ipva"], destaque: "ipva" };
    expect(medidaDoDestaque(opcoes)).toBe("DINHEIRO");
    expect(rubricaTemDinheiro(opcoes)).toBe(true);
  });
});

/**
 * A CONTAGEM DAS PLACAS — o número que as abas mostram.
 *
 * A aba e a tabela precisam contar a mesma coisa: enquanto a aba contava
 * linhas, "Alterados (22)" abria uma tabela de dez placas, ao lado de um cartão
 * que dizia 10. O que estes casos prendem é a igualdade que impede isso de
 * voltar — `contarVeiculos` é o `length` de `agruparVeiculos`, sempre.
 */
describe("quantas placas há num recorte", () => {
  const linhas = [
    deIpva(),
    deIpva({ id: 2, variavel: "ano", rotuloDaVariavel: "Ano", medida: "ANO" }),
    deIpva({ id: 3, entityLabel: "QYP3G72" }),
    /* A mesma placa em dois tipos é duas linhas da tabela: a chave é o par
       (placa, tipo), e não a placa. */
    deIpva({ id: 4, entityLabel: "QYP3G72", entityType: "CARRETA" }),
  ];

  it("conta placas, e não linhas", () => {
    expect(linhas).toHaveLength(4);
    expect(contarVeiculos(linhas)).toBe(3);
  });

  it("dá o mesmo número que a tabela desenha", () => {
    expect(contarVeiculos(linhas)).toBe(agruparPorVeiculoDeIpva(linhas).length);
  });

  it("um recorte vazio é zero — e não um travessão nem um erro", () => {
    expect(contarVeiculos([])).toBe(0);
  });
});
