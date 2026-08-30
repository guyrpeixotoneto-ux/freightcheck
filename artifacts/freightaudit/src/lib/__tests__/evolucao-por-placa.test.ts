import { describe, expect, it } from "vitest";
import {
  VIGENCIAS_PARA_RECORRENCIA as RECORRENCIA_DO_DOMINIO,
} from "@workspace/comparison";
import {
  FILTROS_DA_EVOLUCAO,
  VIGENCIAS_PARA_RECORRENCIA,
  aplicaFiltro,
  consultaDaEvolucao,
  corDaCelula,
  intensidadeDaCelula,
  maiorCelulaAbsoluta,
  opcoesDaEvolucao,
  ordenarAtivos,
  recorteDaMatriz,
  serieDaPlaca,
  vocabularioDoGrao,
  type AtivoNaEvolucao,
  type CelulaDaPlaca,
} from "@/lib/evolucao-por-placa";

/**
 * As regras da matriz, do lado da tela.
 *
 * A entrada é o JSON que `/changes/evolucao-por-placa` devolve; a saída é o que
 * a tela desenha. Nenhum destes testes monta React — o que eles prendem são as
 * decisões que mudariam o que o usuário lê: o que cada pastilha filtra, em que
 * ordem as placas saem, que cor uma célula recebe, e a diferença entre o
 * impacto de uma vigência e o acumulado do período.
 */

const celula = (over: Partial<CelulaDaPlaca> & { period: string }): CelulaDaPlaca => ({
  label: over.period,
  estado: "VALORADA",
  alteracoes: 1,
  valoradas: 1,
  semValoracao: 0,
  foraDoTotal: 0,
  outraPeriodicidade: 0,
  ganho: 0,
  perda: 0,
  net: 0,
  rubricas: [],
  ...over,
});

