import { describe, expect, it } from "vitest";
import {
  compativelMaisProxima,
  composicaoDoArquivo,
  formamParDeVigencias,
  motivoSemPar,
  parDePartida,
  parReconciliado,
  rotuloDaCobertura,
  rotulosDasVigencias,
  TIPOS_DE_EQUIPAMENTO,
  TITULO_DA_OUTRA_SERIE,
  vigenciasCompativeisCom,
  vigenciasDaUnidade,
  vigenciasQueCobrem,
} from "../recorte-de-rubrica";

/**
 * O par com que a Auditoria de FINAME abre — a regressão que este arquivo
 * guarda.
 *
 * O sintoma, relatado em 15/09/2026 com a tela aberta em PERNAMBUCO: a
 * comparação abria num aviso âmbar dizendo que **não foi possível determinar a
 * causa desta falha**, com as duas pontas do seletor mostrando exatamente o
 * mesmo texto — `EMPURRADA_2_8_2026 · 16/08/2026` dos dois lados.
 *
 * Não eram a mesma vigência: eram duas unidades diferentes importadas do mesmo
 * arquivo, na mesma data. O rótulo não distingue uma da outra, e o par padrão
 * casava as duas — que é o único par que o motor recusa por construção
 * (`engine.ts`: "Escopos diferentes"). A tela abria recusada sem ninguém ter
 * escolhido nada.
 *
 * As duas funções aqui são a correção, e são strings entrando e strings
 * saindo: nada de rede, nada de React.
 */

const PERNAMBUCO = "scope-pernambuco";
const CAMACARI = "scope-camacari";

/** Uma vigência rotulável, para os casos que olham o texto do seletor. */
const comRotuloSimples = (
  id: string,
  effectiveDate: string,
  entityTypeSet: string,
  scopeHash = PERNAMBUCO,
) => ({ id, sourceLabel: id.toUpperCase(), effectiveDate, entityTypeSet, scopeHash });

const vigencia = (
  id: string,
  effectiveDate: string,
  scopeHash: string,
  entityTypeSet = "CAVALO,CARRETA",
) => ({ id, effectiveDate, scopeHash, entityTypeSet });

describe("as vigências da unidade aberta", () => {
  const acervo = [
    vigencia("pe-ago", "2026-08-16", PERNAMBUCO),
    vigencia("ca-ago", "2026-08-16", CAMACARI),
    vigencia("pe-jul", "2026-07-16", PERNAMBUCO),
  ];

  it("recorta pela unidade quando há uma aberta", () => {
    expect(vigenciasDaUnidade(acervo, PERNAMBUCO).map((v) => v.id)).toEqual([
      "pe-ago",
      "pe-jul",
    ]);
  });

  /* Sem unidade aberta não há recorte a aplicar — esconder seria inventar um. */
  it("devolve o acervo inteiro sem unidade aberta", () => {
    expect(vigenciasDaUnidade(acervo, null)).toHaveLength(3);
  });
});

/**
 * O recorte que faltava nas quatro telas de grão equipamento.
 *
 * O sintoma, relatado em 15/09/2026 na Auditoria de Lucro Fixo: o seletor
 * oferecia `setembro/2026` como "Para", e a comparação abria dizendo
 * "Coberturas diferentes: EMPURRADA_1_8_2026 cobre CAVALO e EMPURRADA_1_9_2026
 * cobre TRECHO". A vigência de setembro era o arquivo de **trecho** da mesma
 * unidade, que uma tela de placa não lê — e a lista não devia tê-la oferecido.
 */
