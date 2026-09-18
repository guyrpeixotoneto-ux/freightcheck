import { describe, expect, it } from "vitest";
import {
  agruparEmAbas,
  apuracaoDoCartao,
  assuntosDoQuadro,
  cartaoDoModulo,
  cartaoDoQuadro,
  moduloResolvido,
  naturezaDoCartao,
  paresConsecutivos,
  type ApuracaoDoPar,
  type VarreduraDoCartao,
} from "../ultima-alteracao-financeira";
import { NATUREZA_DO_QLP } from "../natureza-do-modulo";
import { SEM_IMPACTO_FINANCEIRO, modulosDoQlp } from "../qlp-comparacao";
import { SEM_IMPACTO_DE_TMA } from "../tma";
import type { CartaoDeModulo, ParDoCartao } from "../alteracoes-por-modulo";

/**
 * OS CARTÕES DE ÚLTIMA ALTERAÇÃO, MONTADOS.
 *
 * O acervo semeado deste repositório só tem cobertura de **equipamento** — nem
 * trecho, nem os dois quadros do QLP. Estes casos são a prova das outras duas
 * abas: eles montam as coberturas que faltam a partir de cartões representativos
 * e prendem o que a tela promete — cada cartão com o par dele, periodicidades
 * que não se convertem, e a ausência dita com a frase certa.
 *
 * O que eles **não** provam é o número: o impacto continua saindo das funções de
 * cada módulo, e quem as prende são os testes de cada rubrica.
 */

const par = (base: string, comparada: string): ParDoCartao => ({
  baseId: `id:${base}`,
  comparadaId: `id:${comparada}`,
  baseRotulo: `EMPURRADA ${base}`,
  comparadaRotulo: `EMPURRADA ${comparada}`,
  baseData: base,
  comparadaData: comparada,
});

const molde = (over: Partial<CartaoDeModulo> & { modulo: string }): CartaoDeModulo => ({
  area: "CUSTO_FIXO",
  rotulo: over.modulo,
  rota: `/rota/${over.modulo.toLowerCase()}`,
  cobertura: "EQUIPAMENTO",
  par: null,
  ausente: null,
  alteracoes: 0,
  entidades: 0,
  rotuloDaEntidade: "Veículos",
  ganhos: null,
  perdas: null,
  porPeriodicidade: {},
  basePorPeriodicidade: {},
  semImpacto: null,
  notas: [],
  ...over,
});

const apurado = (
  over: Partial<CartaoDeModulo> & { modulo: string },
  pontas: [string, string],
): ApuracaoDoPar => apuracaoDoCartao(molde({ ...over, par: par(...pontas) }), "cs:1");

const varredura = (over: Partial<VarreduraDoCartao> = {}): VarreduraDoCartao => ({
  pares: 8,
  de: "2025-12-16",
  ate: "2026-08-01",
  lacunas: [],
  ...over,
});

// ---------------------------------------------------------------------------
// As fixtures das coberturas que o seed local não tem
// ---------------------------------------------------------------------------

/** As cinco rubricas da malha — nenhuma delas publica montante. */
const MOLDES_DE_TRECHO: CartaoDeModulo[] = [
  { modulo: "CONSUMO", alteracoes: 412, entidades: 88 },
  { modulo: "PNEU", alteracoes: 96, entidades: 40 },
  { modulo: "KM_RODADO", alteracoes: 233, entidades: 88 },
  { modulo: "VELOCIDADE_MEDIA", alteracoes: 51, entidades: 27 },
].map((r) =>
  molde({
    ...r,
    area: "CUSTO_VARIAVEL",
    cobertura: "TRECHO",
    rotuloDaEntidade: "Trechos",
  }),
);

const MOLDE_DE_TMA = molde({
  modulo: "TMA",
  area: "CUSTO_VARIAVEL",
  cobertura: "TRECHO",
  rotuloDaEntidade: "Trechos",
  alteracoes: 18,
  entidades: 9,
  semImpacto: SEM_IMPACTO_DE_TMA,
});

/** Os dezesseis assuntos de um quadro — a lista do domínio, não uma inventada. */
const ASSUNTOS_DO_QLP = modulosDoQlp().map((m) => m.chave);

