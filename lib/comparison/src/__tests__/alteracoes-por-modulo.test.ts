import { describe, expect, it } from "vitest";
import {
  agruparPorArea,
  cartaoAusente,
  cartaoDeRubrica,
  cartaoDoCustoFixo,
  notasDaEquipe,
  notasDoCustoFixo,
} from "../alteracoes-por-modulo";
import type { ResumoDoModulo } from "../monitor-custo-fixo";
import type { ResumoDoModuloDeEquipe } from "../monitor-equipe";

const PAR = {
  baseId: "a",
  comparadaId: "b",
  baseRotulo: "junho/2026",
  comparadaRotulo: "julho/2026",
  baseData: "2026-06-01",
  comparadaData: "2026-07-01",
};

function resumoDeIpva(): ResumoDoModulo {
  return {
    modulo: "IPVA",
    rotulo: "IPVA",
    rota: "/custo-fixo-ipva",
    alteracoes: 206,
    porSituacao: {
      VALORADO: 112,
      SEM_VALORACAO: 47,
      NAO_MONETARIA: 0,
      FORA_DO_TOTAL: 47,
    },
    ganhos: 1,
    perdas: 61,
    entidades: Array.from({ length: 159 }, (_, i) => `VEICULO:${i}`),
    porPeriodicidade: { ANUAL: -144874.5 },
    decomposicao: { ANUAL: { ganho: 120, perda: -144994.5 } },
    impactoDeOrigem: {
      modulo: "IPVA",
      porPeriodicidade: { ANUAL: -144874.5 },
      naoCalculavel: 47,
      foraDaSoma: 47,
      valoresNegativos: 1,
    },
    par: PAR,
  };
}

describe("as pendências de cada família são escritas uma vez só", () => {
  /*
    A frase é do domínio e o número é da tela. O teste guarda as duas metades:
    que a nota carrega a contagem crua, e que a frase não traz número embutido —
    se trouxesse, a tela escreveria o milhar duas vezes, de dois jeitos.
  */
  it("devolve, no IPVA, as três pendências que só ele conhece", () => {
    expect(notasDoCustoFixo(resumoDeIpva().impactoDeOrigem)).toEqual([
      { quantidade: 47, frase: "em coluna de dinheiro sem preço apurado" },
      { quantidade: 47, frase: "fora da soma" },
      {
        quantidade: 1,
        frase: "com uma das pontas negativa — estorno ou erro de cadastro",
      },
    ]);
  });

  /*
    Zero não vira linha. Escrevê-lo faria o cartão publicar "0 fora da soma" —
    uma medição que não houve, ocupando a linha de uma que houve.
  */
  it("não escreve pendência zerada", () => {
    const impacto = {
      ...resumoDeIpva().impactoDeOrigem,
      naoCalculavel: 0,
      foraDaSoma: 0,
      valoresNegativos: 0,
    };
    expect(notasDoCustoFixo(impacto)).toEqual([]);
  });

  it("conta, na equipe, o que entrou, o que saiu e para onde o efetivo foi", () => {
    const resumo = {
      modulo: "transporte",
      quadros: ["OPERACIONAL"],
      porQuadro: [{ quadro: "OPERACIONAL", alteracoes: 4 }],
      alteracoes: 4,
      porSituacao: {
        EFETIVO: 2,
        SEM_VALORACAO: 1,
        FORA_DA_SOMA: 0,
        NAO_MONETARIA: 1,
      },
      variaveisAlteradas: 3,
      cargosQueEntraram: 2,
      cargosQueSairam: 0,
      quantidadesQueSubiram: 1,
      quantidadesQueDesceram: 0,
      cargos: ["a", "b"],
    } as ResumoDoModuloDeEquipe;

    expect(notasDaEquipe(resumo)).toEqual([
      { quantidade: 2, frase: "cargos entraram no quadro" },
      { quantidade: 1, frase: "quantidades subiram" },
    ]);
  });
});