describe("as vigências de grão equipamento", () => {
  const acervo = [
    vigencia("pe-set-trecho", "2026-09-01", PERNAMBUCO, "TRECHO"),
    vigencia("pe-ago-cavalo", "2026-08-01", PERNAMBUCO, "CAVALO"),
    vigencia("pe-ago-carreta", "2026-08-01", PERNAMBUCO, "CARRETA"),
    vigencia("pe-jul-ambos", "2026-07-16", PERNAMBUCO, "CARRETA+CAVALO"),
  ];

  it("deixa de fora a vigência que só cobre trecho", () => {
    expect(vigenciasQueCobrem(acervo, TIPOS_DE_EQUIPAMENTO).map((v) => v.id)).toEqual([
      "pe-ago-cavalo",
      "pe-ago-carreta",
      "pe-jul-ambos",
    ]);
  });

  /* Cobrir um dos tipos basta: a unidade que entrega só carreta não desaparece. */
  it("aceita quem cobre qualquer um dos tipos pedidos", () => {
    const so_cavalo_e_trecho = [vigencia("x", "2026-08-01", PERNAMBUCO, "CAVALO+TRECHO")];
    expect(vigenciasQueCobrem(so_cavalo_e_trecho, TIPOS_DE_EQUIPAMENTO)).toHaveLength(1);
  });

  /* Um recorte sem critério é a lista inteira, não a lista vazia. */
  it("não recorta nada quando a lista de tipos é vazia", () => {
    expect(vigenciasQueCobrem(acervo, [])).toHaveLength(4);
  });
});

describe("o par de partida", () => {
  /* O defeito, dito como teste: duas unidades na mesma data não formam par. */
  it("nunca casa duas unidades diferentes, mesmo de mesma data", () => {
    const par = parDePartida([
      vigencia("pe-ago", "2026-08-16", PERNAMBUCO),
      vigencia("ca-ago", "2026-08-16", CAMACARI),
    ]);

    expect(par).toBeNull();
  });

  it("escolhe as duas mais recentes da mesma unidade", () => {
    const par = parDePartida([
      vigencia("pe-jul", "2026-07-16", PERNAMBUCO),
      vigencia("ca-ago", "2026-08-16", CAMACARI),
      vigencia("pe-ago", "2026-08-16", PERNAMBUCO),
    ]);

    expect(par?.base.id).toBe("pe-jul");
    expect(par?.comparada.id).toBe("pe-ago");
  });

  /* A recusa que já existia antes desta correção, e que continua valendo. */
  it("não casa cavalo com carreta", () => {
    const par = parDePartida([
      vigencia("cavalo", "2026-08-16", PERNAMBUCO, "CAVALO"),
      vigencia("carreta", "2026-08-16", PERNAMBUCO, "CARRETA"),
    ]);

    expect(par).toBeNull();
  });

  /* Uma unidade com uma vigência só: tela vazia, não pedido recusado. */
  it("não inventa par para uma unidade com uma vigência só", () => {
    expect(parDePartida([vigencia("ca-ago", "2026-08-16", CAMACARI)])).toBeNull();
    expect(parDePartida([])).toBeNull();
  });
});

/**
 * A escolha de quem escolheu — o relato de 15/09/2026 na Auditoria de Km
 * Rodado.
 *
 * *"tem duas vigências mas não tá selecionando"*: o seletor oferecia
 * `agosto/2026` e `setembro/2026`, e clicar em qualquer uma não escrevia nada na
 * caixa. As duas cobrem trecho, mas não formam par — e o efeito que reconciliava
 * o par só deixava o estado quieto com as **duas** pontas válidas. Com uma ponta
 * na mão, ele caía no par de partida, que ali é nulo, e limpava as duas. Cada
 * clique era desfeito no quadro seguinte.
 */
