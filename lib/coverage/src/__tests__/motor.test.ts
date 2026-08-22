import { describe, expect, it } from "vitest";
import { classificar, contar, medirAtributo } from "../modelo";
import { medirCelula } from "../matriz";
import {
  MINIMO_DE_VIGENCIAS,
  PRESENCA_ESTRUTURAL,
  resolverEsperado,
  type HistoricoDoAtributo,
} from "../esperado";
import { candidatoPara, semelhancaDeNome, type AtributoParaComparar } from "../descoberta";
import { atributosDaDRE } from "@workspace/dre";
import { contratoDaDRE, universoDeclarado } from "../contrato";
import type { AtributoObservado } from "../observado";
import type { Esperado } from "../modelo";

/**
 * O motor da cobertura, sem banco.
 *
 * As decisões que este módulo toma — o que é esperado, o que é lacuna, o que é
 * crítico, o que é candidato a renomeação — são funções puras de propósito, e
 * este arquivo é o que prova que elas continuam decidindo o mesmo. As provas
 * que **precisam** de dado real (consolidação de arquivos complementares,
 * proveniência, reimportação) vivem em `cobertura-real.test.ts`; separá-las é o
 * que permite exercitar uma variável de cada vez aqui.
 */

const observado = (
  code: string,
  entityType: string,
  comValor: number,
  extras: Partial<AtributoObservado> = {},
): AtributoObservado => ({
  snapshotId: "s1",
  attributeId: `a-${code}`,
  attributeCode: code,
  attributeLabel: code,
  entityType,
  comValor,
  vazias: 0,
  naoAplicaveis: 0,
  noLayout: true,
  sourceName: code,
  semanticsStatus: "CONFIRMED",
  ...extras,
});

const esperado = (
  code: string,
  entityType: string,
  entidades: number,
  criticidade: Esperado["criticidade"] = "RELEVANTE",
): Esperado => ({
  attributeCode: code,
  entityType,
  criticidade,
  entidadesEsperadas: entidades,
  justificativa: {
    origem: "CONTRATO",
    declarado: true,
    motivo: "teste",
    medicao: {},
  },
});

describe("3. atributo esperado ausente vira lacuna", () => {
  it("conta as entidades que ficaram sem o dado, e não os fatos", () => {
    const r = medirCelula({
      esperados: [esperado("cavalo.seguro", "CAVALO", 144)],
      observados: [observado("cavalo.seguro", "CAVALO", 73)],
      dispensados: new Set(),
      entidadesNaVigencia: 144,
    });

    expect(r.lacunas).toHaveLength(1);
    expect(r.lacunas[0]).toMatchObject({
      attributeCode: "cavalo.seguro",
      estado: "PARCIAL",
      entidadesEsperadas: 144,
      entidadesPresentes: 73,
      entidadesFaltando: 71,
    });
    expect(r.estado).toBe("PARCIAL");
  });

  it("um atributo que não veio de todo é AUSENTE, não PARCIAL", () => {
    const r = medirCelula({
      esperados: [esperado("cavalo.km_volta", "CAVALO", 144)],
      observados: [],
      dispensados: new Set(),
      entidadesNaVigencia: 144,
    });

    expect(r.lacunas[0]!.estado).toBe("AUSENTE");
    expect(r.lacunas[0]!.entidadesFaltando).toBe(144);
    /* Nada do esperado chegou: a célula inteira é AUSENTE, não 0% de PARCIAL. */
    expect(r.estado).toBe("AUSENTE");
  });

  it("a justificativa acompanha a lacuna — nunca um percentual sozinho", () => {
    const r = medirCelula({
      esperados: [esperado("cavalo.seguro", "CAVALO", 144, "CRITICO")],
      observados: [observado("cavalo.seguro", "CAVALO", 73)],
      dispensados: new Set(),
      entidadesNaVigencia: 144,
    });
    expect(r.lacunas[0]!.justificativa.motivo).toBeTruthy();
    expect(r.lacunas[0]!.justificativa.declarado).toBe(true);
  });
});

