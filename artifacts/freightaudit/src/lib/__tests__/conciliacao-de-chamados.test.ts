import { describe, expect, it } from "vitest";
import {
  alcanceDosChamados,
  avisoDaConciliacao,
  avisoPorParametro,
  barrasDaSituacao,
  barrasPorParametro,
  diferencaPorParametro,
  enderecoDasLinhas,
  enderecoPorParametro,
  graoDaUrl,
  graoNaUrl,
  pendencias,
  pendenciasPorParametro,
  percentualConciliado,
  percentualPorParametro,
  resumoDasOperacoes,
  rotuloDaComparacao,
  rotuloDoEnvio,
  type LinhaPorParametro,
  type ResumoDaConciliacao,
  type ResumoPorParametro,
} from "@/lib/conciliacao-de-chamados";

/**
 * As contas da Conciliação de Chamados.
 *
 * A tela afirma quatro coisas na cara de quem opera — quanto está conciliado,
 * quanto não está, quantas alterações cada lado trouxe e se os dois lados
 * sequer falam da mesma unidade. O que este arquivo prende é que nenhuma delas
 * se deixa mentir pelos três estados em que uma leitura mal desenhada mentiria:
 * **sem resposta ainda**, **sem material de um dos lados** e **material dos
 * dois, mas de unidades diferentes**.
 */

function resumo(parcial: Partial<ResumoDaConciliacao> = {}): ResumoDaConciliacao {
  return {
    changeSetId: "cs",
    ticketImportId: "ti",
    planilha: { alteracoes: 10, pares: 10, placas: 4, foraDaConciliacao: 0 },
    chamados: { alteracoes: 8, pares: 8, placas: 3, foraDaConciliacao: 0 },
    pares: 12,
    conciliadas: 6,
    divergentes: 2,
    semChamado: 3,
    semAlteracao: 1,
    diferenca: 2,
    placasEmComum: 3,
    tipos: [{ entityType: "CAVALO", pares: 12 }],
    ...parcial,
  };
}

describe("a barra de conciliação", () => {
  it("mede sobre o par, e não sobre a alteração da planilha", () => {
    /*
      Seis conciliadas de doze pares é 50%. Medido sobre as dez alterações da
      planilha daria 60% — um número que sobe justamente quando a fila do outro
      lado cresce, que é o defeito que o denominador por par existe para evitar.
    */
    expect(percentualConciliado(resumo())).toBe(50);
  });

  it("devolve zero sem par nenhum, e não NaN", () => {
    expect(
      percentualConciliado(resumo({ pares: 0, conciliadas: 0 })),
    ).toBe(0);
  });

  it("não inventa número enquanto a resposta não chegou", () => {
    expect(percentualConciliado(null)).toBe(0);
    expect(pendencias(null)).toBeNull();
  });

  it("conta como pendência tudo o que não está conciliado", () => {
    /* Divergente, sem chamado e sem alteração: as três são trabalho. */
    expect(pendencias(resumo())).toBe(6);
  });
});

describe("as quatro barras", () => {
  it("aparecem sempre as quatro, mesmo zeradas", () => {
    const barras = barrasDaSituacao(resumo({ divergentes: 0 }));
    expect(barras.map((b) => b.situacao)).toEqual([
      "CONCILIADA",
      "DIVERGENTE",
      "SEM_CHAMADO",
      "SEM_ALTERACAO",
    ]);
    expect(barras.find((b) => b.situacao === "DIVERGENTE")!.pares).toBe(0);
  });

  it("soma cem por cento entre elas", () => {
    const barras = barrasDaSituacao(resumo());
    const total = barras.reduce((soma, b) => soma + b.proporcao, 0);
    expect(total).toBeCloseTo(100, 6);
  });

  it("abre zerada, e não quebrada, antes da resposta", () => {
    const barras = barrasDaSituacao(null);
    expect(barras).toHaveLength(4);
    expect(barras.every((b) => b.pares === 0 && b.proporcao === 0)).toBe(true);
  });
});