describe("o par reconciliado", () => {
  const semPar = [
    vigencia("pe-set", "2026-09-01", PERNAMBUCO, "TRECHO"),
    vigencia("pe-ago", "2026-08-01", PERNAMBUCO, "CAVALO+TRECHO"),
  ];
  const comPar = [
    vigencia("pe-set", "2026-09-01", PERNAMBUCO),
    vigencia("pe-ago", "2026-08-01", PERNAMBUCO),
    vigencia("pe-jul", "2026-07-01", PERNAMBUCO),
  ];

  /* O defeito, dito como teste. */
  it("preserva a ponta escolhida mesmo sem par de partida possível", () => {
    expect(parReconciliado(semPar, { base: "", comparada: "pe-set" })).toEqual({
      base: "",
      comparada: "pe-set",
    });
  });

  it("preserva as duas pontas escolhidas à mão", () => {
    expect(parReconciliado(semPar, { base: "pe-ago", comparada: "pe-set" })).toEqual({
      base: "pe-ago",
      comparada: "pe-set",
    });
  });

  /* Meia escolha fica meia escolha: completar dispararia comparação não pedida. */
  it("não completa sozinho a outra ponta", () => {
    expect(parReconciliado(comPar, { base: "pe-jul", comparada: "" })).toEqual({
      base: "pe-jul",
      comparada: "",
    });
  });

  /* Trocar de unidade tira as duas da lista — e aí o par de partida entra. */
  it("cai no par de partida quando nenhuma ponta sobrevive à lista", () => {
    const outraUnidade = [
      vigencia("ca-set", "2026-09-01", CAMACARI),
      vigencia("ca-ago", "2026-08-01", CAMACARI),
    ];
    const par = parReconciliado(outraUnidade, { base: "pe-ago", comparada: "pe-set" });

    expect(par).toEqual({ base: "ca-ago", comparada: "ca-set" });
  });

  /* A ponta que sobrou na lista fica; a que saiu, sai — sem reabrir o par. */
  it("limpa só a ponta que saiu da lista", () => {
    const soSetembro = [vigencia("pe-set", "2026-09-01", PERNAMBUCO, "TRECHO")];
    const par = parReconciliado(soSetembro, { base: "pe-ago", comparada: "pe-set" });

    expect(par).toEqual({ base: "", comparada: "pe-set" });
  });

  it("abre no par de partida quando não há escolha nenhuma", () => {
    expect(parReconciliado(comPar, { base: "", comparada: "" })).toEqual({
      base: "pe-ago",
      comparada: "pe-set",
    });
  });
});

/**
 * Por que não há par — a outra metade do mesmo relato.
 *
 * A tela dizia *"Esta unidade não tem duas vigências de trecho para comparar"*
 * com duas na lista, as duas clicáveis. Contar quantas há é uma coisa; poder
 * emparelhá-las é outra, e a frase tem de dizer qual das duas falhou.
 */
describe("o motivo de não haver par", () => {
  it("não vê motivo nenhum quando há par", () => {
    const lista = [
      vigencia("pe-set", "2026-09-01", PERNAMBUCO),
      vigencia("pe-ago", "2026-08-01", PERNAMBUCO),
    ];

    expect(motivoSemPar(lista)).toBeNull();
  });

  it("distingue a lista vazia de uma vigência só", () => {
    expect(motivoSemPar([])).toEqual({ motivo: "LISTA_VAZIA" });
    expect(motivoSemPar([vigencia("pe-ago", "2026-08-01", PERNAMBUCO)])).toEqual({
      motivo: "UMA_SO",
    });
  });

  /* O caso relatado: duas na lista, mesma unidade, coberturas que não casam. */
  it("nomeia as coberturas quando são elas que impedem o par", () => {
    const lista = [
      vigencia("pe-set", "2026-09-01", PERNAMBUCO, "TRECHO"),
      vigencia("pe-ago", "2026-08-01", PERNAMBUCO, "CAVALO+TRECHO"),
    ];

    expect(motivoSemPar(lista)).toEqual({
      motivo: "COBERTURAS_DIFERENTES",
      coberturas: ["CAVALO+TRECHO", "TRECHO"],
    });
  });

  /* Sem unidade aberta a lista é o acervo inteiro — e aí o motivo é outro. */
  it("aponta a unidade quando é ela que impede o par", () => {
    const lista = [
      vigencia("pe-ago", "2026-08-16", PERNAMBUCO),
      vigencia("ca-ago", "2026-08-16", CAMACARI),
    ];

    expect(motivoSemPar(lista)).toEqual({ motivo: "UNIDADES_DIFERENTES" });
  });
});

/**
 * Os rótulos do seletor — a segunda metade do mesmo relato.
 *
 * *"Tô achando estranho ter várias opções com o mesmo nome"*: a lista abria com
 * cinco `EMPURRADA_1_6_2026 · 01/06/2026` idênticas, uma por unidade. Medido no
 * `EMPURRADA_Cavalo.xlsx` que originou o acervo: seis vigências × cinco
 * unidades (CAMAÇARI, CDD CEBRASA, EQUATORIAL, MANAUS, PERNAMBUCO) = trinta
 * vigências, cinco a cinco com o mesmo `sourceLabel` e a mesma data.
 */
