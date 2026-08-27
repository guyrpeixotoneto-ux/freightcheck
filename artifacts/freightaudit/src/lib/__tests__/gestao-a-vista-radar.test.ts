import { describe, expect, it } from "vitest";
import {
  atributosDaCelula,
  chaveDaLeitura,
  intensidadeDaCelula,
  janelaDoRadar,
  maiorImpactoDaGrade,
  montarRadar,
  periodicidadesDoRadar,
  resumoDoRadar,
  type EntradaDaCelula,
  type UnidadeDoRadar,
} from "../gestao-a-vista-radar";


/** Um `/changes/range` com só o que o Radar lê: movimentos e lacunas. */
function movimentos(
  linhas: {
    period: string;
    changes: number;
    impact?: Record<string, number>;
    notCalculable?: number;
  }[],
  lacunas: string[] = [],
): Movimentos {
  return {
    movements: linhas.map((l) => ({
      period: l.period,
      label: l.period,
      comparisons: 1,
      changes: l.changes,
      vehicles: l.changes,
      impact: { byPeriodicity: l.impact ?? {}, notCalculable: l.notCalculable ?? 0 },
    })),
    gaps: lacunas.map((period) => ({ period, label: period, reason: "sem comparação" })),
  } as unknown as Movimentos;
}

function unidade(
  nome: string,
  ...leituras: (Movimentos | null)[]
): UnidadeDoRadar {
  return {
    unidade: nome,
    label: nome,
    contextos: leituras.map((_, i) => ({ scopeHash: `${nome}-${i}`, canal: null })),
    movimentos: leituras,
    estado: "pronta",
    tentativas: 0,
  };
}

/** Uma unidade cuja leitura ainda está em voo — `movimentos` sem valor nenhum. */
function pendente(nome: string, contextos = 1): UnidadeDoRadar {
  return {
    unidade: nome,
    label: nome,
    contextos: Array.from({ length: contextos }, (_, i) => ({ scopeHash: `${nome}-${i}`, canal: null })),
    movimentos: Array.from({ length: contextos }, () => undefined),
    estado: "pendente",
    tentativas: 0,
  };
}

/** Uma unidade cuja leitura falhou — não vai chegar sozinha. */
function comErro(nome: string, contextos = 1): UnidadeDoRadar {
  return { ...pendente(nome, contextos), estado: "erro" };
}

describe("janelaDoRadar", () => {
  const serie = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"];

  it("pede o intervalo a partir da vigência anterior à primeira coluna", () => {
    // `/changes/range` conta as transições que vão de `from` até `to`: sem a
    // vigência anterior no `from`, a primeira coluna nasceria vazia.
    expect(janelaDoRadar(serie, "2026-05", 3)).toEqual({
      from: "2026-02",
      to: "2026-05",
      periodos: ["2026-03", "2026-04", "2026-05"],
    });
  });

  it("com o histórico inteiro dentro da janela, parte da primeira vigência", () => {
    expect(janelaDoRadar(serie, "2026-05", 9)).toEqual({
      from: "2026-01",
      to: "2026-05",
      periodos: serie,
    });
  });

  it("respeita a vigência escolhida como fim da janela", () => {
    expect(janelaDoRadar(serie, "2026-03", 2)).toEqual({
      from: "2026-01",
      to: "2026-03",
      periodos: ["2026-02", "2026-03"],
    });
  });

  it("sem vigência nenhuma, não há janela a pedir", () => {
    expect(janelaDoRadar([], null)).toEqual({ from: null, to: null, periodos: [] });
  });
});

describe("periodicidadesDoRadar", () => {
  it("ordena pelo módulo do total, não pelo sinal", () => {
    const unidades = [
      unidade("A", movimentos([{ period: "2026-02", changes: 2, impact: { MENSAL: 500 } }])),
      unidade("B", movimentos([{ period: "2026-02", changes: 3, impact: { ANUAL: -9000 } }])),
    ];
    expect(periodicidadesDoRadar(unidades)).toEqual(["ANUAL", "MENSAL"]);
  });

  it("sem impacto apurado, não há periodicidade a oferecer", () => {
    expect(periodicidadesDoRadar([unidade("A", movimentos([{ period: "2026-02", changes: 4 }]))])).toEqual(
      [],
    );
  });
});

