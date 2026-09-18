import { describe, expect, it } from "vitest";
import {
  avisoDeCobertura,
  comSinal,
  numeroOuTraco,
  percentual,
  pontosDoGrafico,
  recusaDoEscopo,
  rotuloDaChave,
  rotuloCurto,
  rotuloLongo,
  sentido,
  ultimaMedida,
  unidadesSemRelatorio,
  type QuinzenaDaFrota,
} from "../ativos-e-parados";

/**
 * A apresentação de Ativos e Parados, sem componente e sem servidor.
 *
 * O que ela prende é o que dá errado calado nesta tela: um `null` renderizado
 * como `0` — no número, no gráfico, na variação —, e o mês 1-indexado do banco
 * escrito com o rótulo do mês anterior.
 */

function quinzena(parcial: Partial<QuinzenaDaFrota> = {}): QuinzenaDaFrota {
  return {
    competencia: "2026-07-Q2",
    ano: 2026,
    mes: 7,
    quinzena: 2,
    inicio: "2026-07-16",
    fim: "2026-07-31",
    ativos: 118,
    parados: 12,
    total: 130,
    percentualParado: 12 / 130,
    emAmbasAsSituacoes: 0,
    cobertura: {
      unidades: ["443"],
      comFrotaAtiva: ["443"],
      comFrotaInativa: ["443"],
    },
    variacao: null,
    ...parcial,
  };
}

describe("rótulos", () => {
  it("escreve o mês certo — o banco é 1-indexado e o vetor não", () => {
    expect(rotuloCurto({ mes: 7, ano: 2026, quinzena: 2 })).toBe(
      "jul/26 · 2ªq",
    );
    expect(rotuloLongo({ mes: 1, ano: 2026, quinzena: 1 })).toBe(
      "jan/2026, 1ª quinzena",
    );
    expect(rotuloLongo({ mes: 12, ano: 2026, quinzena: 2 })).toBe(
      "dez/2026, 2ª quinzena",
    );
  });
});

describe("números", () => {
  it("ausência é travessão, e zero é zero", () => {
    expect(numeroOuTraco(null)).toBe("—");
    expect(numeroOuTraco(0)).toBe("0");
    expect(numeroOuTraco(1234)).toBe("1.234");
  });

  it("percentual ausente não vira 0%", () => {
    expect(percentual(null)).toBe("—");
    expect(percentual(0)).toBe("0%");
    expect(percentual(0.125)).toBe("12,5%");
  });

  it("a variação carrega o sinal, e a ausência não vira número", () => {
    expect(comSinal(3)).toBe("+3");
    expect(comSinal(-2)).toBe("-2");
    expect(comSinal(0)).toBe("0");
    expect(comSinal(null)).toBeNull();
  });

  it("o sentido separa ausência de estabilidade", () => {
    expect(sentido(null)).toBe("semDado");
    expect(sentido(0)).toBe("igual");
    expect(sentido(1)).toBe("subiu");
    expect(sentido(-1)).toBe("desceu");
  });
});

describe("cobertura", () => {
  it("não avisa nada quando as duas fontes vieram de todas as unidades", () => {
    expect(avisoDeCobertura(quinzena())).toBeNull();
  });

  it("nomeia a unidade e o relatório que faltou", () => {
    const sem = quinzena({
      parados: null,
      total: null,
      percentualParado: null,
      cobertura: {
        unidades: ["443", "999"],
        comFrotaAtiva: ["443", "999"],
        comFrotaInativa: ["443"],
      },
    });

    expect(unidadesSemRelatorio(sem, "INATIVA")).toEqual(["999"]);
    expect(unidadesSemRelatorio(sem, "ATIVA")).toEqual([]);
    expect(avisoDeCobertura(sem)).toContain("a frota parada de 999");
    expect(avisoDeCobertura(sem)).toContain("não é zero");
  });
});

describe("a série na tela", () => {
  it("o gráfico recebe null, e não zero — é o que apaga a barra", () => {
    const pontos = pontosDoGrafico([
      quinzena({
        competencia: "2026-07-Q1",
        quinzena: 1,
        ativos: 100,
        parados: 10,
      }),
      quinzena({ competencia: "2026-07-Q2", parados: null }),
    ]);

    expect(pontos[0]).toMatchObject({
      rotulo: "jul/26 · 1ªq",
      ativos: 100,
      parados: 10,
    });
    expect(pontos[1]!.parados).toBeNull();
  });

  it("a manchete é a última quinzena medida, e não a última aberta", () => {
    const serie = [
      quinzena({ competencia: "2026-07-Q1", quinzena: 1 }),
      quinzena({
        competencia: "2026-07-Q2",
        ativos: null,
        parados: null,
        total: null,
        percentualParado: null,
        cobertura: {
          unidades: ["443"],
          comFrotaAtiva: [],
          comFrotaInativa: [],
        },
      }),
    ];

    expect(ultimaMedida(serie)!.competencia).toBe("2026-07-Q1");
    expect(ultimaMedida([])).toBeNull();
  });
});

/**
 * O ESCOPO QUE NÃO RESOLVE — o que a tela diz quando não sabe de quem ela é.
 *
 * Esta tela passou a honrar a unidade da lateral, e a travessia até a frota tem
 * um lugar por onde falhar que nenhuma outra tela de escopo tem: o Fechamento
 * endereça a competência pela unidade **cadastrada**, e quem liga o
 * `scope_hash` da lateral a ela é o cadastro de Remuneração. Sem essa
 * associação, a resposta honesta não é o acervo inteiro — é dizer qual
 * associação falta.
 *
 * O que estes testes prendem é o que separa os dois estados, porque eles mandam
 * a pessoa a lugares diferentes: faltar associação se conserta em Remuneração;
 * haver duas se conserta apagando uma.
 */