describe("o aviso", () => {
  it("cala quando os dois lados têm material e se encontram", () => {
    expect(avisoDaConciliacao(resumo())).toBeNull();
  });

  /*
    O caso que motivou o aviso: os dois lados cheios e nenhuma placa em comum. É
    o retrato de conciliar o envio de uma unidade contra a vigência de outra, e
    sem ele a tela publicaria dezenas de pendências que não são pendências.
  */
  it("denuncia unidades diferentes por placas em comum, e não por palpite", () => {
    expect(avisoDaConciliacao(resumo({ placasEmComum: 0 }))).toBe(
      "UNIDADES_DIFERENTES",
    );
  });

  it("distingue lado vazio de unidade errada", () => {
    expect(
      avisoDaConciliacao(
        resumo({
          chamados: { alteracoes: 0, pares: 0, placas: 0, foraDaConciliacao: 4 },
          placasEmComum: 0,
        }),
      ),
    ).toBe("SEM_CHAMADOS");

    expect(
      avisoDaConciliacao(
        resumo({
          planilha: { alteracoes: 0, pares: 0, placas: 0, foraDaConciliacao: 0 },
          placasEmComum: 0,
        }),
      ),
    ).toBe("SEM_ALTERACOES");
  });

  /*
    O diagnóstico que estava errado, e o arquivo que o mostrou.

    Medido no export real de agosto/setembro de 2026 contra a base do mesmo
    período: 6 das 3.400 alterações de chamado têm placa, e nenhuma delas cai
    numa placa da comparação. `placasEmComum` é zero — e a causa **não** é a
    unidade, é o arquivo não trazer placa. A tela mandava "troque um dos dois
    lados", e trocar não resolveria: nenhum outro envio deste formato traz placa.
  */
  it("não confunde arquivo sem placa com unidade errada", () => {
    expect(
      avisoDaConciliacao(
        resumo({
          planilha: { alteracoes: 103, pares: 103, placas: 64, foraDaConciliacao: 48 },
          chamados: { alteracoes: 6, pares: 1, placas: 1, foraDaConciliacao: 3394 },
          placasEmComum: 0,
        }),
      ),
    ).toBe("POUCO_ALCANCE");
  });

  /*
    E a régua é a maioria, não a existência: um envio saudável tem alterações
    fora da conciliação — parâmetro que o dicionário não conhece —, e isso
    sozinho não pode roubar o aviso de unidade, que é o que resolve um recorte
    de verdade mal escolhido.
  */
  it("continua acusando unidade quando o envio é lido em sua maior parte", () => {
    expect(
      avisoDaConciliacao(
        resumo({
          chamados: { alteracoes: 8, pares: 8, placas: 3, foraDaConciliacao: 2 },
          placasEmComum: 0,
        }),
      ),
    ).toBe("UNIDADES_DIFERENTES");
  });

  it("não avisa nada enquanto a resposta não chegou", () => {
    expect(avisoDaConciliacao(null)).toBeNull();
  });
});

describe("o endereço da lista", () => {
  const base = {
    escopo: "hash-da-unidade",
    serie: undefined as string | null | undefined,
    changeSetId: "cs-1",
    ticketImportId: "ti-1",
    somenteVigenciaComparada: false,
    situacao: null,
    tipo: null,
    busca: "",
    pagina: 1,
    porPagina: 50,
  };

  it("leva o recorte inteiro, e a unidade aberta junto", () => {
    const q = new URLSearchParams(enderecoDasLinhas(base).split("?")[1]);
    expect(q.get("scopeHash")).toBe("hash-da-unidade");
    expect(q.get("changeSetId")).toBe("cs-1");
    expect(q.get("ticketImportId")).toBe("ti-1");
    expect(q.get("limit")).toBe("50");
    expect(q.get("offset")).toBe("0");
    /* O que não foi escolhido não vira parâmetro: um filtro vazio no endereço é
       um filtro que o servidor teria de aprender a ignorar. */
    expect(q.has("situacao")).toBe(false);
    expect(q.has("search")).toBe(false);
    expect(q.has("somenteVigenciaComparada")).toBe(false);
    /* Série `undefined` é "todas": ela não vira parâmetro. */
    expect(q.has("serie")).toBe(false);
  });

  /*
    A unidade dos chamados viaja como série, e a série **indeterminada** viaja
    como rótulo — nunca como parâmetro vazio. Um `?serie=` em branco não
    distingue "sem recorte" de "os envios que não disseram de onde vieram", e as
    duas coisas dão telas diferentes.
  */
  it("distingue a série indeterminada de não ter recorte de série", () => {
    const comUnidade = new URLSearchParams(
      enderecoDasLinhas({ ...base, serie: "CAMAÇARI" }).split("?")[1],
    );
    expect(comUnidade.get("serie")).toBe("CAMAÇARI");

    const indeterminada = new URLSearchParams(
      enderecoDasLinhas({ ...base, serie: null }).split("?")[1],
    );
    expect(indeterminada.get("serie")).toBe("@sem-serie");
  });

  it("traduz a página em offset", () => {
    const q = new URLSearchParams(
      enderecoDasLinhas({ ...base, pagina: 3 }).split("?")[1],
    );
    expect(q.get("offset")).toBe("100");
  });

  it("manda a busca sem os espaços das pontas, e só quando há busca", () => {
    const comEspaco = new URLSearchParams(
      enderecoDasLinhas({ ...base, busca: "  AAA1A11 " }).split("?")[1],
    );
    expect(comEspaco.get("search")).toBe("AAA1A11");

    const soEspaco = new URLSearchParams(
      enderecoDasLinhas({ ...base, busca: "   " }).split("?")[1],
    );
    expect(soEspaco.has("search")).toBe(false);
  });
});