function moldesDoQuadro(quadro: "OPERACIONAL" | "ADMINISTRATIVO"): CartaoDeModulo[] {
  return ASSUNTOS_DO_QLP.map((assunto) =>
    molde({
      modulo: assunto,
      area: "EQUIPE",
      rotulo: null,
      rota: `/qlp-modulo/${assunto.toLowerCase()}?quadro=${quadro}`,
      cobertura: quadro === "OPERACIONAL" ? "QLP_OPERACIONAL" : "QLP_ADMINISTRATIVO",
      rotuloDaEntidade: "Cargos",
      semImpacto: SEM_IMPACTO_FINANCEIRO,
    }),
  );
}

// ---------------------------------------------------------------------------

describe("os pares consecutivos de uma cobertura", () => {
  const vigencias = [
    "2025-12-16",
    "2026-01-16",
    "2026-06-16",
    "2026-07-16",
    "2026-08-01",
  ].map((effectiveDate) => ({ effectiveDate }));

  it("vai do mais recente ao mais antigo, e nunca pula uma vigência", () => {
    const pares = paresConsecutivos(vigencias, 12);
    expect(pares.map((p) => `${p.base.effectiveDate}->${p.comparada.effectiveDate}`)).toEqual([
      "2026-07-16->2026-08-01",
      "2026-06-16->2026-07-16",
      "2026-01-16->2026-06-16",
      "2025-12-16->2026-01-16",
    ]);
  });

  it("o teto limita o custo de abrir a tela, e corta pelos mais antigos", () => {
    expect(paresConsecutivos(vigencias, 2).map((p) => p.comparada.effectiveDate)).toEqual([
      "2026-08-01",
      "2026-07-16",
    ]);
  });

  it("uma vigência sozinha não forma par nenhum", () => {
    expect(paresConsecutivos([{ effectiveDate: "2026-08-01" }], 12)).toEqual([]);
  });
});

describe("a natureza de cada cartão", () => {
  it("um módulo do registro é sem montante, com a frase e a grandeza dele", () => {
    const natureza = naturezaDoCartao(molde({ modulo: "MANUTENCAO" }));
    expect(natureza?.unidade).toBe("R$/km");
    expect(natureza?.motivo).toMatch(/R\$\/km/);
  });

  it("um módulo que escreveu `semImpacto` é sem montante, sem segunda lista", () => {
    expect(naturezaDoCartao(MOLDE_DE_TMA)?.motivo).toBe(SEM_IMPACTO_DE_TMA);
  });

  it("todo assunto do quadro é sem montante, pela frase do QLP", () => {
    for (const assunto of moldesDoQuadro("OPERACIONAL")) {
      expect(naturezaDoCartao(assunto)?.motivo).toBe(NATUREZA_DO_QLP.motivo);
    }
  });

  it("um módulo financeiro não tem natureza registrada — e é assim que se sabe", () => {
    for (const m of ["FINAME", "IPVA", "ALUGUEL", "IMPOSTOS", "LUCRO_FIXO", "SEGURO"]) {
      expect(naturezaDoCartao(molde({ modulo: m })), m).toBeNull();
    }
  });
});

describe("o cartão de um módulo financeiro", () => {
  it("publica antes, depois, impacto e variação do balde do módulo", () => {
    const cartao = cartaoDoModulo(
      molde({ modulo: "FINAME" }),
      [
        apurado(
          {
            modulo: "FINAME",
            alteracoes: 13,
            entidades: 10,
            porPeriodicidade: { MENSAL: 18663.89 },
            basePorPeriodicidade: { MENSAL: 42756.51 },
          },
          ["2026-07-16", "2026-08-01"],
        ),
      ],
      varredura(),
      null,
    );

    expect(cartao.estado).toBe("COM_MOVIMENTO_FINANCEIRO");
    expect(cartao.baldes).toEqual([
      {
        periodicidade: "MENSAL",
        antes: 42756.51,
        depois: 61420.4,
        impacto: 18663.89,
        variacao: 18663.89 / 42756.51,
      },
    ]);
    expect(cartao.movimento.entidades).toBe(10);
    expect(cartao.motivo).toBeNull();
  });

  it("sem par com dinheiro, diz a varredura em vez de sumir", () => {
    const cartao = cartaoDoModulo(
      molde({ modulo: "ALUGUEL" }),
      [apurado({ modulo: "ALUGUEL" }, ["2026-07-16", "2026-08-01"])],
      varredura({ pares: 8, de: "2025-12-16", ate: "2026-08-01" }),
      null,
    );

    expect(cartao.estado).toBe("SEM_MOVIMENTO_FINANCEIRO");
    expect(cartao.baldes).toEqual([]);
    expect(cartao.varredura).toEqual({
      pares: 8,
      de: "2025-12-16",
      ate: "2026-08-01",
      lacunas: [],
    });
  });

  it("sem cobertura, a frase é a do domínio e não há número nenhum", () => {
    const cartao = cartaoDoModulo(
      molde({ modulo: "IPVA" }),
      [],
      varredura({ pares: 0, de: null, ate: null }),
      "Só uma vigência de equipamento foi importada — comparar exige duas.",
    );

    expect(cartao.estado).toBe("SEM_COBERTURA");
    expect(cartao.par).toBeNull();
    expect(cartao.baldes).toEqual([]);
    expect(cartao.motivo).toMatch(/comparar exige duas/);
  });
});

