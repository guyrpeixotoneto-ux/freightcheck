import { describe, expect, it } from "vitest";
import {
  concentracaoDaPerda,
  insightsDaEvolucao,
  maiorSequenciaNegativa,
  pontuarAtivo,
  prioridadeDoScore,
  tendenciaDoAtivo,
  VIGENCIAS_PARA_PIORA_CONSECUTIVA,
  type AtivoNaEvolucao,
} from "../evolucao-por-placa";

/**
 * As réguas da Evolução por Placa, sem banco.
 *
 * Tudo o que a tela **afirma** sobre uma placa — está piorando, é crítica,
 * concentra a perda — sai destas funções, e não de um `sort` escondido num
 * componente. É por isso que elas são exportadas e testadas aqui: um usuário que
 * discorde da pastilha "Piorando" precisa poder ler a regra, e a regra precisa
 * ser a mesma que o número usou.
 *
 * A reconciliação com a autoridade financeira — soma das células, soma dos
 * acumulados, ganhos e perdas — está em `evolucao-por-placa-real.test.ts`, que
 * roda contra a base real: aqui é a lógica; lá, o dinheiro.
 */

describe("a tendência de um ativo", () => {
  it("piorando: acumulado negativo e as vigências negativas não são minoria", () => {
    expect(
      tendenciaDoAtivo({
        acumulado: -1500,
        vigenciasNegativas: 3,
        vigenciasPositivas: 1,
        alteracoes: 9,
      }),
    ).toBe("PIORANDO");
  });

  it("melhorando: acumulado positivo e as positivas não são minoria", () => {
    expect(
      tendenciaDoAtivo({
        acumulado: 6200,
        vigenciasNegativas: 0,
        vigenciasPositivas: 4,
        alteracoes: 8,
      }),
    ).toBe("MELHORANDO");
  });

  it("um acumulado negativo vindo de uma vigência só entre muitas positivas é estável", () => {
    /*
      Uma queda grande cercada de subidas pequenas: o saldo é negativo, mas o
      movimento não é de piora. Chamá-lo de "Piorando" faria a pastilha
      contradizer a própria linha da matriz, que é onde quem lê confere.
    */
    expect(
      tendenciaDoAtivo({
        acumulado: -80,
        vigenciasNegativas: 1,
        vigenciasPositivas: 3,
        alteracoes: 4,
      }),
    ).toBe("ESTAVEL");
  });

  it("alteração sem preço nenhum não vira estabilidade — vira pendência", () => {
    expect(
      tendenciaDoAtivo({
        acumulado: null,
        vigenciasNegativas: 0,
        vigenciasPositivas: 0,
        alteracoes: 4,
      }),
    ).toBe("SEM_VALORACAO");
  });

  it("sem alteração nenhuma e sem preço, é estável — e não pendente", () => {
    expect(
      tendenciaDoAtivo({
        acumulado: null,
        vigenciasNegativas: 0,
        vigenciasPositivas: 0,
        alteracoes: 0,
      }),
    ).toBe("ESTAVEL");
  });
});

describe("a piora consecutiva", () => {
  const celulas = (...nets: (number | null)[]) => nets.map((net) => ({ net }));

  it("conta a maior sequência de vigências seguidas no vermelho", () => {
    expect(maiorSequenciaNegativa(celulas(-1, -2, 3, -4, -5, -6))).toBe(3);
  });

  it("uma vigência sem alteração no meio interrompe a sequência", () => {
    /*
      É o motivo de a leitura montar a sequência sobre as **colunas** do
      intervalo, e não sobre as células que existem: sem isso, "duas vigências
      seguidas" descreveria janeiro e agosto.
    */
    expect(maiorSequenciaNegativa(celulas(-1, null, -2))).toBe(1);
  });

  it("uma vigência valorada em zero também interrompe: zero não é piora", () => {
    expect(maiorSequenciaNegativa(celulas(-1, 0, -2))).toBe(1);
  });

  it("sem nenhuma vigência negativa, a sequência é zero", () => {
    expect(maiorSequenciaNegativa(celulas(1, 2, null))).toBe(0);
  });
});