describe("4. entidade ausente é detectada", () => {
  it("uma vigência com menos entidades reduz a cobertura, não o esperado", () => {
    /*
      144 cavalos eram esperados por contrato; a vigência trouxe 100. Cada
      atributo cobre 100, e a diferença aparece como lacuna em todos eles — que
      é a assinatura de "faltou entidade", distinta de "faltou coluna".
    */
    const r = medirCelula({
      esperados: [
        esperado("cavalo.seguro", "CAVALO", 144),
        esperado("cavalo.km_volta", "CAVALO", 144),
      ],
      observados: [
        observado("cavalo.seguro", "CAVALO", 100),
        observado("cavalo.km_volta", "CAVALO", 100),
      ],
      dispensados: new Set(),
      entidadesNaVigencia: 100,
    });

    expect(r.lacunas).toHaveLength(2);
    expect(r.lacunas.every((l) => l.entidadesFaltando === 44)).toBe(true);
    expect(r.conta.combinacoesEsperadas).toBe(288);
    expect(r.conta.combinacoesEncontradas).toBe(200);
    expect(r.conta.percentual).toBe(69.4);
  });
});

describe("5. campo novo é classificado como novo", () => {
  it("a célula com estreia vira NOVO, e o novo não infla o percentual", () => {
    const r = medirCelula({
      esperados: [esperado("cavalo.seguro", "CAVALO", 144)],
      observados: [
        observado("cavalo.seguro", "CAVALO", 144),
        observado("cavalo.taxa_nova_operacao", "CAVALO", 144),
      ],
      dispensados: new Set(),
      entidadesNaVigencia: 144,
      novos: 1,
    });

    expect(r.novos).toBe(1);
    expect(r.estado).toBe("NOVO");
    /* O denominador é o esperado; o que chegou a mais não vira cobertura. */
    expect(r.conta.combinacoesEsperadas).toBe(144);
    expect(r.conta.combinacoesEncontradas).toBe(144);
    expect(r.conta.percentual).toBe(100);
  });

  it("um atributo conhecido e ainda não esperado não relabela a célula", () => {
    /*
      A distinção que custou um retrabalho: "observado e não esperado" não é o
      mesmo que "novo". Um atributo que estreou na vigência passada e que a
      inferência ainda não promoveu a esperado — porque uma aparição só não faz
      série — continua fora da lista de esperados hoje, e não é novidade hoje.
      Quem decide o que é estreia é `descobertas`, e o número chega aqui pronto.
    */
    const r = medirCelula({
      esperados: [esperado("cavalo.seguro", "CAVALO", 144)],
      observados: [
        observado("cavalo.seguro", "CAVALO", 144),
        observado("cavalo.conhecido_ontem", "CAVALO", 144),
      ],
      dispensados: new Set(),
      entidadesNaVigencia: 144,
      novos: 0,
    });

    expect(r.novos).toBe(0);
    expect(r.estado).toBe("COMPLETO");
    expect(r.conta.percentual).toBe(100);
  });

  it("uma vigência sem nada esperado não é NOVO nem COMPLETO — é sem base", () => {
    const r = medirCelula({
      esperados: [],
      observados: [observado("cavalo.primeiro", "CAVALO", 144)],
      dispensados: new Set(),
      entidadesNaVigencia: 144,
      novos: 1,
    });
    expect(r.estado).toBe("NAO_APLICAVEL");
  });
});