describe("a aba Custo Variável — nenhum cartão imita o financeiro", () => {
  it("cada rubrica da malha publica movimento e motivo, e nenhum balde", () => {
    const apuracoes = new Map<string, ApuracaoDoPar[]>(
      MOLDES_DE_TRECHO.map((m) => [
        m.modulo,
        [apuracaoDoCartao({ ...m, par: par("2026-07-16", "2026-08-01") }, "cs:trecho")],
      ]),
    );

    for (const m of MOLDES_DE_TRECHO) {
      const cartao = cartaoDoModulo(m, apuracoes.get(m.modulo) ?? [], varredura(), null);
      expect(cartao.estado, m.modulo).toBe("SEM_MONTANTE_APURAVEL");
      expect(cartao.baldes, m.modulo).toEqual([]);
      expect(cartao.motivo, m.modulo).toBeTruthy();
      expect(cartao.movimento.unidade, m.modulo).toBeTruthy();
      expect(cartao.movimento.alteracoes, m.modulo).toBe(m.alteracoes);
    }
  });

  it("o TMA carrega a frase que o módulo dele escreveu", () => {
    const cartao = cartaoDoModulo(
      MOLDE_DE_TMA,
      [apuracaoDoCartao({ ...MOLDE_DE_TMA, par: par("a", "b") }, "cs:trecho")],
      varredura(),
      null,
    );
    expect(cartao.motivo).toBe(SEM_IMPACTO_DE_TMA);
    expect(cartao.movimento.unidade).toBe("minutos");
  });

  it("sem nenhuma vigência de trecho, os seis cartões continuam na tela", () => {
    const ausente = "Nenhuma vigência de trecho foi importada ainda.";
    const cartoes = [...MOLDES_DE_TRECHO, MOLDE_DE_TMA].map((m) =>
      cartaoDoModulo(m, [], varredura({ pares: 0, de: null, ate: null }), ausente),
    );
    expect(cartoes).toHaveLength(5);
    for (const c of cartoes) {
      expect(c.estado).toBe("SEM_COBERTURA");
      expect(c.motivo).toBe(ausente);
    }
  });
});