describe("a recusa do escopo", () => {
  it("cala quando ninguém mandou escopo — é a leitura de todas as unidades", () => {
    expect(recusaDoEscopo(null, null)).toBeNull();
  });

  it("cala quando o escopo resolveu", () => {
    const resolvido = recusaDoEscopo(
      { scopeHash: "scope-camacari", tipo: "RESOLVIDO", unidadeId: "u-1", nome: "CAMAÇARI" },
      "CAMAÇARI",
    );

    expect(resolvido).toBeNull();
  });

  /*
    ---------------------------------------------------------------------------
    A frase que mandava refazer o que a importação já devia ter feito
    ---------------------------------------------------------------------------

    Esta frase dizia "associe o cadastro de Remuneração desta unidade" para toda
    unidade importada, porque a única ponte entre o escopo e a unidade cadastrada
    era um cadastro manual. Ela mandava a pessoa que acabara de importar CAMAÇARI
    de dentro de CAMAÇARI refazer à mão um vínculo que a importação tinha em
    mãos — e agora grava sozinha.

    Sobraram dois estados, e eles são telas diferentes. Confundi-los manda metade
    das pessoas para o lugar errado, que é o defeito que esta frase já cometeu
    uma vez.
  */
  it("sem unidade cadastrada, manda cadastrar — e diz que ninguém vai reimportar nada", () => {
    const recusa = recusaDoEscopo(
      { scopeHash: "scope-camacari", tipo: "SEM_CADASTRO", unidadeCadastrada: false },
      "CAMAÇARI",
    );

    expect(recusa!.problema).toContain("CAMAÇARI");
    expect(recusa!.conserto).toContain("Administração");
    /*
      O que a frase não pode fazer, e é o ponto deste teste: mandar para
      Remuneração associar o que a importação grava sozinha, ou mandar reenviar o
      arquivo. O acervo está lá — cadastrar a unidade o alcança na mesma passada.
    */
    expect(recusa!.conserto).not.toContain("Remuneração");
    expect(recusa!.conserto).toContain("não é preciso reimportar");
  });

  /*
    O caso que sobrou para a associação manual, e é o que ela sempre deveria ter
    sido: o código que o arquivo traz não é documento nenhum — `443`, `CDD
    Belém` —, há unidades cadastradas, e nenhuma delas pode ser afirmada sem
    alguém dizer. A exceção, não a regra.
  */
  it("com cadastro e sem documento no código, aí sim manda associar", () => {
    const recusa = recusaDoEscopo(
      { scopeHash: "scope-belem", tipo: "SEM_CADASTRO", unidadeCadastrada: true },
      "CDD BELÉM",
    );

    expect(recusa!.problema).toContain("CNPJ");
    expect(recusa!.conserto).toContain("Remuneração");
    /* E oferece a outra saída, que é reenviar de dentro da unidade. */
    expect(recusa!.conserto).toContain("lateral");
    expect(recusa!.conserto).not.toContain("Importações");
  });

  it("sem nome de unidade, a frase continua de pé", () => {
    const recusa = recusaDoEscopo(
      { scopeHash: "scope-x", tipo: "SEM_CADASTRO", unidadeCadastrada: false },
      null,
    );

    expect(recusa!.problema).toContain("esta unidade");
  });

  it("ambíguo lista as candidatas, porque é uma pessoa que escolhe", () => {
    const recusa = recusaDoEscopo(
      { scopeHash: "scope-x", tipo: "AMBIGUO", nomes: ["CAMAÇARI", "CDD CARUARU"] },
      "CAMAÇARI",
    );

    expect(recusa!.problema).toContain("CDD CARUARU");
    expect(recusa!.conserto).toContain("uma só");
  });
});

/**
 * O RÓTULO DA CHAVE — o nome da competência com que a variação comparou.
 *
 * A manchete imprimia `variação contra 2026-07-Q1`: a chave crua, que é a
 * identidade da competência no produto e não o nome dela — debaixo de uma tabela
 * que escreve `jul/2026, 1ª quinzena` na linha seguinte, duas grafias da mesma
 * quinzena na mesma tela.
 *
 * O que estes testes prendem, além da tradução, é a recusa: uma chave que não se
 * lê volta como está. Inventar um mês a partir de um `NaN` escreveria
 * `undefined/2026`, que é pior do que a chave crua — esta, ao menos, é verdade.
 */
describe("o rótulo de uma chave de competência", () => {
  it("escreve a quinzena por extenso, com o mês 1-indexado do banco", () => {
    expect(rotuloDaChave("2026-07-Q1")).toBe("jul/2026, 1ª quinzena");
    expect(rotuloDaChave("2026-12-Q2")).toBe("dez/2026, 2ª quinzena");
    /* Janeiro é o teste do `- 1`: sem ele sairia fevereiro. */
    expect(rotuloDaChave("2026-01-Q1")).toBe("jan/2026, 1ª quinzena");
  });

  it("devolve a chave como está quando ela não se lê", () => {
    expect(rotuloDaChave("2026-13-Q1")).toBe("2026-13-Q1");
    expect(rotuloDaChave("2026-00-Q1")).toBe("2026-00-Q1");
    expect(rotuloDaChave("2026-07-Q3")).toBe("2026-07-Q3");
    expect(rotuloDaChave("julho de 2026")).toBe("julho de 2026");
    expect(rotuloDaChave("")).toBe("");
  });

  /* A mesma quinzena, escrita igual nos dois lugares da tela. */
  it("concorda com o rótulo que a tabela escreve", () => {
    expect(rotuloDaChave("2026-07-Q2")).toBe(
      rotuloLongo({ mes: 7, ano: 2026, quinzena: 2 }),
    );
  });
});
