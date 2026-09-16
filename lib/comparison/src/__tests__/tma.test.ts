import { describe, expect, it } from "vitest";
import {
  celulasDoCsvDeTma,
  celulasDoCsvDeTrecho,
  CODIGOS_LIDOS_DO_TMA,
  evolucaoDosLocais,
  evolucaoDosTrechos,
  locaisDoTma,
  resumoPorVigencia,
  trechosDoTma,
  variaveisAlteradasDeTma,
  type ValorDeTma,
} from "../tma";

/**
 * O que estes testes prendem.
 *
 * O módulo não compara nada pelo motor — o motor pareia entidades, e um local
 * não é uma entidade do acervo. O que ele faz é **virar a tabela de trechos do
 * avesso** e conferir o que só aparece nesse grão, mais a leitura própria do
 * grão de trecho:
 *
 * 1. o mesmo local declarado com tempos diferentes conforme o trecho;
 * 2. as duas portas separadas — carregar não é descarregar;
 * 3. o tempo de porta do ciclo, que é a soma das duas, e só no grão de trecho;
 * 4. a folga entre o tempo pago e o praticado.
 *
 * Mais a regra que atravessa o produto: **ausência não vira zero**. Um trecho
 * sem TMA declarado não é uma espera de zero minuto, e um trecho sem nome de
 * local não pertence a local nenhum.
 */

const trecho = (over: Partial<ValorDeTma> = {}): ValorDeTma => ({
  ponta: "BASE",
  entityLabel: "CAMACARIFEIRADESANTANA",
  origem: "CAMAÇARI",
  destino: "FEIRA DE SANTANA",
  tmaOrigem: 90,
  tmaDestino: 120,
  tmaOrigemLucro: 90,
  tmaDestinoLucro: 120,
  ciclo: 700,
  ...over,
});

describe("a leitura", () => {
  it("pede só os códigos de trecho de que precisa, sem repetição", () => {
    expect(CODIGOS_LIDOS_DO_TMA.every((c) => c.startsWith("trecho."))).toBe(true);
    expect(new Set(CODIGOS_LIDOS_DO_TMA).size).toBe(CODIGOS_LIDOS_DO_TMA.length);
  });
});

describe("o grão do local", () => {
  it("junta os trechos que passam pela mesma porta do mesmo local", () => {
    const locais = locaisDoTma([
      trecho(),
      trecho({ entityLabel: "T2", destino: "ALAGOINHAS", tmaOrigem: 90 }),
    ]);
    const camacari = locais.find((l) => l.local === "CAMAÇARI" && l.porta === "ORIGEM")!;
    expect(camacari.trechos).toBe(2);
    expect(camacari.medio).toBe(90);
    expect(camacari.veredito).toBe("TMA_UNICO");
  });

  it("acusa o mesmo local declarado com tempos diferentes — o achado deste grão", () => {
    const locais = locaisDoTma([
      trecho(),
      trecho({ entityLabel: "T2", destino: "ALAGOINHAS", tmaOrigem: 150 }),
    ]);
    const camacari = locais.find((l) => l.local === "CAMAÇARI" && l.porta === "ORIGEM")!;
    expect(camacari.minimo).toBe(90);
    expect(camacari.maximo).toBe(150);
    expect(camacari.amplitude).toBe(60);
    expect(camacari.veredito).toBe("VARIA_POR_TRECHO");
  });

  it("perdoa o arredondamento de um minuto", () => {
    const locais = locaisDoTma([
      trecho(),
      trecho({ entityLabel: "T2", destino: "ALAGOINHAS", tmaOrigem: 90.5 }),
    ]);
    expect(locais.find((l) => l.local === "CAMAÇARI")!.veredito).toBe("TMA_UNICO");
  });

  it("não afirma concordância sobre um trecho só", () => {
    const locais = locaisDoTma([trecho()]);
    expect(locais.every((l) => l.veredito === "UM_TRECHO_SO")).toBe(true);
  });

  it("guarda as duas portas do mesmo lugar separadas — carregar não é descarregar", () => {
    /*
      Feira de Santana é destino de um trecho e origem de outro. São duas
      operações diferentes no mesmo endereço, e juntá-las daria a média de algo
      que não acontece.
    */
    const locais = locaisDoTma([
      trecho(),
      trecho({
        entityLabel: "T2",
        origem: "FEIRA DE SANTANA",
        destino: "CAMAÇARI",
        tmaOrigem: 45,
        tmaDestino: 200,
      }),
    ]);
    const comoOrigem = locais.find(
      (l) => l.local === "FEIRA DE SANTANA" && l.porta === "ORIGEM",
    )!;
    const comoDestino = locais.find(
      (l) => l.local === "FEIRA DE SANTANA" && l.porta === "DESTINO",
    )!;
    expect(comoOrigem.medio).toBe(45);
    expect(comoDestino.medio).toBe(120);
  });

  it("não lê ausência como zero — o trecho sem TMA não entra na média", () => {
    const locais = locaisDoTma([
      trecho(),
      trecho({ entityLabel: "T2", destino: "ALAGOINHAS", tmaOrigem: null }),
    ]);
    const camacari = locais.find((l) => l.local === "CAMAÇARI" && l.porta === "ORIGEM")!;
    expect(camacari.trechos).toBe(1);
    expect(camacari.medio).toBe(90);
  });

  it("não inventa um local para o trecho sem nome de ponta", () => {
    const locais = locaisDoTma([trecho({ origem: null }), trecho({ entityLabel: "T2", origem: "  " })]);
    expect(locais.some((l) => l.porta === "ORIGEM")).toBe(false);
  });

  it("mede a folga entre o pago e o praticado, com sinal", () => {
    const locais = locaisDoTma([trecho({ tmaOrigemLucro: 120 })]);
    const camacari = locais.find((l) => l.local === "CAMAÇARI" && l.porta === "ORIGEM")!;
    expect(camacari.pagoMedio).toBe(120);
    expect(camacari.folgaMedia).toBe(30);
    expect(camacari.trechosComFolga).toBe(1);
  });

  it("mede o peso da porta no ciclo", () => {
    const locais = locaisDoTma([trecho({ ciclo: 900, tmaOrigem: 90 })]);
    expect(locais.find((l) => l.porta === "ORIGEM")!.pesoNoCiclo).toBeCloseTo(0.1, 4);
  });

  it("recusa o peso quando o ciclo não veio, em vez de dividir por zero", () => {
    const locais = locaisDoTma([trecho({ ciclo: null }), trecho({ entityLabel: "T2", ciclo: 0 })]);
    expect(locais.every((l) => l.pesoNoCiclo === null)).toBe(true);
  });
});

