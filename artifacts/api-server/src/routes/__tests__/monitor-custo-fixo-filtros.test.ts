import { describe, expect, it } from "vitest";
import type { LinhaDoMonitor, ResumoDoMonitor } from "@workspace/comparison";
import {
  baldesDoMonitor,
  parseFiltros,
  passaNaBusca,
  passaNaPeriodicidade,
  passaNaSituacao,
  passaNoEquipamento,
} from "../monitor-custo-fixo";

/**
 * Os filtros do Monitor Custo Fixo, sem banco.
 *
 * O recorte é a parte da rota que decide o que entra na resposta — e, como o
 * impacto é calculado **depois** dele, um filtro errado não produz uma tabela
 * errada: produz um cartão errado. Por isso ele é testado de frente, e não pelo
 * efeito.
 *
 * Duas regras aqui são promessas explícitas da tela, e as duas são fáceis de
 * quebrar sem perceber:
 *
 * - **um filtro que não se aplica a um módulo não apaga o módulo** — hoje só o
 *   equipamento tem esse caso, e ele existe pensando no QLP, que é de cargo;
 * - **um valor inválido no endereço cai no padrão**, nunca em tela vazia.
 */

const base: LinhaDoMonitor = {
  id: "FINAME:1",
  modulo: "FINAME",
  changeId: 1,
  par: {
    baseId: "a1",
    comparadaId: "b2",
    baseRotulo: null,
    comparadaRotulo: null,
    baseData: null,
    comparadaData: null,
  },
  entidade: { tipo: "VEICULO", rotulo: "ABC1D23", entityType: "CAVALO", placa: "ABC1D23" },
  variavel: {
    chave: "parcela",
    rotulo: "Parcela FINAME",
    medida: "DINHEIRO",
    attributeCode: "cavalo.finame_cavalo",
  },
  estado: "ALTERADO",
  valorAnterior: "8450",
  valorAtual: "8760",
  variacao: 3.67,
  impacto: {
    situacao: "VALORADO",
    direcao: "GANHO",
    valor: 310,
    periodicidade: "MENSAL",
    motivo: null,
  },
  prioridade: { nivel: "MEDIO", score: 35, motivos: [] },
  origem: {
    modulo: "FINAME",
    rotulo: "FINAME",
    rota: "/custo-fixo-finame",
    changeSetId: "cs-1",
  },
};

const linha = (over: Partial<LinhaDoMonitor> = {}): LinhaDoMonitor => ({ ...base, ...over });

describe("o filtro de equipamento", () => {
  it("recorta o veículo pelo tipo dele", () => {
    const cavalo = linha();
    const carreta = linha({
      entidade: { tipo: "VEICULO", rotulo: "DEF2G45", entityType: "CARRETA", placa: "DEF2G45" },
    });
    expect(passaNoEquipamento(cavalo, "CAVALO")).toBe(true);
    expect(passaNoEquipamento(carreta, "CAVALO")).toBe(false);
    expect(passaNoEquipamento(carreta, "CARRETA")).toBe(true);
  });

  it("deixa passar quem não é veículo — o filtro não se aplica, e não apaga", () => {
    /*
      Esta é a promessa que o Monitor faz por escrito na tela. Hoje nenhum dos
      quatro módulos produz linha assim; quando o QLP entrar, com grão de cargo,
      um filtro "Cavalo" que recortasse por `entityType` faria as linhas dele
      sumirem sem uma palavra — dado existindo e tela vazia.
    */
    const cargo = linha({
      modulo: "FINAME",
      entidade: {
        tipo: "CARGO",
        rotulo: "Conferente · turno 2",
        entityType: "QLP_OPERACIONAL",
        placa: null,
      },
    });
    expect(passaNoEquipamento(cargo, "CAVALO")).toBe(true);
    expect(passaNoEquipamento(cargo, "CARRETA")).toBe(true);
  });

  it("sem equipamento escolhido, todos passam", () => {
    expect(passaNoEquipamento(linha(), null)).toBe(true);
  });
});

describe("os demais recortes", () => {
  it("filtra por situação, e uma lista vazia não recorta", () => {
    expect(passaNaSituacao(linha(), [])).toBe(true);
    expect(passaNaSituacao(linha(), ["VALORADO"])).toBe(true);
    expect(passaNaSituacao(linha(), ["SEM_VALORACAO"])).toBe(false);
  });

  it("filtra por periodicidade, e o que não tem periodicidade sai quando ele está ligado", () => {
    const semValor = linha({
      impacto: { ...base.impacto, situacao: "SEM_VALORACAO", valor: null, periodicidade: null },
    });
    expect(passaNaPeriodicidade(semValor, [])).toBe(true);
    expect(passaNaPeriodicidade(linha(), ["MENSAL"])).toBe(true);
    expect(passaNaPeriodicidade(linha(), ["ANUAL"])).toBe(false);
    // Quem filtra por "mensal" está perguntando pelo dinheiro do mês.
    expect(passaNaPeriodicidade(semValor, ["MENSAL"])).toBe(false);
  });

  it("busca por placa, variável, código do atributo e módulo", () => {
    expect(passaNaBusca(linha(), "abc1d23")).toBe(true);
    expect(passaNaBusca(linha(), "parcela")).toBe(true);
    expect(passaNaBusca(linha(), "finame_cavalo")).toBe(true);
    expect(passaNaBusca(linha(), "FINAME")).toBe(true);
    expect(passaNaBusca(linha(), "ipva")).toBe(false);
    expect(passaNaBusca(linha(), null)).toBe(true);
  });
});