const ativo = (over: Partial<AtivoNaEvolucao> & { entityId: string }): AtivoNaEvolucao => ({
  plate: over.entityId,
  rotulo: over.entityId,
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

describe("a pergunta que a tela faz", () => {
  it("a chave carrega recorte, pontas, tipo e grandeza — e nunca a vigência", () => {
    const query = consultaDaEvolucao(
      new URLSearchParams({ scopeHash: "abc", canal: "EMPURRADA", period: "2026-08-02" }),
      "2026-01-02",
      "2026-08-02",
      "CAVALO",
      "MENSAL",
    );
    expect(query.get("period")).toBeNull();
    expect(query.get("from")).toBe("2026-01-02");
    expect(query.get("to")).toBe("2026-08-02");
    expect(query.get("tipo")).toBe("CAVALO");
    expect(query.get("periodicidade")).toBe("MENSAL");
    expect(query.get("scopeHash")).toBe("abc");
  });

  it("duas leituras do mesmo recorte compartilham a mesma chave de cache", () => {
    const params = new URLSearchParams({ scopeHash: "abc" });
    expect(opcoesDaEvolucao(params, "a", "b").queryKey).toEqual(
      opcoesDaEvolucao(new URLSearchParams({ scopeHash: "abc" }), "a", "b").queryKey,
    );
  });
});

describe("os filtros rápidos", () => {
  it("cada pastilha traz a própria definição escrita", () => {
    for (const filtro of FILTROS_DA_EVOLUCAO) {
      expect(filtro.descricao.length).toBeGreaterThan(10);
    }
  });

  it("a régua de recorrência da tela é a mesma do domínio", () => {
    expect(VIGENCIAS_PARA_RECORRENCIA).toBe(RECORRENCIA_DO_DOMINIO);
    expect(FILTROS_DA_EVOLUCAO.find((f) => f.chave === "recorrentes")?.descricao).toContain(
      String(VIGENCIAS_PARA_RECORRENCIA),
    );
  });

  it("piorando e melhorando leem a tendência do domínio, e não o sinal do saldo", () => {
    const caindo = ativo({ entityId: "a", tendencia: "PIORANDO", acumulado: -10 });
    const subindo = ativo({ entityId: "b", tendencia: "MELHORANDO", acumulado: 10 });
    /*
      Uma placa com saldo negativo mas movimento estável não é "Piorando". Se
      este filtro lesse o sinal do acumulado, a pastilha discordaria do selo que
      a mesma linha exibe.
    */
    const estavel = ativo({ entityId: "c", tendencia: "ESTAVEL", acumulado: -10 });

    expect(aplicaFiltro(caindo, "piorando")).toBe(true);
    expect(aplicaFiltro(estavel, "piorando")).toBe(false);
    expect(aplicaFiltro(subindo, "melhorando")).toBe(true);
  });

  it("sem valoração é sobre pendência, e recorrente é sobre presença", () => {
    const pendente = ativo({ entityId: "a", semValoracao: 2, vigenciasAfetadas: 1 });
    const recorrente = ativo({
      entityId: "b",
      vigenciasAfetadas: VIGENCIAS_PARA_RECORRENCIA,
    });

    expect(aplicaFiltro(pendente, "sem-valoracao")).toBe(true);
    expect(aplicaFiltro(pendente, "recorrentes")).toBe(false);
    expect(aplicaFiltro(recorrente, "recorrentes")).toBe(true);
    expect(aplicaFiltro(recorrente, "sem-valoracao")).toBe(false);
  });
});

describe("a ordenação", () => {
  const lista = [
    ativo({ entityId: "AAA", acumulado: -100, score: 10, alteracoes: 2 }),
    ativo({ entityId: "BBB", acumulado: 900, score: 80, alteracoes: 9 }),
    ativo({ entityId: "CCC", acumulado: null, score: 30, alteracoes: 5 }),
  ];

  it("maior perda põe o mais negativo na frente, e o sem preço no fim", () => {
    expect(ordenarAtivos(lista, "maior-perda").map((a) => a.entityId)).toEqual([
      "AAA",
      "BBB",
      "CCC",
    ]);
  });

  it("maior ganho é o espelho, e o sem preço continua no fim", () => {
    expect(ordenarAtivos(lista, "maior-ganho").map((a) => a.entityId)).toEqual([
      "BBB",
      "AAA",
      "CCC",
    ]);
  });

  it("empate desempata por placa, para a lista não dançar entre leituras", () => {
    const empatados = [
      ativo({ entityId: "QYW10D78", rotulo: "QYW10D78", score: 5 }),
      ativo({ entityId: "QYW2D78", rotulo: "QYW2D78", score: 5 }),
    ];
    expect(ordenarAtivos(empatados, "prioridade").map((a) => a.rotulo)).toEqual([
      "QYW2D78",
      "QYW10D78",
    ]);
  });
});

describe("o recorte da matriz", () => {
  const lista = [
    ativo({ entityId: "1", rotulo: "ABC1D23", tendencia: "PIORANDO", score: 9 }),
    ativo({ entityId: "2", rotulo: "DEF4G56", tendencia: "MELHORANDO", score: 5 }),
    ativo({
      entityId: "3",
      rotulo: "GHI7J89",
      placasAnteriores: ["ABC0000"],
      tendencia: "PIORANDO",
      score: 1,
    }),
  ];

  it("a busca acha pela placa corrente e pela anterior — é o mesmo ativo", () => {
    expect(
      recorteDaMatriz(lista, { filtro: "todos", busca: "abc", ordem: "prioridade" }).map(
        (a) => a.entityId,
      ),
    ).toEqual(["1", "3"]);
  });

  it("o insight recorta pelas placas que ele conta, e o filtro ainda vale", () => {
    const so13 = recorteDaMatriz(lista, {
      filtro: "todos",
      busca: "",
      ordem: "prioridade",
      insight: ["1", "3"],
    });
    expect(so13.map((a) => a.entityId)).toEqual(["1", "3"]);

    const comFiltro = recorteDaMatriz(lista, {
      filtro: "melhorando",
      busca: "",
      ordem: "prioridade",
      insight: ["1", "3"],
    });
    expect(comFiltro).toEqual([]);
  });
});

describe("a cor da célula", () => {
  it("ausência, pendência, ganho e perda são quatro coisas distintas", () => {
    expect(corDaCelula(undefined)).toBe("sem-alteracao");
    expect(corDaCelula(celula({ period: "p", net: null }))).toBe("sem-valoracao");
    expect(corDaCelula(celula({ period: "p", net: 10 }))).toBe("ganho");
    expect(corDaCelula(celula({ period: "p", net: -10 }))).toBe("perda");
  });

  it("um líquido apurado em zero é neutro — e não ganho", () => {
    expect(corDaCelula(celula({ period: "p", net: 0 }))).toBe("sem-alteracao");
  });

  it("a intensidade tem três degraus, medidos contra a maior célula à vista", () => {
    expect(intensidadeDaCelula(-1000, 1000)).toBe(3);
    expect(intensidadeDaCelula(-200, 1000)).toBe(2);
    expect(intensidadeDaCelula(-10, 1000)).toBe(1);
    // Sem régua (nada valorado no recorte), nada grita.
    expect(intensidadeDaCelula(-10, 0)).toBe(1);
    expect(intensidadeDaCelula(null, 1000)).toBe(1);
  });

  it("a régua ignora as células sem valoração — elas não são grandes nem pequenas", () => {
    const lista = [
      ativo({
        entityId: "1",
        celulas: [celula({ period: "a", net: -300 }), celula({ period: "b", net: null })],
      }),
    ];
    expect(maiorCelulaAbsoluta(lista)).toBe(300);
  });
});

describe("a série do painel", () => {
  const colunas = [
    { period: "2026-06-02", label: "junho" },
    { period: "2026-07-02", label: "julho" },
    { period: "2026-08-02", label: "agosto" },
  ];

  it("separa o impacto da vigência do acumulado do período", () => {
    const serie = serieDaPlaca(
      ativo({
        entityId: "1",
        celulas: [celula({ period: "2026-07-02", net: -10_146, alteracoes: 7 })],
      }),
      colunas,
    );

    expect(serie.map((p) => p.vigencia)).toEqual([null, -10_146, null]);
    expect(serie.map((p) => p.acumulado)).toEqual([0, -10_146, -10_146]);
  });

  it("uma vigência sem alteração não vira movimento de R$ 0", () => {
    const serie = serieDaPlaca(ativo({ entityId: "1", celulas: [] }), colunas);
    expect(serie.every((p) => p.vigencia === null)).toBe(true);
    expect(serie.every((p) => p.alteracoes === 0)).toBe(true);
  });

  it("uma vigência sem valoração entra na série sem mexer no acumulado", () => {
    const serie = serieDaPlaca(
      ativo({
        entityId: "1",
        celulas: [
          celula({ period: "2026-06-02", net: -500 }),
          celula({ period: "2026-07-02", net: null, semValoracao: 3, alteracoes: 3 }),
        ],
      }),
      colunas,
    );
    expect(serie.map((p) => p.acumulado)).toEqual([-500, -500, -500]);
    expect(serie[1].semValoracao).toBe(3);
  });
});

describe("o grão de conjunto, do lado da tela", () => {
  const comPar = (
    over: Partial<AtivoNaEvolucao> & { entityId: string },
  ): AtivoNaEvolucao =>
    ativo({
      componentes: {
        cavalo: { entityId: "c1", entityType: "CAVALO", plate: "RZG4F47" },
        carreta: { entityId: "r1", entityType: "CARRETA", plate: "ABC1D23" },
      },
      rotulo: "RZG4F47 + ABC1D23",
      vigenciasJuntos: 4,
      ...over,
    });

  it("a pergunta do conjunto é outra chave de cache, e ela carrega o grão", () => {
    const params = new URLSearchParams({ scopeHash: "abc" });
    const doAtivo = opcoesDaEvolucao(params, "a", "b").queryKey;
    const doConjunto = opcoesDaEvolucao(params, "a", "b", null, null, "CONJUNTO").queryKey;
    expect(doConjunto).not.toEqual(doAtivo);
    expect(String(doConjunto[1])).toContain("grao=CONJUNTO");
  });

  it("o recorte por tipo não viaja junto com o conjunto", () => {
    /*
      A recusa é do servidor, e a tela não manda o que ele vai descartar: um
      `?tipo=CAVALO&grao=CONJUNTO` no endereço prometeria um recorte que
      ninguém aplica.
    */
    const query = consultaDaEvolucao(
      new URLSearchParams(),
      "a",
      "b",
      "CAVALO",
      "MENSAL",
      "CONJUNTO",
    );
    expect(query.get("tipo")).toBeNull();
    expect(query.get("grao")).toBe("CONJUNTO");
    // A grandeza e as pontas seguem — são o contexto, e não a pergunta.
    expect(query.get("periodicidade")).toBe("MENSAL");
    expect(query.get("from")).toBe("a");
  });

  it("a busca alcança os dois lados do par", () => {
    const lista = [
      comPar({ entityId: "c1|r1" }),
      comPar({
        entityId: "c2|r2",
        rotulo: "QYW2D78 + QYW4C69",
        componentes: {
          cavalo: { entityId: "c2", entityType: "CAVALO", plate: "QYW2D78" },
          carreta: { entityId: "r2", entityType: "CARRETA", plate: "QYW4C69" },
        },
      }),
    ];
    const porCavalo = recorteDaMatriz(lista, {
      filtro: "todos",
      busca: "rzg4f47",
      ordem: "prioridade",
    });
    const porCarreta = recorteDaMatriz(lista, {
      filtro: "todos",
      busca: "qyw4c69",
      ordem: "prioridade",
    });
    expect(porCavalo.map((a) => a.entityId)).toEqual(["c1|r1"]);
    expect(porCarreta.map((a) => a.entityId)).toEqual(["c2|r2"]);
  });

  it("o vocabulário troca com o grão — e é ele que nomeia a linha", () => {
    expect(vocabularioDoGrao("ATIVO").plural).toBe("placas");
    expect(vocabularioDoGrao("CONJUNTO").plural).toBe("conjuntos");
    expect(vocabularioDoGrao("CONJUNTO").coluna).toBe("Conjunto");
    // A busca do conjunto precisa dizer que alcança os dois lados.
    expect(vocabularioDoGrao("CONJUNTO").busca.toLowerCase()).toContain("carreta");
  });

  it("a série de um conjunto se monta como a de um ativo — o par não muda a conta", () => {
    const colunas = [
      { period: "2026-06-02", label: "junho" },
      { period: "2026-07-02", label: "julho" },
    ];
    const serie = serieDaPlaca(
      comPar({
        entityId: "c1|r1",
        celulas: [celula({ period: "2026-07-02", net: -3200, alteracoes: 4 })],
      }),
      colunas,
    );
    expect(serie.map((p) => p.acumulado)).toEqual([0, -3200]);
    expect(serie.map((p) => p.vigencia)).toEqual([null, -3200]);
  });
});