describe("o resumo da vigência", () => {
  it("nunca junta o TMA de carregar com o de descarregar", () => {
    const [resumo] = resumoPorVigencia(locaisDoTma([trecho()]));
    expect(resumo.medioNaOrigem).toBe(90);
    expect(resumo.medioNoDestino).toBe(120);
  });

  it("aponta onde o tempo varia mais, e não só quanto", () => {
    const [resumo] = resumoPorVigencia(
      locaisDoTma([
        trecho(),
        trecho({ entityLabel: "T2", destino: "ALAGOINHAS", tmaOrigem: 150 }),
      ]),
    );
    expect(resumo.maiorAmplitude).toBe(60);
    expect(resumo.ondeVariaMais).toEqual({ local: "CAMAÇARI", porta: "ORIGEM" });
  });

  it("conta locais distintos, e não portas", () => {
    /* Camaçari é origem de um e destino de outro: duas portas, um local. */
    const [resumo] = resumoPorVigencia(
      locaisDoTma([
        trecho(),
        trecho({ entityLabel: "T2", origem: "FEIRA DE SANTANA", destino: "CAMAÇARI" }),
      ]),
    );
    expect(resumo.locais).toBe(2);
    expect(resumo.portas).toBe(4);
  });
});

describe("o grão do trecho", () => {
  it("soma as duas portas — a única soma que esta tela faz entre elas", () => {
    const [t] = trechosDoTma([trecho()]);
    expect(t.tempoDePorta).toBe(210);
    expect(t.pagoDePorta).toBe(210);
    expect(t.veredito).toBe("IGUAL");
  });

  it("não soma meia porta — sem as duas, não há tempo de porta", () => {
    const [t] = trechosDoTma([trecho({ tmaDestino: null })]);
    expect(t.tempoDePorta).toBeNull();
    expect(t.pesoNoCiclo).toBeNull();
    expect(t.veredito).toBe("SEM_COMPARACAO");
  });

  it("mede a folga do trecho e diz de que lado ela cai", () => {
    const [mais] = trechosDoTma([trecho({ tmaOrigemLucro: 120 })]);
    expect(mais.folga).toBe(30);
    expect(mais.veredito).toBe("PAGA_MAIS");

    const [menos] = trechosDoTma([trecho({ tmaDestinoLucro: 60 })]);
    expect(menos.folga).toBe(-60);
    expect(menos.veredito).toBe("PAGA_MENOS");
  });

  it("mede o peso do tempo de porta no ciclo", () => {
    const [t] = trechosDoTma([trecho({ ciclo: 700 })]);
    expect(t.pesoNoCiclo).toBeCloseTo(0.3, 3);
  });

  it("ordena pelo peso, que é a fila de quem tem espera demais", () => {
    const ordenados = trechosDoTma([
      trecho({ entityLabel: "LEVE", tmaOrigem: 30, tmaDestino: 30, ciclo: 900 }),
      trecho({ entityLabel: "PESADO", tmaOrigem: 200, tmaDestino: 200, ciclo: 900 }),
    ]);
    expect(ordenados[0].entityLabel).toBe("PESADO");
  });
});