describe("montarRadar", () => {
  const periodos = ["2026-01", "2026-02", "2026-03"];

  it("distingue sem vigência, sem comparação e apurado com zero", () => {
    const linhas = montarRadar(
      periodos,
      [unidade("A", movimentos([{ period: "2026-03", changes: 0 }], ["2026-02"]))],
      "MENSAL",
    );
    expect(linhas[0].celulas.map((c) => c.estado)).toEqual([
      "sem-vigencia",
      "sem-comparacao",
      "apurado",
    ]);
    expect(linhas[0].celulas[2].alteracoes).toBe(0);
  });

  it("só lê a periodicidade escolhida — R$/mês nunca vira R$/ano", () => {
    const linhas = montarRadar(
      periodos,
      [
        unidade(
          "A",
          movimentos([{ period: "2026-03", changes: 2, impact: { MENSAL: -1200, ANUAL: -30000 } }]),
        ),
      ],
      "MENSAL",
    );
    expect(linhas[0].celulas[2].impacto).toBe(-1200);
    expect(linhas[0].totalDeImpacto).toBe(-1200);
  });

  it("soma os contextos da mesma unidade numa linha só", () => {
    const linhas = montarRadar(
      periodos,
      [
        unidade(
          "A",
          movimentos([{ period: "2026-03", changes: 2, impact: { MENSAL: -1000 }, notCalculable: 1 }]),
          movimentos([{ period: "2026-03", changes: 3, impact: { MENSAL: -500 }, notCalculable: 2 }]),
        ),
      ],
      "MENSAL",
    );
    expect(linhas[0].celulas[2]).toMatchObject({
      alteracoes: 5,
      impacto: -1500,
      semApuracao: 3,
    });
  });

  it("um contexto que respondeu vazio é 'sem vigência' — respondeu, e não havia nada", () => {
    const linhas = montarRadar(periodos, [unidade("A", null)], "MENSAL");
    expect(linhas[0].celulas.every((c) => c.estado === "sem-vigencia")).toBe(true);
    expect(linhas[0].totalDeAlteracoes).toBe(0);
    expect(linhas[0].estado).toBe("pronta");
  });

  it("ordena por módulo de impacto, e o volume desempata", () => {
    const linhas = montarRadar(
      periodos,
      [
        unidade("CALMA", movimentos([{ period: "2026-02", changes: 9, impact: { MENSAL: 0 } }])),
        unidade("PESADA", movimentos([{ period: "2026-02", changes: 1, impact: { MENSAL: -8000 } }])),
        unidade("MEDIA", movimentos([{ period: "2026-02", changes: 2, impact: { MENSAL: 300 } }])),
      ],
      "MENSAL",
    );
    expect(linhas.map((l) => l.label)).toEqual(["PESADA", "MEDIA", "CALMA"]);
  });

  it("unidade sem nenhuma vigência na janela continua na grade", () => {
    const linhas = montarRadar(periodos, [unidade("A", movimentos([]))], "MENSAL");
    expect(linhas).toHaveLength(1);
    expect(linhas[0].totalDeAlteracoes).toBe(0);
  });
});