describe("o score de atenção", () => {
  const escala = {
    maiorPerda: 20_000,
    maiorPendencia: 10,
    colunas: 5,
    ultimaColuna: "2026-08-02",
  };

  it("a placa mais afetada do recorte leva os 50 pontos de impacto", () => {
    const { score, motivos } = pontuarAtivo(
      {
        acumulado: -20_000,
        vigenciasNegativas: 0,
        pioraConsecutiva: 0,
        semValoracao: 0,
        ultimaVigencia: null,
      },
      escala,
    );
    expect(score).toBe(50);
    expect(motivos.map((m) => m.chave)).toEqual(["IMPACTO"]);
  });

  it("ganho não pontua — o ranking é de atenção, não de tamanho", () => {
    const { score } = pontuarAtivo(
      {
        acumulado: 90_000,
        vigenciasNegativas: 0,
        pioraConsecutiva: 0,
        semValoracao: 0,
        ultimaVigencia: null,
      },
      escala,
    );
    expect(score).toBe(0);
  });

  it("uma placa só de pendência entra no ranking pela pendência", () => {
    const { score, motivos } = pontuarAtivo(
      {
        acumulado: null,
        vigenciasNegativas: 0,
        pioraConsecutiva: 0,
        semValoracao: 10,
        ultimaVigencia: "2026-08-02",
      },
      escala,
    );
    expect(score).toBe(15);
    expect(motivos.map((m) => m.chave)).toEqual(["PENDENCIA", "RECENCIA"]);
  });

  it("o score é a soma das parcelas que ele devolve — nada de peso escondido", () => {
    const { score, motivos } = pontuarAtivo(
      {
        acumulado: -10_000,
        vigenciasNegativas: 4,
        pioraConsecutiva: 3,
        semValoracao: 5,
        ultimaVigencia: "2026-08-02",
      },
      escala,
    );
    const somaDosMotivos = motivos.reduce((soma, m) => soma + m.pontos, 0);
    expect(Number(somaDosMotivos.toFixed(2))).toBe(score);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("é determinístico: as mesmas entradas dão o mesmo número", () => {
    const entrada = {
      acumulado: -3_200,
      vigenciasNegativas: 2,
      pioraConsecutiva: 2,
      semValoracao: 1,
      ultimaVigencia: "2026-07-02",
    };
    expect(pontuarAtivo(entrada, escala).score).toBe(
      pontuarAtivo(entrada, escala).score,
    );
  });

  it("um recorte sem perda nenhuma não divide por zero", () => {
    const { score } = pontuarAtivo(
      {
        acumulado: 100,
        vigenciasNegativas: 0,
        pioraConsecutiva: 0,
        semValoracao: 0,
        ultimaVigencia: null,
      },
      { maiorPerda: 0, maiorPendencia: 0, colunas: 0, ultimaColuna: null },
    );
    expect(score).toBe(0);
  });

  it("a faixa é um rótulo do score, e o ganho sem score é POSITIVO", () => {
    expect(prioridadeDoScore(74, -1)).toBe("CRITICA");
    expect(prioridadeDoScore(40, -1)).toBe("MONITORAR");
    expect(prioridadeDoScore(5, -1)).toBe("ATENCAO");
    expect(prioridadeDoScore(0, 6_200)).toBe("POSITIVO");
    expect(prioridadeDoScore(0, null)).toBe("NEUTRA");
  });
});

describe("a concentração da perda", () => {
  it("nomeia as placas que explicam 80% da perda, da maior para a menor", () => {
    const { entityIds, percentual } = concentracaoDaPerda([
      { entityId: "a", perda: -80 },
      { entityId: "b", perda: -15 },
      { entityId: "c", perda: -5 },
      { entityId: "d", perda: 0 },
    ]);
    expect(entityIds).toEqual(["a"]);
    expect(percentual).toBe(80);
  });

  it("ganho não entra na conta da perda", () => {
    const { entityIds } = concentracaoDaPerda([
      { entityId: "a", perda: -100 },
      { entityId: "b", perda: 0 },
    ]);
    expect(entityIds).toEqual(["a"]);
  });

  it("sem perda nenhuma, não há concentração a anunciar", () => {
    expect(concentracaoDaPerda([{ entityId: "a", perda: 0 }])).toEqual({
      entityIds: [],
      percentual: 0,
    });
  });
});

describe("os insights de atenção", () => {
  const ativo = (over: Partial<AtivoNaEvolucao>): AtivoNaEvolucao => ({
    entityId: "e1",
    plate: "AAA1A11",
    rotulo: "AAA1A11",
    entityType: "CAVALO",
    placasAnteriores: [],
    celulas: [],
    acumulado: null,
    ganho: 0,
    perda: 0,
    alteracoes: 0,
    semValoracao: 0,
    foraDoTotal: 0,
    outraPeriodicidade: 0,
    vigenciasAfetadas: 0,
    vigenciasNegativas: 0,
    vigenciasPositivas: 0,
    pioraConsecutiva: 0,
    rubricasRecorrentes: 0,
    ultimaVigencia: null,
    tendencia: "ESTAVEL",
    score: 0,
    prioridade: "NEUTRA",
    motivos: [],
    rubricas: [],
    ...over,
  });

  it("cada insight carrega as placas que ele conta — é o que o clique filtra", () => {
    const insights = insightsDaEvolucao(
      [
        ativo({ entityId: "a", pioraConsecutiva: VIGENCIAS_PARA_PIORA_CONSECUTIVA, perda: -900 }),
        ativo({ entityId: "b", pioraConsecutiva: 1, semValoracao: 3 }),
        ativo({ entityId: "c", rubricasRecorrentes: 2 }),
      ],
      "MENSAL",
    );
    for (const insight of insights) {
      expect(insight.entityIds).toHaveLength(insight.placas);
      expect(insight.placas).toBeGreaterThan(0);
    }
    expect(insights.find((i) => i.chave === "PIORA_CONSECUTIVA")?.entityIds).toEqual(["a"]);
    expect(insights.find((i) => i.chave === "SEM_VALORACAO")?.entityIds).toEqual(["b"]);
    expect(insights.find((i) => i.chave === "RUBRICA_REPETIDA")?.entityIds).toEqual(["c"]);
  });

  it("um recorte calmo não inventa insight nenhum", () => {
    expect(insightsDaEvolucao([ativo({ acumulado: 0 })], "MENSAL")).toEqual([]);
  });
});