describe("os rótulos do seletor", () => {
  const comRotulo = (
    id: string,
    sourceLabel: string,
    effectiveDate: string,
    scopeHash: string,
    extra: { entityTypeSet?: string; revision?: number } = {},
  ) => ({
    id,
    sourceLabel,
    effectiveDate,
    scopeHash,
    entityTypeSet: extra.entityTypeSet ?? "CAVALO,CARRETA",
    ...(extra.revision === undefined ? {} : { revision: extra.revision }),
  });

  const nomes = new Map([
    [PERNAMBUCO, "PERNAMBUCO"],
    [CAMACARI, "CAMAÇARI"],
  ]);
  const nomeDoEscopo = (hash: string) => nomes.get(hash) ?? null;

  /* A quinzena vem sempre, mesmo no mês que entregou uma metade só. */
  it("escreve a vigência como se fala dela, e nada mais", () => {
    const rotulos = rotulosDasVigencias(
      [
        comRotulo("pe-ago", "EMPURRADA_2_8_2026", "2026-08-16", PERNAMBUCO),
        comRotulo("pe-jul", "EMPURRADA_2_7_2026", "2026-07-16", PERNAMBUCO),
      ],
      nomeDoEscopo,
    );

    expect(rotulos.get("pe-ago")).toBe("agosto/2026 · 2ª quinzena");
    expect(rotulos.get("pe-jul")).toBe("julho/2026 · 2ª quinzena");
  });

  /* Duas entregas no mesmo mês: cada uma na sua metade, sem precisar do dia. */
  it("marca a quinzena quando o mês tem as duas entregas", () => {
    const rotulos = rotulosDasVigencias(
      [
        comRotulo("jul1", "EMPURRADA_1_7_2026", "2026-07-01", PERNAMBUCO),
        comRotulo("jul2", "EMPURRADA_2_7_2026", "2026-07-16", PERNAMBUCO),
      ],
      nomeDoEscopo,
    );

    expect(rotulos.get("jul1")).toBe("julho/2026 · 1ª quinzena");
    expect(rotulos.get("jul2")).toBe("julho/2026 · 2ª quinzena");
  });

  /* O relato, dito como teste: duas unidades, dois rótulos diferentes. */
  it("nomeia a unidade quando é ela que separa as linhas", () => {
    const rotulos = rotulosDasVigencias(
      [
        comRotulo("pe", "EMPURRADA_1_6_2026", "2026-06-01", PERNAMBUCO),
        comRotulo("ca", "EMPURRADA_1_6_2026", "2026-06-01", CAMACARI),
      ],
      nomeDoEscopo,
    );

    expect(rotulos.get("pe")).toBe("junho/2026 · 1ª quinzena · PERNAMBUCO");
    expect(rotulos.get("ca")).toBe("junho/2026 · 1ª quinzena · CAMAÇARI");
    expect(new Set(rotulos.values()).size).toBe(2);
  });

  /* A mesma unidade com cavalo e carreta na mesma data: desempata a cobertura. */
  it("desce para a cobertura quando a unidade não separa", () => {
    const rotulos = rotulosDasVigencias(
      [
        comRotulo("cav", "EMPURRADA_1_6_2026", "2026-06-01", PERNAMBUCO, {
          entityTypeSet: "CAVALO",
        }),
        comRotulo("car", "EMPURRADA_1_6_2026", "2026-06-01", PERNAMBUCO, {
          entityTypeSet: "CARRETA",
        }),
      ],
      nomeDoEscopo,
    );

    expect(rotulos.get("cav")).toBe("junho/2026 · 1ª quinzena · CAVALO");
    expect(rotulos.get("car")).toBe("junho/2026 · 1ª quinzena · CARRETA");
  });

  it("cai na revisão como último desempate", () => {
    const rotulos = rotulosDasVigencias(
      [
        comRotulo("r1", "EMPURRADA_1_6_2026", "2026-06-01", PERNAMBUCO, { revision: 1 }),
        comRotulo("r2", "EMPURRADA_1_6_2026", "2026-06-01", PERNAMBUCO, { revision: 2 }),
      ],
      nomeDoEscopo,
    );

    expect(rotulos.get("r1")).toMatch(/rev\. 1$/);
    expect(rotulos.get("r2")).toMatch(/rev\. 2$/);
  });

  /* Sem `/contexts` respondido não há nome — degrada para o que já existia. */
  it("sobrevive sem os nomes das unidades", () => {
    const rotulos = rotulosDasVigencias([
      comRotulo("pe", "EMPURRADA_1_6_2026", "2026-06-01", PERNAMBUCO),
      comRotulo("ca", "EMPURRADA_1_6_2026", "2026-06-01", CAMACARI),
    ]);

    /*
      As duas seguem idênticas, e é a verdade: sem `/contexts`, o que
      `/snapshots` entrega sobre estas duas linhas é o mesmo em tudo — mesmo
      arquivo, mesma data, mesma cobertura. Nenhum sufixo separa o que o dado
      não separa, e escrever um daria uma distinção inventada.
    */
    expect(rotulos.get("pe")).toBe("junho/2026 · 1ª quinzena");
    expect(rotulos.get("ca")).toBe("junho/2026 · 1ª quinzena");
  });

  /* O acervo real, como o arquivo o produziu: trinta linhas, trinta rótulos. */
  it("dá rótulo distinto às cinco unidades de cada vigência", () => {
    const unidades = [
      [PERNAMBUCO, "PERNAMBUCO"],
      [CAMACARI, "CAMAÇARI"],
    ] as const;
    const lista = ["EMPURRADA_1_6_2026", "EMPURRADA_2_6_2026"].flatMap((label, i) =>
      unidades.map(([hash]) =>
        comRotulo(`${label}-${hash}`, label, i === 0 ? "2026-06-01" : "2026-06-16", hash),
      ),
    );

    const rotulos = rotulosDasVigencias(lista, nomeDoEscopo);

    expect(new Set(rotulos.values()).size).toBe(lista.length);
  });
});