describe("os rótulos do seletor", () => {
  /*
    A unidade abre o rótulo do envio porque é o que decide se ele serve: dois
    envios do mesmo dia costumam ser unidades diferentes, e um seletor sem ela
    ofereceria duas linhas indistinguíveis para a única escolha que importa.
  */
  it("nomeia a unidade do envio antes do arquivo", () => {
    expect(
      rotuloDoEnvio({
        id: "ti",
        filename: "Chamados_CAMACARI.xlsx",
        receivedAt: "2026-09-03T00:00:00.000Z",
        ticketCount: 4,
        serie: "CAMAÇARI",
      }),
    ).toMatch(/^CAMAÇARI · Chamados_CAMACARI\.xlsx — /);
  });

  it("diz que o arquivo não nomeou unidade, em vez de deixar em branco", () => {
    expect(
      rotuloDoEnvio({
        id: "ti",
        filename: "Chamados.xlsx",
        receivedAt: "2026-09-03T00:00:00.000Z",
        ticketCount: 4,
        serie: null,
      }),
    ).toMatch(/^sem unidade no arquivo · /);
  });

  it("lê a comparação como uma seta, da vigência anterior para a nova", () => {
    expect(
      rotuloDaComparacao({
        id: "cs",
        rotuloA: "2026-07",
        rotuloB: "2026-08",
        dataB: "2026-08-01",
        scopeHash: null,
      }),
    ).toBe("2026-07 → 2026-08");
  });

  it("não deixa buraco quando um dos lados não tem rótulo", () => {
    expect(
      rotuloDaComparacao({
        id: "cs",
        rotuloA: null,
        rotuloB: "2026-08",
        dataB: null,
        scopeHash: null,
      }),
    ).toBe("? → 2026-08");
  });
});


/**
 * O SEGUNDO GRÃO — por parâmetro.
 *
 * Ele existe porque o export real do Freightech quase nunca nomeia a placa, e o
 * que este bloco prende é que a tela não o vende como se fosse o outro: a
 * unidade de contagem é o parâmetro, o alcance do envio é dito, e o grão viaja
 * no endereço para que o aviso do primeiro possa **levar** até ele.
 */

function porParametro(
  parcial: Partial<ResumoPorParametro> = {},
): ResumoPorParametro {
  return {
    changeSetId: "cs",
    ticketImportId: "ti",
    parametros: 17,
    conciliados: 1,
    divergentes: 0,
    semChamado: 3,
    semAlteracao: 13,
    alteracoesNaPlanilha: 103,
    chamados: 153,
    chamadosForaDaConciliacao: 3247,
    ...parcial,
  };
}

describe("o grão no endereço", () => {
  it("lê `parametro` e trata qualquer outra coisa como o grão por ativo", () => {
    expect(graoDaUrl("parametro")).toBe("PARAMETRO");
    expect(graoDaUrl(null)).toBe("ATIVO");
    /* Um valor inventado não pode abrir uma tela que ninguém pediu. */
    expect(graoDaUrl("qualquer-coisa")).toBe("ATIVO");
  });

  it("some da URL no padrão, e só aparece quando é o outro grão", () => {
    expect(graoNaUrl("ATIVO")).toBeNull();
    expect(graoNaUrl("PARAMETRO")).toBe("parametro");
  });
});