describe("6. possível rename não é tratado como ausência definitiva", () => {
  const janela = (
    code: string,
    primeira: string,
    ultima: string,
    desapareceuEm: string | null,
  ): AtributoParaComparar => ({
    attributeCode: code,
    entityType: "CAVALO",
    dataType: "NUMERIC",
    datasetFamily: "REMUNERACAO_EQUIPAMENTO",
    primeiraVigencia: primeira,
    ultimaVigencia: ultima,
    desapareceuEm,
  });

  it("liga ipvaLicenciamentoMensal a ipvaLicenciamento, com motivos nomeados", () => {
    const novo = janela("cavalo.ipva_licenciamento_mensal", "2026-08-01", "2026-08-01", null);
    const sumido = janela("cavalo.ipva_licenciamento", "2025-12-02", "2026-07-02", "2026-08-01");

    const candidato = candidatoPara(novo, [sumido]);
    expect(candidato).not.toBeNull();
    expect(candidato!.attributeCode).toBe("cavalo.ipva_licenciamento");
    expect(candidato!.confianca).toBeGreaterThanOrEqual(0.75);
    expect(candidato!.motivos.join(" ")).toContain("mesma entidade");
    expect(candidato!.motivos.join(" ")).toContain("deixou de aparecer exatamente quando");
  });

  it("não inventa candidato para um campo sem parecido nenhum", () => {
    const novo = janela("cavalo.tipo_implemento", "2026-08-01", "2026-08-01", null);
    const sumido = janela("cavalo.km_volta", "2025-12-02", "2026-07-02", "2026-08-01");
    expect(candidatoPara(novo, [sumido])).toBeNull();
  });

  it("coincidência de calendário sozinha não basta — o nome tem de bater", () => {
    /* Mesmo equipamento, mesma família, mesmo tipo, mesma data: 0,5 < 0,6. */
    const novo = janela("cavalo.aaa", "2026-08-01", "2026-08-01", null);
    const sumido = janela("cavalo.zzz", "2025-12-02", "2026-07-02", "2026-08-01");
    expect(candidatoPara(novo, [sumido])).toBeNull();
  });

  it("a semelhança é simétrica e a contenção pontua alto", () => {
    expect(semelhancaDeNome("cavalo.ipva_licenciamento", "cavalo.ipva_licenciamento")).toBe(1);
    expect(
      semelhancaDeNome("cavalo.ipva_licenciamento_mensal", "cavalo.ipva_licenciamento"),
    ).toBe(semelhancaDeNome("cavalo.ipva_licenciamento", "cavalo.ipva_licenciamento_mensal"));
    expect(
      semelhancaDeNome("cavalo.ipva_licenciamento_mensal", "cavalo.ipva_licenciamento"),
    ).toBeGreaterThan(0.7);
  });
});

describe("7. não aplicável não reduz cobertura", () => {
  it("sai dos dois lados da fração", () => {
    const r = medirCelula({
      esperados: [esperado("carreta.eixo_extra", "CARRETA", 100)],
      observados: [
        observado("carreta.eixo_extra", "CARRETA", 60, { vazias: 40, naoAplicaveis: 40 }),
      ],
      dispensados: new Set(),
      entidadesNaVigencia: 100,
    });

    expect(r.lacunas).toHaveLength(0);
    expect(r.conta.combinacoesNaoAplicaveis).toBe(40);
    expect(r.conta.percentual).toBe(100);
    expect(r.estado).toBe("COMPLETO");
  });

  it("um vazio sem motivo de não aplicável continua sendo lacuna", () => {
    const r = medirCelula({
      esperados: [esperado("carreta.eixo_extra", "CARRETA", 100)],
      observados: [
        observado("carreta.eixo_extra", "CARRETA", 60, { vazias: 40, naoAplicaveis: 0 }),
      ],
      dispensados: new Set(),
      entidadesNaVigencia: 100,
    });
    expect(r.lacunas[0]!.entidadesFaltando).toBe(40);
    expect(r.conta.percentual).toBe(60);
  });

  it("uma dispensa registrada tira o atributo da conta inteira", () => {
    const r = medirCelula({
      esperados: [
        esperado("cavalo.seguro", "CAVALO", 100),
        esperado("cavalo.km_volta", "CAVALO", 100),
      ],
      observados: [observado("cavalo.seguro", "CAVALO", 100)],
      dispensados: new Set(["cavalo.km_volta"]),
      entidadesNaVigencia: 100,
    });
    expect(r.lacunas).toHaveLength(0);
    expect(r.conta.atributosEsperados).toBe(1);
    expect(r.conta.percentual).toBe(100);
  });
});