describe("a aba Equipe — dois cartões, dezesseis assuntos cada", () => {
  /**
   * O caso que a proposta chamou de central: assuntos do **mesmo** quadro que se
   * moveram em vigências diferentes. Nenhum período é eleito para representar os
   * outros — o cabeçalho traz o mais recente e cada linha traz o dela.
   */
  function quadroComPeriodosDistintos(quadro: "OPERACIONAL" | "ADMINISTRATIVO") {
    const moldes = moldesDoQuadro(quadro);
    const apuracoes = new Map<string, ApuracaoDoPar[]>();
    for (const [i, m] of moldes.entries()) {
      /* Três assuntos em agosto, três em junho, e os dez restantes parados. */
      const pontas: [string, string] | null =
        i < 3 ? ["2026-07-16", "2026-08-01"] : i < 6 ? ["2026-06-16", "2026-07-16"] : null;
      apuracoes.set(
        m.modulo,
        pontas
          ? [
              apuracaoDoCartao(
                { ...m, alteracoes: 4 + i, entidades: 2 + i, par: par(...pontas) },
                `cs:${pontas[1]}`,
              ),
            ]
          : [apuracaoDoCartao({ ...m, par: par("2026-07-16", "2026-08-01") }, "cs:x")],
      );
    }
    return { moldes, apuracoes };
  }

  it("os dezesseis assuntos entram, e cada um com o par dele", () => {
    const { moldes, apuracoes } = quadroComPeriodosDistintos("OPERACIONAL");
    const assuntos = assuntosDoQuadro(moldes, apuracoes, null);

    expect(assuntos).toHaveLength(16);
    expect(assuntos[0].par?.comparadaData).toBe("2026-08-01");
    expect(assuntos[4].par?.comparadaData).toBe("2026-07-16");
    /* O assunto parado não some e não mente: ele diz que não se moveu. */
    expect(assuntos[10].estado).toBe("SEM_MOVIMENTO_FINANCEIRO");
    expect(assuntos[10].par).toBeNull();
    for (const a of assuntos) {
      expect(a.motivo).toBe(NATUREZA_DO_QLP.motivo);
      expect(a.movimento.unidade).toBe(NATUREZA_DO_QLP.unidade);
    }
  });

  it("o cabeçalho do quadro traz o par mais recente entre os assuntos", () => {
    const { moldes, apuracoes } = quadroComPeriodosDistintos("ADMINISTRATIVO");
    const cartao = cartaoDoQuadro({
      quadro: "ADMINISTRATIVO",
      rotulo: "Quadro Administrativo",
      rota: "/qlp-administrativo",
      cobertura: "QLP_ADMINISTRATIVO",
      assuntos: assuntosDoQuadro(moldes, apuracoes, null),
      varredura: varredura(),
      ausente: null,
    });

    expect(cartao.par?.comparadaData).toBe("2026-08-01");
    expect(cartao.assuntos).toHaveLength(16);
    expect(cartao.baldes).toEqual([]);
    /* Cargos não se somam entre assuntos: o cabeçalho traz o maior, e a quebra
       está embaixo. Uma soma passaria do tamanho do quadro. */
    const maior = Math.max(...cartao.assuntos!.map((a) => a.movimento.entidades));
    expect(cartao.movimento.entidades).toBe(maior);
  });

  it("a aba conta os períodos distintos olhando os assuntos, não os cabeçalhos", () => {
    const abas = agruparEmAbas(
      (["OPERACIONAL", "ADMINISTRATIVO"] as const).map((quadro) => {
        const { moldes, apuracoes } = quadroComPeriodosDistintos(quadro);
        return cartaoDoQuadro({
          quadro,
          rotulo: quadro,
          rota: `/qlp-${quadro.toLowerCase()}`,
          cobertura: quadro === "OPERACIONAL" ? "QLP_OPERACIONAL" : "QLP_ADMINISTRATIVO",
          assuntos: assuntosDoQuadro(moldes, apuracoes, null),
          varredura: varredura(),
          ausente: null,
        });
      }),
    );

    const equipe = abas.find((a) => a.area === "EQUIPE")!;
    expect(equipe.cartoes).toHaveLength(2);
    /* Os dois cabeçalhos dizem agosto; embaixo há agosto **e** julho. Contar só
       os cabeçalhos diria "1 período" numa aba que compara dois. */
    expect(equipe.periodosDistintos).toBe(2);
    expect(equipe.comparadaMaisRecente).toBe("2026-08-01");
  });

  it("sem quadro no acervo, os dois cartões ficam, com a frase da ausência", () => {
    const ausente = "Nenhuma vigência de quadro operacional foi importada ainda.";
    const cartao = cartaoDoQuadro({
      quadro: "OPERACIONAL",
      rotulo: "Quadro Operacional",
      rota: "/qlp-operacional",
      cobertura: "QLP_OPERACIONAL",
      assuntos: assuntosDoQuadro(moldesDoQuadro("OPERACIONAL"), new Map(), ausente),
      varredura: varredura({ pares: 0, de: null, ate: null }),
      ausente,
    });

    expect(cartao.estado).toBe("SEM_COBERTURA");
    expect(cartao.assuntos).toHaveLength(16);
    expect(cartao.assuntos!.every((a) => a.estado === "SEM_COBERTURA")).toBe(true);
    expect(cartao.motivo).toBe(ausente);
  });
});