describe("as duas pontas lado a lado", () => {
  it("põe o mesmo local nas duas vigências, com a diferença", () => {
    const locais = locaisDoTma([
      trecho(),
      trecho({ ponta: "COMPARADA", tmaOrigem: 110 }),
    ]);
    const evolucao = evolucaoDosLocais(locais).find(
      (e) => e.local === "CAMAÇARI" && e.porta === "ORIGEM",
    )!;
    expect(evolucao.base).toBe(90);
    expect(evolucao.comparada).toBe(110);
    expect(evolucao.diferenca).toBe(20);
  });

  it("deixa em nulo o local que só existe numa das pontas, e não em zero", () => {
    const locais = locaisDoTma([trecho({ ponta: "COMPARADA", origem: "NOVA ORIGEM" })]);
    const evolucao = evolucaoDosLocais(locais).find((e) => e.local === "NOVA ORIGEM")!;
    expect(evolucao.base).toBeNull();
    expect(evolucao.diferenca).toBeNull();
  });

  it("põe o tempo de porta de cada trecho nas duas pontas", () => {
    const evolucao = evolucaoDosTrechos(
      trechosDoTma([trecho(), trecho({ ponta: "COMPARADA", tmaDestino: 180 })]),
    );
    expect(evolucao[0].base).toBe(210);
    expect(evolucao[0].comparada).toBe(270);
    expect(evolucao[0].diferenca).toBe(60);
  });
});

describe("os CSVs", () => {
  it("escreve o local em minutos, com a porta dita por extenso", () => {
    const [local] = locaisDoTma([trecho()]);
    const celulas = celulasDoCsvDeTma(local);
    expect(celulas).toHaveLength(12);
    expect(String(celulas[1])).toContain("origem");
    /* Minutos, e não "1h 30min": a planilha soma número. */
    expect(celulas[5]).toBe(90);
  });

  it("escreve o trecho com as duas portas e o peso em pontos percentuais", () => {
    const [t] = trechosDoTma([trecho({ ciclo: 700 })]);
    const celulas = celulasDoCsvDeTrecho(t);
    expect(celulas).toHaveLength(12);
    expect(celulas[6]).toBe(210);
    expect(celulas[10]).toBeCloseTo(30, 1);
  });

  it("deixa em nulo o que não existe, em vez de escrever zero", () => {
    const [t] = trechosDoTma([trecho({ tmaDestino: null })]);
    const celulas = celulasDoCsvDeTrecho(t);
    expect(celulas[6]).toBeNull();
    expect(celulas[10]).toBeNull();
  });
});

/**
 * A contagem que a linha do menu do seletor escreve.
 *
 * Ela é do grão do change set — a coluna de um trecho —, e por isso mora ao lado
 * da leitura agregada em vez de sair dela: o menu responde *vale a pena abrir
 * este par?* antes de qualquer agregação por local existir.
 */
describe("o que se moveu nas colunas de porta", () => {
  const alteracao = (over: Record<string, unknown> = {}) => ({
    changeType: "VALUE_CHANGED",
    attributeCode: "trecho.tempo_interno_origem",
    entityLabel: "CAMAÇARI → FEIRA",
    entityType: "TRECHO",
    valueBefore: "90",
    valueAfter: "120",
    deltaAbsolute: 30,
    deltaPercent: null,
    comparability: "COMPARABLE",
    ...over,
  }) as Parameters<typeof variaveisAlteradasDeTma>[0][number];

  it("conta uma por coluna movida", () => {
    expect(
      variaveisAlteradasDeTma([
        alteracao(),
        alteracao({ attributeCode: "trecho.tempo_interno_destino" }),
      ]),
    ).toBe(2);
  });

  it("ignora coluna que não é de porta", () => {
    expect(variaveisAlteradasDeTma([alteracao({ attributeCode: "trecho.km" })])).toBe(0);
  });

  /*
    Entidade que entrou ou saiu é outra notícia, e incomparável é a ausência da
    notícia: nem uma nem outra é "coluna que se moveu". A mesma régua das outras
    rubricas — só `ALTERADO` conta.
  */
  it("não conta o trecho que entrou nem o valor incomparável", () => {
    expect(
      variaveisAlteradasDeTma([
        alteracao({ changeType: "ENTITY_ADDED" }),
        alteracao({ comparability: "INCONCLUSIVE", nature: "APPEARED" }),
      ]),
    ).toBe(0);
  });

  it("os códigos contados são os que a tela lê", () => {
    for (const code of CODIGOS_LIDOS_DO_TMA) {
      expect(variaveisAlteradasDeTma([alteracao({ attributeCode: code })])).toBe(1);
    }
  });
});