describe("8 e 9. criticidade separa o que bloqueia do que não bloqueia", () => {
  it("ausência de campo crítico derruba a cobertura crítica", () => {
    const r = medirCelula({
      esperados: [
        esperado("cavalo.frete_reais_viagem_pedagio", "CAVALO", 144, "CRITICO"),
        esperado("cavalo.observacao", "CAVALO", 144, "INFORMATIVO"),
      ],
      observados: [
        observado("cavalo.frete_reais_viagem_pedagio", "CAVALO", 102),
        observado("cavalo.observacao", "CAVALO", 144),
      ],
      dispensados: new Set(),
      entidadesNaVigencia: 144,
    });

    expect(r.contaCritica.percentual).toBe(70.8);
    expect(r.contagemDeLacunas.critico).toBe(1);
    /* A cobertura total mal se move: é por isso que a crítica existe. */
    expect(r.conta.percentual).toBe(85.4);
  });

  it("ausência de campo não crítico deixa a cobertura crítica em 100%", () => {
    const r = medirCelula({
      esperados: [
        esperado("cavalo.frete_reais_viagem_pedagio", "CAVALO", 144, "CRITICO"),
        esperado("cavalo.observacao", "CAVALO", 144, "INFORMATIVO"),
      ],
      observados: [
        observado("cavalo.frete_reais_viagem_pedagio", "CAVALO", 144),
        observado("cavalo.observacao", "CAVALO", 100),
      ],
      dispensados: new Set(),
      entidadesNaVigencia: 144,
    });

    expect(r.contaCritica.percentual).toBe(100);
    expect(r.contagemDeLacunas.critico).toBe(0);
    expect(r.contagemDeLacunas.informativo).toBe(1);
    expect(r.conta.percentual).toBeLessThan(100);
  });

  it("a criticidade vem do plano da DRE, e não de uma segunda lista", () => {
    const contrato = contratoDaDRE();
    expect(contrato.length).toBeGreaterThan(0);
    const criticos = contrato.filter((c) => c.criticidade === "CRITICO");
    expect(criticos.length).toBeGreaterThan(0);
    /* Todo crítico cita a linha essencial da DRE que o torna crítico. */
    for (const c of criticos) {
      expect(c.motivo).toContain("essencial");
      expect(c.origem).toBe("CONTRATO");
      expect(c.evidencia).toHaveProperty("componentes");
    }
    /* E nenhum atributo do contrato chega sem motivo escrito. */
    expect(contrato.every((c) => c.motivo.trim().length > 0)).toBe(true);
  });
});