describe("as abas", () => {
  /**
   * A prova da premissa da tela: cartões da **mesma** aba comparando períodos
   * diferentes, e a aba dizendo quantos são antes que alguém leia um cartão.
   */
  it("cartões com períodos diferentes convivem, e a aba conta quantos", () => {
    const cartoes = [
      cartaoDoModulo(
        molde({ modulo: "FINAME" }),
        [
          apurado(
            {
              modulo: "FINAME",
              porPeriodicidade: { MENSAL: 18663.89 },
              basePorPeriodicidade: { MENSAL: 42756.51 },
            },
            ["2026-07-16", "2026-08-01"],
          ),
        ],
        varredura(),
        null,
      ),
      cartaoDoModulo(
        molde({ modulo: "IPVA" }),
        [
          apurado(
            {
              modulo: "IPVA",
              porPeriodicidade: { ANUAL: -144874.5 },
              basePorPeriodicidade: { ANUAL: 591325 },
            },
            ["2026-06-16", "2026-07-16"],
          ),
        ],
        varredura(),
        null,
      ),
    ];

    const custoFixo = agruparEmAbas(cartoes).find((a) => a.area === "CUSTO_FIXO")!;
    expect(custoFixo.periodosDistintos).toBe(2);
    expect(custoFixo.comparadaMaisRecente).toBe("2026-08-01");
    /* Recência primeiro: o atrasado fica no fim, que é onde se procura por ele. */
    expect(custoFixo.cartoes.map((c) => c.modulo)).toEqual(["FINAME", "IPVA"]);
  });

  it("periodicidades diferentes convivem sem nenhuma conversão", () => {
    const [aba] = agruparEmAbas([
      cartaoDoModulo(
        molde({ modulo: "IPVA" }),
        [
          apurado(
            {
              modulo: "IPVA",
              porPeriodicidade: { ANUAL: -144874.5, MENSAL: 240 },
              basePorPeriodicidade: { ANUAL: 591325, MENSAL: 1200 },
            },
            ["2026-06-16", "2026-07-16"],
          ),
        ],
        varredura(),
        null,
      ),
    ]);

    const [cartao] = aba.cartoes;
    expect(cartao.baldes.map((b) => b.periodicidade)).toEqual(["ANUAL", "MENSAL"]);
    /* Nenhum balde conhece o outro: somar os dois daria −144.634,50, que não é
       nenhuma grandeza deste produto. */
    expect(cartao.baldes[0].impacto).toBe(-144874.5);
    expect(cartao.baldes[1].impacto).toBe(240);
  });

  it("a ordenação desempata por magnitude dentro do mesmo período", () => {
    const comImpacto = (modulo: string, impacto: number) =>
      cartaoDoModulo(
        molde({ modulo }),
        [
          apurado(
            {
              modulo,
              porPeriodicidade: { MENSAL: impacto },
              basePorPeriodicidade: { MENSAL: 10000 },
            },
            ["2026-07-16", "2026-08-01"],
          ),
        ],
        varredura(),
        null,
      );

    const aba = agruparEmAbas([
      comImpacto("LUCRO_FIXO", 1655.54),
      comImpacto("FINAME", 18663.89),
      /* Negativo grande vem antes de positivo pequeno: o critério é tamanho do
         movimento, e não o sinal dele. */
      comImpacto("SEGURO", -16594.54),
    ])[0];

    expect(aba.cartoes.map((c) => c.modulo)).toEqual(["FINAME", "SEGURO", "LUCRO_FIXO"]);
  });
});

describe("a parada antecipada da varredura", () => {
  it("um módulo financeiro resolve com dinheiro, e não com linhas alteradas", () => {
    const m = molde({ modulo: "FINAME" });
    expect(
      moduloResolvido(m, [apurado({ modulo: "FINAME", alteracoes: 40 }, ["a", "b"])]),
    ).toBe(false);
    expect(
      moduloResolvido(m, [
        apurado({ modulo: "FINAME", porPeriodicidade: { MENSAL: 1 } }, ["a", "b"]),
      ]),
    ).toBe(true);
  });

  it("um módulo sem montante resolve com movimento — procurar dinheiro nunca acabaria", () => {
    const m = molde({ modulo: "MANUTENCAO" });
    expect(moduloResolvido(m, [apurado({ modulo: "MANUTENCAO" }, ["a", "b"])])).toBe(false);
    expect(
      moduloResolvido(m, [apurado({ modulo: "MANUTENCAO", alteracoes: 670 }, ["a", "b"])]),
    ).toBe(true);
  });
});