/*
  O desenho progressivo — o que estes testes protegem.

  O Radar passou a desenhar antes de ter todas as unidades. A troca compra
  tempo de tela e traz dois riscos que não existiam enquanto a grade era
  tudo-ou-nada: uma leitura que não chegou pode ser desenhada como zero
  apurado, e um consolidado de três unidades pode ser lido como o consolidado
  das cinco. Os dois estão cobertos aqui, e a equivalência final também.
*/
describe("montarRadar com unidades ainda carregando", () => {
  const periodos = ["2026-01", "2026-02", "2026-03"];

  it("unidade pendente não vira zero apurado — nem 'sem vigência'", () => {
    const linhas = montarRadar(periodos, [pendente("A")], "MENSAL");
    expect(linhas[0].estado).toBe("pendente");
    expect(linhas[0].celulas.map((c) => c.estado)).toEqual(["pendente", "pendente", "pendente"]);
    // "sem-vigencia" é uma afirmação sobre o que a unidade entregou. Sobre uma
    // leitura que não chegou não se afirma nada.
    expect(linhas[0].celulas.some((c) => c.estado === "sem-vigencia")).toBe(false);
  });

  it("unidade com erro é distinguível de unidade pendente", () => {
    const linhas = montarRadar(periodos, [comErro("A")], "MENSAL");
    expect(linhas[0].estado).toBe("erro");
    expect(linhas[0].celulas.every((c) => c.estado === "erro")).toBe(true);
  });

  it("uma unidade lenta não apaga as que já responderam", () => {
    const linhas = montarRadar(
      periodos,
      [
        unidade("PRONTA", movimentos([{ period: "2026-02", changes: 4, impact: { MENSAL: -900 } }])),
        pendente("LENTA"),
      ],
      "MENSAL",
    );
    // A ordem enquanto falta unidade é de nome (ver o teste do pódio); o que
    // este exercita é que a linha pronta continua desenhando o número dela.
    expect(linhas.map((l) => l.label).sort()).toEqual(["LENTA", "PRONTA"]);
    expect(linhas.find((l) => l.label === "PRONTA")?.totalDeImpacto).toBe(-900);
    expect(linhas.find((l) => l.label === "LENTA")?.estado).toBe("pendente");
  });

  it("uma unidade com erro não apaga as que responderam", () => {
    const linhas = montarRadar(
      periodos,
      [comErro("CAIU"), unidade("PRONTA", movimentos([{ period: "2026-02", changes: 4 }]))],
      "MENSAL",
    );
    expect(linhas.map((l) => l.label).sort()).toEqual(["CAIU", "PRONTA"]);
    expect(linhas.find((l) => l.label === "PRONTA")?.totalDeAlteracoes).toBe(4);
    expect(linhas.find((l) => l.label === "CAIU")?.estado).toBe("erro");
  });

  it("enquanto falta unidade, a grade fica em ordem de nome — não há pódio a mostrar", () => {
    // Ordenar por impacto aqui ranquearia por quem respondeu primeiro e
    // apresentaria esse acaso com a autoridade da ordem final.
    const linhas = montarRadar(
      periodos,
      [
        pendente("Z-LENTA"),
        unidade("LEVE", movimentos([{ period: "2026-02", changes: 1, impact: { MENSAL: 10 } }])),
        pendente("A-LENTA"),
        unidade("PESADA", movimentos([{ period: "2026-02", changes: 1, impact: { MENSAL: -8000 } }])),
      ],
      "MENSAL",
    );
    expect(linhas.map((l) => l.label)).toEqual(["A-LENTA", "LEVE", "PESADA", "Z-LENTA"]);
  });

  it("assim que a última chega, o pódio aparece — e é o de sempre", () => {
    const todas = [
      unidade("LEVE", movimentos([{ period: "2026-02", changes: 1, impact: { MENSAL: 10 } }])),
      unidade("PESADA", movimentos([{ period: "2026-02", changes: 1, impact: { MENSAL: -8000 } }])),
      unidade("MEDIA", movimentos([{ period: "2026-02", changes: 1, impact: { MENSAL: 300 } }])),
    ];
    expect(montarRadar(periodos, todas, "MENSAL").map((l) => l.label)).toEqual([
      "PESADA",
      "MEDIA",
      "LEVE",
    ]);
    // Uma única pendente basta para não haver pódio: o ranking seria de quem
    // respondeu, não de quem pesa.
    expect(
      montarRadar(periodos, [...todas, pendente("ZZ")], "MENSAL").map((l) => l.label),
    ).toEqual(["LEVE", "MEDIA", "PESADA", "ZZ"]);
  });

  it("com todas prontas, a grade é exatamente a de antes do progressivo", () => {
    // A prova de equivalência: o mesmo conjunto, montado de uma vez, tem de
    // sair idêntico ao que sai depois de todas as pendentes virarem prontas —
    // mesma ordem, mesmas células, mesmos totais.
    const prontas = [
      unidade("CALMA", movimentos([{ period: "2026-02", changes: 9, impact: { MENSAL: 0 } }])),
      unidade("PESADA", movimentos([{ period: "2026-02", changes: 1, impact: { MENSAL: -8000 } }])),
      unidade("MEDIA", movimentos([{ period: "2026-02", changes: 2, impact: { MENSAL: 300 } }])),
    ];
    const deUmaVez = montarRadar(periodos, prontas, "MENSAL");
    const depoisDeChegarem = montarRadar(periodos, [...prontas].reverse(), "MENSAL");

    expect(depoisDeChegarem).toEqual(deUmaVez);
    expect(deUmaVez.every((l) => l.estado === "pronta")).toBe(true);
    expect(deUmaVez.flatMap((l) => l.celulas).some((c) => c.estado === "pendente")).toBe(false);
  });
});