describe("o esperado distingue declaração de inferência", () => {
  const historico = (
    code: string,
    comDado: number,
    avaliadas: number,
    entidadesNaUltima: number,
    comValorNaUltima = entidadesNaUltima,
  ): [string, HistoricoDoAtributo] => [
    code,
    {
      attributeCode: code,
      entityType: "CAVALO",
      vigenciasComDado: comDado,
      vigenciasComValor: comValorNaUltima > 0 ? comDado : 0,
      vigenciasAvaliadas: avaliadas,
      entidadesNaUltima,
      comValorNaUltima,
      ultimaVigencia: "2026-07-02",
      primeiraVigencia: "2025-12-02",
    },
  ];

  it("contrato ganha de histórico para o mesmo atributo", () => {
    const { esperados } = resolverEsperado({
      declarado: [
        {
          attributeCode: "cavalo.seguro",
          entityType: "CAVALO",
          datasetFamily: "REMUNERACAO_EQUIPAMENTO",
          canal: null,
          scopeKey: null,
          criticidade: "CRITICO",
          status: "CONFIRMADO",
          origem: "CONTRATO",
          efetivoDe: "1900-01-01",
          efetivoAte: null,
          sucessor: null,
          motivo: "contrato",
          evidencia: {},
          ator: "contrato:dre",
        },
      ],
      historico: new Map([historico("cavalo.seguro", 8, 8, 144)]),
      presenca: [],
      entidadesPorTipo: new Map([["CAVALO", 144]]),
    });

    expect(esperados).toHaveLength(1);
    expect(esperados[0]!.justificativa.origem).toBe("CONTRATO");
    expect(esperados[0]!.justificativa.declarado).toBe(true);
    expect(esperados[0]!.criticidade).toBe("CRITICO");
  });

  it("histórico entra como inferência, dizendo que é inferência", () => {
    const { esperados } = resolverEsperado({
      declarado: [],
      historico: new Map([historico("cavalo.seguro", 8, 8, 144)]),
      presenca: [],
      entidadesPorTipo: new Map([["CAVALO", 144]]),
    });

    expect(esperados).toHaveLength(1);
    expect(esperados[0]!.justificativa.origem).toBe("HISTORICO");
    expect(esperados[0]!.justificativa.declarado).toBe(false);
    expect(esperados[0]!.justificativa.motivo).toContain("inferência, não contrato");
    expect(esperados[0]!.justificativa.medicao.vigenciasComColuna).toBe(8);
    expect(esperados[0]!.justificativa.medicao.comValorNaUltima).toBe(144);
  });

  it("uma aparição só não vira expectativa", () => {
    const { esperados } = resolverEsperado({
      declarado: [],
      historico: new Map([historico("cavalo.eventual", MINIMO_DE_VIGENCIAS - 1, 8, 144)]),
      presenca: [],
      entidadesPorTipo: new Map([["CAVALO", 144]]),
    });
    expect(esperados).toHaveLength(0);
  });

  it("uma coluna que sempre chegou vazia não gera expectativa de valor", () => {
    /*
      Ela veio no layout das oito vigências e nunca trouxe número. Cobrar valor
      dela seria inventar uma lacuna que a origem nunca prometeu preencher — o
      caso é de Qualidade de dados, não de Cobertura. Achado no export real:
      cinco colunas de carreta se comportam exatamente assim de Fev/26 em diante.
    */
    const { esperados } = resolverEsperado({
      declarado: [],
      historico: new Map([historico("cavalo.sempre_vazia", 8, 8, 144, 0)]),
      presenca: [],
      entidadesPorTipo: new Map([["CAVALO", 144]]),
    });
    expect(esperados).toHaveLength(0);
  });

  it("o histórico não infla o denominador além do que já se viu", () => {
    /* Sempre veio para 60 dos 64: esperar 64 inventaria quatro lacunas. */
    const { esperados } = resolverEsperado({
      declarado: [],
      historico: new Map([historico("cavalo.parcial", 8, 8, 60)]),
      presenca: [],
      entidadesPorTipo: new Map([["CAVALO", 64]]),
    });
    expect(esperados[0]!.entidadesEsperadas).toBe(60);
  });

  it("estrutura infere do que veio para quase toda a frota da própria vigência", () => {
    const { esperados } = resolverEsperado({
      declarado: [],
      historico: new Map(),
      presenca: [
        { attributeCode: "cavalo.novo", entityType: "CAVALO", entidadesComAtributo: 140 },
        { attributeCode: "cavalo.raro", entityType: "CAVALO", entidadesComAtributo: 3 },
      ],
      entidadesPorTipo: new Map([["CAVALO", 144]]),
    });

    expect(esperados.map((e) => e.attributeCode)).toEqual(["cavalo.novo"]);
    expect(esperados[0]!.justificativa.origem).toBe("ESTRUTURA");
    expect(140 / 144).toBeGreaterThanOrEqual(PRESENCA_ESTRUTURAL);
  });

  it("uma dispensa nunca vira esperado, venha de onde vier", () => {
    const { esperados, dispensados } = resolverEsperado({
      declarado: [
        {
          attributeCode: "cavalo.seguro",
          entityType: "CAVALO",
          datasetFamily: "REMUNERACAO_EQUIPAMENTO",
          canal: null,
          scopeKey: null,
          criticidade: "RELEVANTE",
          status: "DISPENSADO",
          origem: "CURADORIA",
          efetivoDe: "2026-08-01",
          efetivoAte: null,
          sucessor: null,
          motivo: "esta unidade não contrata seguro",
          evidencia: {},
          ator: "curador@teste",
        },
      ],
      historico: new Map([historico("cavalo.seguro", 8, 8, 144)]),
      presenca: [
        { attributeCode: "cavalo.seguro", entityType: "CAVALO", entidadesComAtributo: 140 },
      ],
      entidadesPorTipo: new Map([["CAVALO", 144]]),
    });

    expect(esperados).toHaveLength(0);
    expect(dispensados.has("cavalo.seguro")).toBe(true);
  });
});

describe("a conta e a classificação não se confundem", () => {
  it("cem por cento sem nada esperado é NAO_APLICAVEL, não COMPLETO", () => {
    const conta = contar({
      entidadesEsperadas: 0,
      entidadesEncontradas: 0,
      atributosEsperados: 0,
      atributosEncontrados: 0,
      combinacoesEsperadas: 0,
      combinacoesEncontradas: 0,
      combinacoesNaoAplicaveis: 0,
    });
    expect(
      classificar(conta, { temNovo: false, temAlterado: false, tudoDispensado: false }),
    ).toBe("NAO_APLICAVEL");
  });

  it("zero encontrado com algo esperado é AUSENTE, não zero por cento de PARCIAL", () => {
    const conta = contar({
      entidadesEsperadas: 144,
      entidadesEncontradas: 144,
      atributosEsperados: 3,
      atributosEncontrados: 0,
      combinacoesEsperadas: 432,
      combinacoesEncontradas: 0,
      combinacoesNaoAplicaveis: 0,
    });
    expect(conta.percentual).toBe(0);
    expect(
      classificar(conta, { temNovo: false, temAlterado: false, tudoDispensado: false }),
    ).toBe("AUSENTE");
  });
});