/**
 * A compatibilidade das duas pontas — o recorte que o seletor não fazia.
 *
 * O sintoma, relatado em 15/09/2026 na Auditoria de FINAME depois de uma
 * importação de carreta: o menu "De" mostrava número em duas linhas e nada nas
 * outras oito. As oito não eram "sem alteração" — eram incomparáveis com o
 * "Para" aberto, e o servidor nem as considerou candidatas
 * (`candidatas-do-par.ts`). A lista, porém, oferecia as dez como se fossem a
 * mesma coisa.
 *
 * `formamParDeVigencias` é a condição que faltava, e é a mesma que aquela rota usa desde
 * esta correção: uma função só para o servidor, o seletor e o motor.
 */
describe("a compatibilidade de duas pontas", () => {
  const jul = vigencia("jul-ambos", "2026-07-16", PERNAMBUCO, "CARRETA+CAVALO");
  const ago1 = vigencia("ago1-ambos", "2026-08-01", PERNAMBUCO, "CARRETA+CAVALO");
  const ago2 = vigencia("ago2-cavalo", "2026-08-16", PERNAMBUCO, "CAVALO");
  const set = vigencia("set-trecho", "2026-09-01", PERNAMBUCO, "TRECHO");
  const ca_jul = vigencia("ca-jul-ambos", "2026-07-16", CAMACARI, "CARRETA+CAVALO");
  const acervo = [jul, ago1, ago2, set, ca_jul];

  /* O critério de aceite, dito como teste. */
  it("julho com cavalo+carreta não oferece agosto só com cavalo", () => {
    expect(formamParDeVigencias(ago2, jul)).toBe(false);
    expect(vigenciasCompativeisCom(acervo, jul).map((v) => v.id)).toEqual([
      "ago1-ambos",
    ]);
  });

  it("aceita o par de mesma cobertura e mesma unidade", () => {
    expect(formamParDeVigencias(ago1, jul)).toBe(true);
  });

  /* As outras duas recusas de `engine.ts`, na mesma função. */
  it("recusa a outra unidade e recusa a vigência contra si mesma", () => {
    expect(formamParDeVigencias(ca_jul, jul)).toBe(false);
    expect(formamParDeVigencias(jul, jul)).toBe(false);
  });

  it("nunca deixa uma vigência de trecho entrar num par de equipamento", () => {
    expect(vigenciasCompativeisCom(acervo, jul)).not.toContainEqual(set);
    expect(formamParDeVigencias(set, ago2)).toBe(false);
  });

  /* Sem referência não há critério, e um recorte sem critério é a lista toda. */
  it("não recorta nada sem uma ponta escolhida", () => {
    expect(vigenciasCompativeisCom(acervo, null)).toHaveLength(5);
  });

  /* A cobertura que existe numa vigência só: a lista vazia que vira frase. */
  it("devolve lista vazia quando a cobertura não tem par no acervo", () => {
    expect(vigenciasCompativeisCom(acervo, ago2)).toEqual([]);
    expect(compativelMaisProxima(acervo, ago2)).toBeNull();
  });
});