describe("a leitura dos parâmetros", () => {
  it("aceita lista separada por vírgula e repetição", () => {
    expect(parseFiltros({ modulo: "IPVA,IMPOSTOS" }).filtros.modulos).toEqual([
      "IPVA",
      "IMPOSTOS",
    ]);
    expect(parseFiltros({ modulo: ["IPVA", "FINAME"] }).filtros.modulos).toEqual([
      "IPVA",
      "FINAME",
    ]);
  });

  it("cai em todos os módulos quando nenhum é pedido", () => {
    /*
      A lista escrita por extenso, e não `MODULOS_DO_MONITOR`: é ela que prende a
      ordem em que o menu os oferece, e um módulo que entrasse no Monitor sem
      alguém decidir onde ele aparece passaria despercebido. O Aluguel entrou
      depois do FINAME de propósito — nos implementos alugados a parcela de lá é
      o aluguel daqui, e as duas linhas falam do mesmo contrato.
    */
    expect(parseFiltros({}).filtros.modulos).toEqual([
      "FINAME",
      "ALUGUEL",
      "IPVA",
      "LUCRO_FIXO",
      "IMPOSTOS",
    ]);
  });

  it("descarta o inválido e diz o que descartou, em vez de esvaziar a tela", () => {
    const { filtros, ignorados } = parseFiltros({
      modulo: "CAFE",
      situacao: "TALVEZ",
      equipamento: "BICICLETA",
    });
    /*
      Recortar por um valor que não existe daria zero linhas — correto e
      inexplicável. O padrão é mais honesto, e o aviso é o que impede que ele
      pareça um filtro aplicado.
    */
    expect(filtros.modulos).toEqual([
      "FINAME",
      "ALUGUEL",
      "IPVA",
      "LUCRO_FIXO",
      "IMPOSTOS",
    ]);
    expect(filtros.situacoes).toEqual([]);
    expect(filtros.equipamento).toBeNull();
    expect(ignorados).toEqual([
      'módulo "CAFE"',
      'equipamento "BICICLETA"',
      'situação "TALVEZ"',
    ]);
  });

  it("não reclama de `equipamento=TODOS`, que é o jeito de dizer 'nenhum recorte'", () => {
    const { filtros, ignorados } = parseFiltros({ equipamento: "TODOS" });
    expect(filtros.equipamento).toBeNull();
    expect(ignorados).toEqual([]);
  });

  it("ignora maiúsculas e espaços, que é como um endereço colado chega", () => {
    const { filtros } = parseFiltros({ modulo: " ipva , impostos ", equipamento: "cavalo" });
    expect(filtros.modulos).toEqual(["IPVA", "IMPOSTOS"]);
    expect(filtros.equipamento).toBe("CAVALO");
  });
});

/**
 * Os baldes que o menu do seletor recebe.
 *
 * Saíam daqui **dois** por periodicidade, um de custo e um de receita, porque o
 * Monitor era o único recorte do produto em que as duas naturezas viajavam
 * juntas e somá-las teria juntado um custo que subiu com uma receita que subiu.
 * Não há mais natureza: os cinco módulos falam o idioma de quem recebe,
 * positivo é ganho e negativo é perda, e o líquido da periodicidade é a leitura
 * inteira.
 *
 * O que este bloco continua guardando é a recusa que sobreviveu: **periodicidade
 * nunca se mistura**. Mensal e pontual seguem em duas entradas, e nenhuma linha
 * do menu junta as duas.
 */
describe("os baldes do Monitor como o menu os lê", () => {
  const resumo = (baldes: ResumoDoMonitor["baldes"]): ResumoDoMonitor => ({
    alteracoes: 0,
    porSituacao: {
      VALORADO: 0,
      SEM_VALORACAO: 0,
      NAO_MONETARIA: 0,
      FORA_DO_TOTAL: 0,
    },
    ganhos: 0,
    perdas: 0,
    entidadesAfetadas: 0,
    baldes,
    porModulo: [],
  });

  it("publica o líquido de cada periodicidade, e não as metades", () => {
    const baldes = baldesDoMonitor(
      resumo([{ periodicidade: "MENSAL", liquido: 300, ganho: 1200, perda: -900 }]),
    );

    expect(baldes).toEqual([{ periodicidade: "MENSAL", valor: 300 }]);
    /* A abertura é do quadro da tela, que tem espaço para as duas metades. A
       linha do menu cabe num canto, e ali o que decide é o sinal do líquido. */
    expect(baldes.map((b) => b.valor)).not.toContain(1200);
    expect(baldes.map((b) => b.valor)).not.toContain(-900);
  });

  /* Duas periodicidades continuam duas, pela razão de sempre: a parcela é
     mensal e a base de compra é do ato da compra. */
  it("uma entrada por periodicidade, e nunca uma soma das duas", () => {
    const baldes = baldesDoMonitor(
      resumo([
        { periodicidade: "MENSAL", liquido: 10, ganho: 10, perda: 0 },
        { periodicidade: "PONTUAL", liquido: 50, ganho: 50, perda: 0 },
      ]),
    );

    expect(baldes).toEqual([
      { periodicidade: "MENSAL", valor: 10 },
      { periodicidade: "PONTUAL", valor: 50 },
    ]);
    expect(baldes.map((b) => b.valor)).not.toContain(60);
  });

  /*
    O zerado sai na lista, e é deliberado: quem decide se ele vira texto é
    `numerosDaLinha`, do lado do cliente, onde mora inteira a regra de que zero
    não é ausência. A rota que já o filtrasse tiraria daquela função a
    informação de que a conta aconteceu.
  */
  it("o balde zerado vai na resposta — filtrar é decisão do cliente", () => {
    const baldes = baldesDoMonitor(
      resumo([{ periodicidade: "MENSAL", liquido: 0, ganho: 0, perda: 0 }]),
    );

    expect(baldes).toEqual([{ periodicidade: "MENSAL", valor: 0 }]);
  });
});