describe("chaveDaLeitura", () => {
  const intervalo = new URLSearchParams({ from: "2026-01", to: "2026-03" });

  it("é a mesma para o mesmo contexto — é o que casa a resposta com a linha", () => {
    const contexto = { scopeHash: "abc", canal: "EMPURRADA" };
    expect(chaveDaLeitura(intervalo, contexto)).toBe(chaveDaLeitura(intervalo, { ...contexto }));
  });

  it("separa contextos diferentes, inclusive só pelo canal", () => {
    expect(chaveDaLeitura(intervalo, { scopeHash: "abc", canal: "EMPURRADA" })).not.toBe(
      chaveDaLeitura(intervalo, { scopeHash: "abc", canal: "PUXADA" }),
    );
    expect(chaveDaLeitura(intervalo, { scopeHash: "abc", canal: null })).not.toBe(
      chaveDaLeitura(intervalo, { scopeHash: "def", canal: null })
    );
  });

  it("canal nulo não vira o texto 'null' na query", () => {
    expect(chaveDaLeitura(intervalo, { scopeHash: "abc", canal: null })).not.toContain("null");
  });

  it("não altera o intervalo que recebeu", () => {
    // O mesmo objeto é usado para montar N chaves; mutá-lo faria a segunda
    // leitura herdar o scopeHash da primeira.
    const antes = intervalo.toString();
    chaveDaLeitura(intervalo, { scopeHash: "abc", canal: "EMPURRADA" });
    chaveDaLeitura(intervalo, { scopeHash: "def", canal: "PUXADA" });
    expect(intervalo.toString()).toBe(antes);
  });

  it("a chave da janela A não colide com a da janela B", () => {
    const outra = new URLSearchParams({ from: "2025-06", to: "2026-03" });
    expect(chaveDaLeitura(intervalo, { scopeHash: "abc", canal: null })).not.toBe(
      chaveDaLeitura(outra, { scopeHash: "abc", canal: null }),
    );
  });
});