describe("a compatível mais próxima", () => {
  const acervo = [
    vigencia("mai", "2026-05-01", PERNAMBUCO, "CAVALO"),
    vigencia("jun", "2026-06-01", PERNAMBUCO, "CAVALO"),
    vigencia("jul", "2026-07-01", PERNAMBUCO, "CAVALO"),
    vigencia("jul-ambos", "2026-07-01", PERNAMBUCO, "CARRETA+CAVALO"),
    vigencia("ago-ca", "2026-08-01", CAMACARI, "CAVALO"),
  ];

  it("escolhe a vizinha no tempo, dentro da cobertura e da unidade", () => {
    const ref = acervo.find((v) => v.id === "jul")!;
    expect(compativelMaisProxima(acervo, ref)?.id).toBe("jun");
  });

  /* Empate entre a anterior e a posterior: fica a anterior — "De" é a origem.

     As datas são escolhidas a dedo porque mês não é unidade de distância: a
     primeira versão deste caso usou maio/junho/julho supondo empate, e maio está
     a 31 dias de junho enquanto julho está a 30. A função acertou e o teste é
     que media outra coisa. Catorze dias de cada lado não deixam dúvida. */
  it("desempata pela mais antiga quando as duas estão à mesma distância", () => {
    const quinzenas = [
      vigencia("antes", "2026-06-01", PERNAMBUCO, "CAVALO"),
      vigencia("ref", "2026-06-15", PERNAMBUCO, "CAVALO"),
      vigencia("depois", "2026-06-29", PERNAMBUCO, "CAVALO"),
    ];
    expect(compativelMaisProxima(quinzenas, quinzenas[1]!)?.id).toBe("antes");
  });

  it("não atravessa a cobertura nem a unidade para achar vizinha", () => {
    const ref = acervo.find((v) => v.id === "jul-ambos")!;
    expect(compativelMaisProxima(acervo, ref)).toBeNull();
  });
});

describe("a cobertura escrita como quem fala dela", () => {
  /* O banco grava em ordem alfabética; a frase é na ordem em que se diz. */
  it("põe o cavalo antes da carreta", () => {
    expect(rotuloDaCobertura("CARRETA+CAVALO")).toBe("Cavalo + Carreta");
  });

  it("escreve a cobertura de um tipo só", () => {
    expect(rotuloDaCobertura("CAVALO")).toBe("Cavalo");
    expect(rotuloDaCobertura("TRECHO")).toBe("Trecho");
  });

  it("não inventa texto para uma cobertura vazia", () => {
    expect(rotuloDaCobertura("")).toBe("");
  });
});

/**
 * A lista que cada aba oferece — o recorte que subiu para cima do par.
 *
 * As quatro auditorias de grão equipamento passaram a abrir por série: a aba
 * Cavalo só oferece vigências que têm cavalo, a de Carreta só as que têm
 * carreta, e "Cavalo + Carreta" o acervo de equipamento inteiro. A função é a
 * mesma que já recortava o acervo de trecho para fora; o que muda é o
 * argumento, e é isso que estes casos prendem — porque a resposta certa não é
 * óbvia para a vigência que traz os **dois** equipamentos.
 */