describe("o universo declarado", () => {
  /*
    O catálogo é o universo; o contrato manda onde fala.

    A fusão acontece em memória, e não por duas semeaduras em sequência, porque
    ali a ordem das chamadas decidiria a origem, a criticidade e o motivo dos 10
    atributos em que os dois se sobrepõem. Este teste é o que fixa a regra:
    onde o plano da DRE fala, é a voz dele que sai.
  */
  it("dá precedência ao contrato onde os dois falam do mesmo atributo", () => {
    const universo = universoDeclarado();
    const doContrato = contratoDaDRE();
    expect(doContrato.length).toBeGreaterThan(0);

    for (const contrato of doContrato) {
      const linha = universo.find((e) => e.attributeCode === contrato.attributeCode);
      expect(linha).toBeDefined();
      expect(linha!.origem).toBe("CONTRATO");
      expect(linha!.criticidade).toBe(contrato.criticidade);
      expect(linha!.motivo).toBe(contrato.motivo);
    }
  });

  it("cobre os três tipos declarados, inclusive o que nunca foi importado", () => {
    const tipos = new Set(universoDeclarado().map((e) => e.entityType));
    expect(tipos).toContain("CAVALO");
    expect(tipos).toContain("CARRETA");
    expect(tipos).toContain("TRECHO");
  });

  it("contém todo atributo que o plano da DRE cita", () => {
    const universo = new Set(universoDeclarado().map((e) => e.attributeCode));
    const daDRE = atributosDaDRE();
    expect(daDRE.length).toBeGreaterThan(0);
    for (const code of daDRE) expect(universo).toContain(code);
  });

  /*
    Crescer o universo não pode crescer o alarme.

    O conjunto crítico é o que decide se a DRE fecha, e ele tem um dono só:
    `plano.ts`, pela regra "alimenta componente essencial". Se o catálogo
    pudesse promover alguém a `CRITICO`, a criticidade passaria a ter duas
    fontes — e duas fontes concordam hoje e discordam no dia em que alguém
    editar uma planilha.
  */
  it("não cria atributo crítico fora do plano da DRE", () => {
    const criticosDaDRE = new Set(
      contratoDaDRE()
        .filter((e) => e.criticidade === "CRITICO")
        .map((e) => e.attributeCode),
    );
    for (const linha of universoDeclarado()) {
      if (linha.criticidade !== "CRITICO") continue;
      expect(criticosDaDRE).toContain(linha.attributeCode);
    }
  });

  it("classifica o cadastral como informativo e o resto como relevante", () => {
    const doCatalogo = universoDeclarado().filter((e) => e.origem === "CATALOGO");
    expect(doCatalogo.length).toBeGreaterThan(0);
    for (const linha of doCatalogo) {
      const naDRE = linha.evidencia.entraNaDRE as boolean;
      expect(linha.criticidade).toBe(naDRE ? "RELEVANTE" : "INFORMATIVO");
    }
  });
});

/**
 * O átomo da cobertura: um atributo, numa vigência.
 *
 * `medirAtributo` é a função que `medirCelula` soma para chegar ao percentual
 * da célula e que a matriz de atributos mostra linha a linha. As provas abaixo
 * exercitam as duas propriedades de que as duas telas dependem: que a conta seja
 * a mesma nos dois usos, e que os quatro sentidos de "não tem valor" — ausente,
 * vazio, não aplicável e dispensado — continuem sendo quatro coisas diferentes.
 */