describe("resumoDoRadar durante o carregamento", () => {
  const periodos = ["2026-01", "2026-02", "2026-03"];
  const umaPronta = (nome: string, impacto: number, alteracoes: number) =>
    unidade(nome, movimentos([{ period: "2026-02", changes: alteracoes, impact: { MENSAL: impacto } }]));

  it("marca o consolidado como parcial enquanto faltar unidade", () => {
    const linhas = montarRadar(periodos, [umaPronta("A", -100, 3), pendente("B")], "MENSAL");
    const resumo = resumoDoRadar(linhas);
    expect(resumo).toMatchObject({
      parcial: true,
      unidadesProntas: 1,
      unidadesPendentes: 1,
      unidadesComErro: 0,
      unidades: 2,
    });
  });

  it("uma unidade com erro deixa o consolidado parcial e se declara", () => {
    const linhas = montarRadar(periodos, [umaPronta("A", -100, 3), comErro("B")], "MENSAL");
    expect(resumoDoRadar(linhas)).toMatchObject({
      parcial: true,
      unidadesProntas: 1,
      unidadesComErro: 1,
      unidadesPendentes: 0,
    });
  });

  it("com todas prontas, deixa de ser parcial", () => {
    const linhas = montarRadar(periodos, [umaPronta("A", -100, 3), umaPronta("B", 40, 1)], "MENSAL");
    expect(resumoDoRadar(linhas)).toMatchObject({
      parcial: false,
      unidadesProntas: 2,
      unidadesPendentes: 0,
      unidadesComErro: 0,
    });
  });

  it("a soma parcial é sempre a soma do que chegou, e a final bate com a de uma vez só", () => {
    /*
      A garantia que sustenta desenhar antes da hora: em nenhum passo o número
      exibido é outra coisa senão a soma exata das unidades já lidas — e o
      último passo é idêntico ao consolidado que a tela mostrava quando esperava
      tudo.
    */
    const todas = [umaPronta("A", -100, 3), umaPronta("B", 40, 1), umaPronta("C", -7, 5)];
    const finalDeUmaVez = resumoDoRadar(montarRadar(periodos, todas, "MENSAL"));

    for (let chegaram = 0; chegaram <= todas.length; chegaram++) {
      const entrada = todas.map((u, i) => (i < chegaram ? u : pendente(u.label)));
      const resumo = resumoDoRadar(montarRadar(periodos, entrada, "MENSAL"));
      const esperado = todas.slice(0, chegaram);

      expect(resumo.impacto).toBeCloseTo(
        esperado.reduce((soma, u) => soma + (u.movimentos[0]?.movements[0]?.impact.byPeriodicity.MENSAL ?? 0), 0),
        6,
      );
      expect(resumo.unidadesProntas).toBe(chegaram);
      expect(resumo.parcial).toBe(chegaram < todas.length);
    }

    const final = resumoDoRadar(montarRadar(periodos, todas, "MENSAL"));
    expect(final).toEqual(finalDeUmaVez);
    expect(final.parcial).toBe(false);
  });
});

describe("resumoDoRadar", () => {
  it("conta unidades afetadas, não unidades na grade", () => {
    const linhas = montarRadar(
      ["2026-02"],
      [
        unidade("A", movimentos([{ period: "2026-02", changes: 3, impact: { MENSAL: -900 }, notCalculable: 2 }])),
        unidade("B", movimentos([{ period: "2026-02", changes: 0 }])),
        unidade("C", movimentos([])),
      ],
      "MENSAL",
    );
    // Os quatro números originais são os mesmos de sempre; o que o progressivo
    // acrescentou é a cobertura deles — e com tudo lido ela é total.
    expect(resumoDoRadar(linhas)).toEqual({
      alteracoes: 3,
      unidadesAfetadas: 1,
      impacto: -900,
      semApuracao: 2,
      unidadesProntas: 3,
      unidadesPendentes: 0,
      unidadesComErro: 0,
      unidades: 3,
      parcial: false,
    });
  });
});

describe("intensidade da grade", () => {
  it("a escala é o maior módulo de impacto de uma célula", () => {
    const linhas = montarRadar(
      ["2026-01", "2026-02"],
      [
        unidade(
          "A",
          movimentos([
            { period: "2026-01", changes: 1, impact: { MENSAL: -2000 } },
            { period: "2026-02", changes: 40, impact: { MENSAL: 500 } },
          ]),
        ),
      ],
      "MENSAL",
    );
    const maior = maiorImpactoDaGrade(linhas);
    expect(maior).toBe(2000);
    expect(intensidadeDaCelula(-2000, maior)).toBe(1);
    expect(intensidadeDaCelula(500, maior)).toBe(0.25);
  });

  it("sem impacto apurado nenhum, ninguém acende — nem a célula com mais alterações", () => {
    expect(intensidadeDaCelula(0, 0)).toBe(0);
    expect(maiorImpactoDaGrade([])).toBe(0);
  });
});

/** Um `/changes/range` com só o que a abertura de célula lê: as entradas. */
/**
 * As entradas de uma célula, como `/changes/radar?period=` as devolve.
 *
 * Não têm mais `period` variável: a rota responde por **uma** vigência, e o
 * recorte que antes era feito aqui saiu para o servidor. O teste que provava o
 * recorte mudou de camada junto — ver `radar.test.ts` em `lib/comparison`.
 */