describe("a lista de vigências de cada aba", () => {
  const acervo = [
    vigencia("cavalo", "2026-08-16", PERNAMBUCO, "CAVALO"),
    vigencia("carreta", "2026-08-16", PERNAMBUCO, "CARRETA"),
    vigencia("ambos", "2026-07-16", PERNAMBUCO, "CARRETA+CAVALO"),
    vigencia("trecho", "2026-09-01", PERNAMBUCO, "TRECHO"),
  ];

  /* A decisão que importa: a vigência que traz os dois **tem** cavalo, e some
     da aba Cavalo se o teste for de igualdade em vez de pertinência. */
  it("a aba Cavalo mostra também a vigência que traz os dois", () => {
    expect(vigenciasQueCobrem(acervo, ["CAVALO"]).map((v) => v.id)).toEqual([
      "cavalo",
      "ambos",
    ]);
  });

  it("a aba Carreta mostra também a vigência que traz os dois", () => {
    expect(vigenciasQueCobrem(acervo, ["CARRETA"]).map((v) => v.id)).toEqual([
      "carreta",
      "ambos",
    ]);
  });

  it("a aba Cavalo + Carreta mostra o acervo de equipamento inteiro", () => {
    expect(vigenciasQueCobrem(acervo, TIPOS_DE_EQUIPAMENTO).map((v) => v.id)).toEqual([
      "cavalo",
      "carreta",
      "ambos",
    ]);
  });

  /* Nenhuma aba de equipamento mostra trecho — a tela não sabe lê-lo. */
  it("nenhuma aba oferece a vigência de trecho", () => {
    for (const aba of [["CAVALO"], ["CARRETA"], TIPOS_DE_EQUIPAMENTO]) {
      expect(vigenciasQueCobrem(acervo, aba).map((v) => v.id)).not.toContain("trecho");
    }
  });

  /**
   * Dentro da aba, o par ainda precisa ser comparável.
   *
   * A aba Cavalo mostra a série pura e a que traz os dois, e o motor não compara
   * uma com a outra — a cobertura tem de bater exatamente (`engine.ts`). É por
   * isso que o recorte da aba **não** substitui o do seletor: eles fazem
   * perguntas diferentes e os dois continuam necessários.
   */
  it("não dispensa o recorte de compatibilidade dentro da aba", () => {
    const daAba = vigenciasQueCobrem(acervo, ["CAVALO"]);
    const pura = daAba.find((v) => v.id === "cavalo")!;

    expect(vigenciasCompativeisCom(daAba, pura)).toEqual([]);
  });
});

/**
 * Como o arquivo veio composto — a frase que substituiu "Outra cobertura".
 *
 * O defeito, relatado em 15/09/2026: *"pq existe ni filtro outra cobertura?"*.
 * Dentro da aba **Cavalo**, o seletor abria um grupo chamado "Outra cobertura"
 * cujas linhas diziam "Cavalo" — a tela se contradizendo em voz alta. As duas
 * séries têm cavalo; o que as separa é o arquivo de origem ter vindo só com ele
 * ou com a carreta junto, e o motor comparar a vigência inteira.
 *
 * A frase ficou onde resolve — **na linha**, ao lado de cada vigência. O
 * cabeçalho do grupo chegou a repeti-la ("Como o equipamento veio na
 * vigência") e foi relatado em 16/09/2026 pelo motivo oposto: *"confunde mais
 * que ajuda"*. Um cabeçalho que repete a linha vira uma segunda lista; hoje ele
 * diz o que o clique faz, e quem o guarda é o teste logo abaixo.
 */
describe("como o arquivo veio composto", () => {
  it("diz somente, quando o equipamento da aba veio sozinho", () => {
    expect(composicaoDoArquivo("CAVALO", "CAVALO")).toBe("Somente cavalo");
    expect(composicaoDoArquivo("CARRETA", "CARRETA")).toBe("Somente carreta");
  });

  /* A mesma vigência, lida da pergunta que está sendo feita — é isso que o
     rótulo fixo não fazia. */
  it("põe o equipamento da aba na frente, e o que veio junto atrás", () => {
    expect(composicaoDoArquivo("CARRETA+CAVALO", "CAVALO")).toBe("Cavalo com carreta");
    expect(composicaoDoArquivo("CARRETA+CAVALO", "CARRETA")).toBe("Carreta com cavalo");
  });

  /* Sem aba aberta, a ordem é a de quem fala: o cavalo puxa a carreta. */
  it("sem foco, escreve na ordem em que se fala", () => {
    expect(composicaoDoArquivo("CARRETA+CAVALO")).toBe("Cavalo com carreta");
    expect(composicaoDoArquivo("CAVALO")).toBe("Somente cavalo");
  });

  /* Um foco que não está na vigência não manda na frase — ela descreve o que
     está lá, não o que se procurava. */
  it("ignora um foco que a vigência não tem", () => {
    expect(composicaoDoArquivo("CAVALO", "CARRETA")).toBe("Somente cavalo");
  });

  it("não inventa frase para uma cobertura vazia", () => {
    expect(composicaoDoArquivo("")).toBe("");
  });

  /* O título do grupo diz o que o clique faz, e não como o arquivo veio: o
     critério já está escrito em cada linha, pela função acima. */
  it("o título do grupo oferece a troca de série", () => {
    expect(TITULO_DA_OUTRA_SERIE).toBe("Trocar para outra série");
  });
});