describe("o cartão é o resumo do módulo, e não uma segunda régua", () => {
  it("repassa o que a rubrica de custo fixo publicou, campo a campo", () => {
    const cartao = cartaoDoCustoFixo(resumoDeIpva());

    expect(cartao.area).toBe("CUSTO_FIXO");
    expect(cartao.cobertura).toBe("EQUIPAMENTO");
    expect(cartao.rotulo).toBe("IPVA");
    expect(cartao.rota).toBe("/custo-fixo-ipva");
    expect(cartao.alteracoes).toBe(206);
    expect(cartao.entidades).toBe(159);
    expect(cartao.ganhos).toBe(1);
    expect(cartao.perdas).toBe(61);
    expect(cartao.porPeriodicidade).toEqual({ ANUAL: -144874.5 });
    expect(cartao.par).toEqual(PAR);
    expect(cartao.ausente).toBeNull();
  });

  /*
    A entidade é contada pela **união** das chaves, e não pelo tamanho da lista:
    a mesma placa aparece em várias colunas da mesma rubrica, e somar as linhas
    daria mais veículos do que a frota tem — o defeito que `consolidar` já
    documenta do outro lado.
  */
  it("conta entidades distintas, e não linhas", () => {
    const cartao = cartaoDeRubrica({
      area: "CUSTO_VARIAVEL",
      modulo: "PNEU",
      rotulo: "Pneu",
      rota: "/custo-variavel-pneu",
      cobertura: "TRECHO",
      par: PAR,
      rotuloDaEntidade: "Trechos",
      linhas: [
        { entityLabel: "T1" },
        { entityLabel: "T1" },
        { entityLabel: "T2" },
        { entityLabel: null },
      ],
      impacto: { porPeriodicidade: {}, naoCalculavel: 3, foraDaSoma: 2 },
      notas: [
        { quantidade: 5, frase: "parcelas de R$/km se moveram" },
        { quantidade: 0, frase: "vidas úteis se moveram" },
      ],
    });

    expect(cartao.alteracoes).toBe(4);
    expect(cartao.entidades).toBe(2);
    expect(cartao.notas).toEqual([
      { quantidade: 3, frase: "em coluna de dinheiro sem preço apurado" },
      { quantidade: 2, frase: "fora da soma" },
      { quantidade: 5, frase: "parcelas de R$/km se moveram" },
    ]);
  });

  /*
    O módulo sem par fica na lista, zerado e explicado. Sumir com ele faria "o
    pneu não mudou" ser lido onde o que houve foi uma importação que não veio.
  */
  it("mantém na lista o módulo sem par, com a frase do porquê", () => {
    const cartao = cartaoAusente({
      area: "CUSTO_VARIAVEL",
      modulo: "TMA",
      rotulo: "TMA",
      rota: "/custo-variavel-tma",
      cobertura: "TRECHO",
      ausente: "Nenhuma vigência de trecho foi importada ainda.",
      rotuloDaEntidade: "Trechos",
    });

    expect(cartao.par).toBeNull();
    expect(cartao.alteracoes).toBe(0);
    expect(cartao.ausente).toContain("importada ainda");
  });
});

describe("o catálogo agrupa, e nunca funde régua nenhuma", () => {
  const cartoes = [
    cartaoDoCustoFixo(resumoDeIpva()),
    cartaoDoCustoFixo({
      ...resumoDeIpva(),
      modulo: "FINAME",
      rotulo: "FINAME",
      rota: "/custo-fixo-finame",
      alteracoes: 76,
      porPeriodicidade: { MENSAL: -17171.54 },
      impactoDeOrigem: {
        modulo: "FINAME",
        porPeriodicidade: { MENSAL: -17171.54 },
        naoCalculavel: 0,
        foraDaSoma: 0,
        cobertasPorParcelas: 3,
        porOutroModulo: {},
      },
    }),
    cartaoDeRubrica({
      area: "CUSTO_VARIAVEL",
      modulo: "PNEU",
      rotulo: "Pneu",
      rota: "/custo-variavel-pneu",
      cobertura: "TRECHO",
      par: PAR,
      rotuloDaEntidade: "Trechos",
      linhas: [{ entityLabel: "T1" }],
      impacto: { porPeriodicidade: { MENSAL: 100 }, foraDaSoma: 0 },
    }),
  ];

  it("soma dentro do balde e nunca entre baldes", () => {
    const custoFixo = agruparPorArea(cartoes).find((a) => a.area === "CUSTO_FIXO")!;

    expect(custoFixo.porPeriodicidade).toEqual({
      ANUAL: -144874.5,
      MENSAL: -17171.54,
    });
    expect(custoFixo.alteracoes).toBe(282);
    expect(custoFixo.modulosApurados).toBe(2);
  });

  /*
    O mensal do custo variável não entra no mensal do custo fixo. São réguas
    diferentes — uma é dinheiro do período, a outra é razão que só vira dinheiro
    multiplicada por produção — e fundi-las é a conta que esta tela não faz.
  */
  it("não mistura o dinheiro de uma área com o de outra", () => {
    const areas = agruparPorArea(cartoes);
    const variavel = areas.find((a) => a.area === "CUSTO_VARIAVEL")!;

    expect(variavel.porPeriodicidade).toEqual({ MENSAL: 100 });
    expect(areas.find((a) => a.area === "CUSTO_FIXO")!.porPeriodicidade.MENSAL).toBe(
      -17171.54,
    );
  });

  /* A área sem cartão nenhum continua na lista: a ausência é resposta. */
  it("publica as três áreas mesmo quando uma não trouxe cartão", () => {
    expect(agruparPorArea(cartoes).map((a) => a.area)).toEqual([
      "CUSTO_FIXO",
      "CUSTO_VARIAVEL",
      "EQUIPE",
    ]);
    expect(agruparPorArea(cartoes).find((a) => a.area === "EQUIPE")!.cartoes).toEqual(
      [],
    );
  });
});