describe("a conta de um atributo só", () => {
  it("é a mesma que a célula soma — a soma das linhas fecha com o total", () => {
    const esperados = [
      esperado("cavalo.seguro", "CAVALO", 144, "CRITICO"),
      esperado("cavalo.ipva", "CAVALO", 144),
      esperado("cavalo.pneus", "CAVALO", 144),
    ];
    const observados = [
      observado("cavalo.seguro", "CAVALO", 73),
      observado("cavalo.ipva", "CAVALO", 144),
      observado("cavalo.pneus", "CAVALO", 0),
    ];

    const celula = medirCelula({
      esperados,
      observados,
      dispensados: new Set(),
      entidadesNaVigencia: 144,
    });

    const porAtributo = esperados.map((e) =>
      medirAtributo({
        esperado: e,
        observado: observados.find((o) => o.attributeCode === e.attributeCode),
      }),
    );

    expect(porAtributo.reduce((s, m) => s + m.entidadesEsperadas, 0)).toBe(
      celula.conta.combinacoesEsperadas,
    );
    expect(porAtributo.reduce((s, m) => s + m.entidadesPresentes, 0)).toBe(
      celula.conta.combinacoesEncontradas,
    );
    /* E o estado de cada linha é o mesmo que a lacuna da célula declarou. */
    for (const lacuna of celula.lacunas) {
      const medida = porAtributo[esperados.findIndex((e) => e.attributeCode === lacuna.attributeCode)];
      expect(medida!.estado).toBe(lacuna.estado);
      expect(medida!.entidadesFaltando).toBe(lacuna.entidadesFaltando);
    }
  });

  it("separa a coluna que não veio da coluna que veio vazia", () => {
    const naoVeio = medirAtributo({
      esperado: esperado("cavalo.seguro", "CAVALO", 144),
    });
    expect(naoVeio.estado).toBe("AUSENTE");
    expect(naoVeio.noLayout).toBe(false);
    expect(naoVeio.entidadesFaltando).toBe(144);

    const veioVazia = medirAtributo({
      esperado: esperado("cavalo.seguro", "CAVALO", 144),
      observado: observado("cavalo.seguro", "CAVALO", 0, { vazias: 144 }),
    });
    expect(veioVazia.estado).toBe("AUSENTE");
    expect(veioVazia.noLayout).toBe(true);
    expect(veioVazia.entidadesVazias).toBe(144);
    expect(veioVazia.entidadesFaltando).toBe(144);
  });

  it("o não aplicável sai dos dois lados e não derruba o percentual", () => {
    const medida = medirAtributo({
      esperado: esperado("carreta.eixo_extra", "CARRETA", 76),
      observado: observado("carreta.eixo_extra", "CARRETA", 40, {
        vazias: 36,
        naoAplicaveis: 36,
      }),
    });
    expect(medida.entidadesFaltando).toBe(0);
    expect(medida.percentual).toBe(100);
    expect(medida.estado).toBe("COMPLETO");
  });

  /*
    Uma dispensa não pode virar cobrança porque o dado chegou assim mesmo — é o
    oposto do que dispensar quer dizer, e é o modo de falhar que faria a tela
    cobrar exatamente o que uma pessoa decidiu não cobrar.
  */
  it("o dispensado não cobra nada, mesmo com o dado chegando", () => {
    const medida = medirAtributo({
      esperado: esperado("cavalo.campo_morto", "CAVALO", 144),
      observado: observado("cavalo.campo_morto", "CAVALO", 12),
      dispensado: true,
    });
    expect(medida.estado).toBe("NAO_APLICAVEL");
    expect(medida.entidadesFaltando).toBe(0);
    expect(medida.esperado).toBe(false);
    expect(medida.dispensado).toBe(true);
  });

  /*
    O que chegou para toda a frota não é esperado por inferência nenhuma — a
    regra estrutural exige presença **abaixo** de 100%. Mostrar só o esperado o
    esconderia justo na tabela feita para dizer o que existe.
  */
  it("o que chegou sem ninguém cobrar aparece completo, e não como lacuna", () => {
    const medida = medirAtributo({
      observado: observado("cavalo.campo_novo", "CAVALO", 144),
    });
    expect(medida.estado).toBe("COMPLETO");
    expect(medida.esperado).toBe(false);
    expect(medida.entidadesFaltando).toBe(0);
    expect(medida.entidadesEsperadas).toBe(144);
  });

  it("a estreia é marcada como novo, e vem de fora", () => {
    const medida = medirAtributo({
      observado: observado("cavalo.campo_novo", "CAVALO", 144),
      novo: true,
    });
    expect(medida.estado).toBe("NOVO");
    expect(medida.novo).toBe(true);
  });

  /*
    O piso do esperado é o que já chegou. Sem ele, um atributo que veio para 144
    cavalos quando o histórico esperava 100 exibiria 144%, que é o tipo de
    número que faz quem lê parar de acreditar na tela inteira.
  */
  it("nunca passa de 100% quando a realidade supera a expectativa", () => {
    const medida = medirAtributo({
      esperado: esperado("cavalo.seguro", "CAVALO", 100),
      observado: observado("cavalo.seguro", "CAVALO", 144),
    });
    expect(medida.percentual).toBe(100);
    expect(medida.entidadesEsperadas).toBe(144);
    expect(medida.entidadesFaltando).toBe(0);
  });
});