describe("as contas por parâmetro", () => {
  it("mede a barra sobre o parâmetro, e não sobre a alteração", () => {
    /* Um conciliado de dezessete parâmetros. Medido sobre as 103 alterações da
       planilha o número não teria significado nenhum: o denominador de uma
       barra tem de ser a mesma coisa que ela conta. */
    expect(percentualPorParametro(porParametro())).toBeCloseTo(
      (1 / 17) * 100,
      6,
    );
    expect(percentualPorParametro(porParametro({ parametros: 0 }))).toBe(0);
    expect(percentualPorParametro(null)).toBe(0);
  });

  it("conta como pendência tudo o que não fecha", () => {
    expect(pendenciasPorParametro(porParametro())).toBe(16);
    expect(pendenciasPorParametro(null)).toBeNull();
  });

  /*
    A diferença deste grão é a planilha menos os chamados **conciliáveis** — que
    é outra conta que a do grão por ativo, porque o denominador dos chamados é
    outro. Elas não se comparam, e é por isso que moram em funções separadas.
  */
  it("publica a diferença de contagem, e não inventa antes da resposta", () => {
    expect(diferencaPorParametro(porParametro())).toBe(-50);
    expect(diferencaPorParametro(null)).toBeNull();
  });

  /*
    O número que impede a tela de parecer completa. No export real são 153 de
    3.400: quatro por cento.
  */
  it("diz que fração do envio esta leitura alcança", () => {
    expect(alcanceDosChamados(porParametro())).toBeCloseTo(
      (153 / 3400) * 100,
      6,
    );
  });

  it("não divide por zero quando o envio não tem alteração nenhuma", () => {
    expect(
      alcanceDosChamados(
        porParametro({ chamados: 0, chamadosForaDaConciliacao: 0 }),
      ),
    ).toBeNull();
    expect(alcanceDosChamados(null)).toBeNull();
  });

  it("abre as quatro barras, e elas somam cem por cento", () => {
    const barras = barrasPorParametro(porParametro());
    expect(barras.map((b) => b.situacao)).toEqual([
      "CONCILIADA",
      "DIVERGENTE",
      "SEM_CHAMADO",
      "SEM_ALTERACAO",
    ]);
    expect(barras.reduce((soma, b) => soma + b.proporcao, 0)).toBeCloseTo(100, 6);
    expect(barrasPorParametro(null).every((b) => b.pares === 0)).toBe(true);
  });

  it("avisa por lado vazio, e nunca por unidade", () => {
    expect(avisoPorParametro(porParametro())).toBeNull();
    expect(avisoPorParametro(porParametro({ chamados: 0 }))).toBe("SEM_CHAMADOS");
    expect(avisoPorParametro(porParametro({ alteracoesNaPlanilha: 0 }))).toBe(
      "SEM_ALTERACOES",
    );
    expect(avisoPorParametro(null)).toBeNull();
  });
});

describe("as operações de um parâmetro", () => {
  const linha = (
    operacoes: LinhaPorParametro["operacoes"],
  ): LinhaPorParametro => ({
    attributeCode: "cavalo.placa_carreta",
    attributeName: "placaCarreta",
    entityType: "CAVALO",
    situacao: "CONCILIADA",
    alteracoesNaPlanilha: 22,
    placasNaPlanilha: 22,
    chamados: 22,
    chamadosComPlaca: 0,
    operacoes,
    parameterLabel: "placaCarreta",
    diferenca: 0,
  });

  /*
    22 SET e 71 FORM_THIS contam igual num total e não querem dizer a mesma
    coisa: um é troca de valor, o outro é recálculo de fórmula que pode não
    mexer em valor nenhum. A linha diz qual é qual.
  */
  it("escreve o que o chamado fez, e não só quantos foram", () => {
    expect(resumoDasOperacoes(linha([{ changeKind: "SET", chamados: 22 }]))).toBe(
      "22 SET",
    );
    expect(
      resumoDasOperacoes(
        linha([
          { changeKind: "ADD", chamados: 24 },
          { changeKind: "REM", chamados: 24 },
        ]),
      ),
    ).toBe("24 ADD · 24 REM");
  });

  it("nomeia a operação ausente em vez de deixar um número solto", () => {
    expect(resumoDasOperacoes(linha([{ changeKind: null, chamados: 3 }]))).toBe(
      "3 sem operação",
    );
  });

  it("devolve texto vazio quando não há operação, e não “undefined”", () => {
    expect(resumoDasOperacoes(linha([]))).toBe("");
  });
});

describe("o endereço da lista por parâmetro", () => {
  const base = {
    escopo: "hash-da-unidade",
    serie: undefined as string | null | undefined,
    changeSetId: "cs-1",
    ticketImportId: "ti-1",
    somenteVigenciaComparada: true,
    situacao: null,
    tipo: null,
    busca: "  placa_carreta ",
    pagina: 2,
    porPagina: 50,
  };

  it("vai para a rota do segundo grão, com o mesmo recorte da primeira", () => {
    const endereco = enderecoPorParametro(base);
    expect(endereco.startsWith("/conciliacao-de-chamados/por-parametro/linhas?")).toBe(
      true,
    );

    const q = new URLSearchParams(endereco.split("?")[1]);
    expect(q.get("changeSetId")).toBe("cs-1");
    expect(q.get("ticketImportId")).toBe("ti-1");
    expect(q.get("scopeHash")).toBe("hash-da-unidade");
    expect(q.get("somenteVigenciaComparada")).toBe("1");
    expect(q.get("search")).toBe("placa_carreta");
    expect(q.get("offset")).toBe("50");
  });

  /*
    As duas listas partem do mesmo recorte — é o que faz os dois grãos falarem
    da mesma comparação e do mesmo envio. Só o caminho muda.
  */
  it("difere da lista por ativo só no caminho", () => {
    const porAtivo = enderecoDasLinhas(base);
    const porParam = enderecoPorParametro(base);
    expect(porParam.split("?")[1]).toBe(porAtivo.split("?")[1]);
  });
});