/**
 * O NOME DE UMA VIGÊNCIA NÃO DEPENDE DE ONDE SE ESTÁ OLHANDO.
 *
 * O defeito, relatado em 15/09/2026 com um print do campo "Para": *"lembre-se
 * que quero esse tipo de formatação dentro do filtro"*. As abas de equipamento
 * passaram a recortar a lista de vigências, e o recorte foi entregue também a
 * `rotulosDasVigencias` — que decide a marca da quinzena olhando as **outras
 * datas da lista**. Resultado medido: a mesma vigência era "agosto/2026 · 1ª
 * quinzena" na aba Cavalo + Carreta e virava "agosto/2026" na aba Carreta,
 * porque a outra quinzena do mês não tem carreta e sumia da lista.
 *
 * A correção da época está nas quatro páginas: os rótulos saem de
 * `daUnidadeTodas`, o acervo de equipamento da unidade, e só a lista do seletor
 * é recortada pela aba. Ela continua valendo e continua provada aqui.
 *
 * O que mudou desde então foi a régua da marca: a quinzena deixou de ser um
 * desempate e passou a ser parte do nome da vigência, sempre — ela sai do dia
 * em que a vigência passou a valer, e não da companhia que ela tem na lista.
 * O sintoma daquele print virou impossível de produzir por este caminho: com ou
 * sem recorte, `ago1` é a 1ª quinzena de agosto. O dia, que é o único pedaço da
 * marca que ainda depende das outras datas, segue sensível ao recorte — e é o
 * que o segundo caso fixa.
 */
describe("o rótulo e a lista que o produz", () => {
  const acervo = [
    comRotuloSimples("ago1", "2026-08-01", "CARRETA+CAVALO"),
    comRotuloSimples("ago2", "2026-08-16", "CAVALO"),
    comRotuloSimples("jul", "2026-07-16", "CARRETA+CAVALO"),
  ];

  it("marca a quinzena quando o acervo da unidade tem as duas entregas", () => {
    expect(rotulosDasVigencias(acervo).get("ago1")).toBe("agosto/2026 · 1ª quinzena");
  });

  /* A lista da aba Carreta: a outra quinzena de agosto não tem carreta. */
  it("a quinzena sobrevive ao recorte da aba — ela é do dia, não da lista", () => {
    const daAba = vigenciasQueCobrem(acervo, ["CARRETA"]);

    expect(rotulosDasVigencias(daAba).get("ago1")).toBe("agosto/2026 · 1ª quinzena");
  });

  /*
    O dia continua sendo do contexto — e é por isso que a régua das páginas
    segue valendo.

    Duas entregas na mesma metade do mês precisam do dia para se distinguir, e
    saber que são duas é uma pergunta sobre a **lista**. Recortada pela aba, a
    vizinha some e o dia deixa de ser escrito: as duas linhas voltariam a se
    chamar igual se o recorte alimentasse o rótulo.
  */
  it("o dia, esse, ainda depende da lista inteira", () => {
    const mesmaMetade = [
      comRotuloSimples("ago1", "2026-08-01", "CARRETA+CAVALO"),
      comRotuloSimples("ago2", "2026-08-02", "CAVALO"),
    ];

    expect(rotulosDasVigencias(mesmaMetade).get("ago1")).toBe(
      "agosto/2026 · 1ª quinzena · dia 01",
    );

    const daAba = vigenciasQueCobrem(mesmaMetade, ["CARRETA"]);
    expect(rotulosDasVigencias(daAba).get("ago1")).toBe("agosto/2026 · 1ª quinzena");
  });
});