function entradas(
  lista: {
    parameterKey: string;
    amount?: number | null;
    periodicity?: string | null;
  }[],
  period = "2026-02",
): EntradaDaCelula[] {
  return lista.map((e) => ({
    period,
    parameterKey: e.parameterKey,
    parameterName: e.parameterKey,
    family: "REMUNERACAO",
    attributeCode: null,
    amount: e.amount === undefined ? null : e.amount,
    periodicity: e.periodicity === undefined ? "MENSAL" : e.periodicity,
  }));
}

describe("atributosDaCelula", () => {
  it("separa os lados do impacto e ordena pelo módulo", () => {
    const abertura = atributosDaCelula(
      entradas([
        { parameterKey: "pedagio", amount: -300 },
        { parameterKey: "diesel", amount: -5000 },
        { parameterKey: "bonus", amount: 900 },
      ]),
      "MENSAL",
    );

    expect(abertura.desfavoraveis.map((a) => a.parameterKey)).toEqual(["diesel", "pedagio"]);
    expect(abertura.favoraveis.map((a) => a.parameterKey)).toEqual(["bonus"]);
    expect(abertura.impacto).toBe(-4400);
  });

  it("soma os canais da unidade, porque a célula clicada é a soma deles", () => {
    // Quem chama concatena as leituras dos contextos da unidade — uma chamada
    // por canal, uma lista só aqui.
    const abertura = atributosDaCelula(
      [
        ...entradas([{ parameterKey: "diesel", amount: -1000 }]),
        ...entradas([{ parameterKey: "diesel", amount: -500 }]),
      ],
      "MENSAL",
    );

    expect(abertura.desfavoraveis).toHaveLength(1);
    expect(abertura.desfavoraveis[0].impacto).toBe(-1500);
    expect(abertura.desfavoraveis[0].alteracoes).toBe(2);
  });

  it("sem preço não vira zero — o atributo aparece com a contagem que tem", () => {
    const abertura = atributosDaCelula(
      entradas([
        { parameterKey: "manutencao", amount: null },
        { parameterKey: "manutencao", amount: null },
      ]),
      "MENSAL",
    );

    expect(abertura.favoraveis).toEqual([]);
    expect(abertura.desfavoraveis).toEqual([]);
    expect(abertura.semDinheiro[0]).toMatchObject({
      parameterKey: "manutencao",
      alteracoes: 2,
      semApuracao: 2,
      impacto: 0,
    });
  });

  it("dinheiro de outra periodicidade fica de fora da soma e dito na linha", () => {
    // A grade inteira é desenhada numa periodicidade de cada vez: somar o
    // anual aqui seria o mesmo erro que `montarRadar` recusa na célula.
    const abertura = atributosDaCelula(
      entradas([{ parameterKey: "seguro", amount: -12000, periodicity: "ANUAL" }]),
      "MENSAL",
    );

    expect(abertura.impacto).toBe(0);
    expect(abertura.semDinheiro[0]).toMatchObject({
      parameterKey: "seguro",
      alteracoes: 1,
      outraPeriodicidade: 1,
      semApuracao: 0,
    });
  });

  it("sem periodicidade escolhida, nenhuma entrada entra na soma", () => {
    const abertura = atributosDaCelula(
      entradas([{ parameterKey: "diesel", amount: -1000 }]),
      null,
    );

    expect(abertura.impacto).toBe(0);
    expect(abertura.semDinheiro).toHaveLength(1);
  });

  it("uma célula sem detalhe carregado ainda não é uma célula vazia", () => {
    // A gaveta pede o detalhe ao abrir. Enquanto ele não chega, a lista é
    // vazia — e quem chama precisa distinguir isso de "não havia nada",
    // exatamente como a grade distingue pendente de zero.
    const abertura = atributosDaCelula([], "MENSAL");
    expect(abertura.favoraveis).toEqual([]);
    expect(abertura.desfavoraveis).toEqual([]);
    expect(abertura.semDinheiro).toEqual([]);
    expect(abertura.impacto).toBe(0);
  });
});
