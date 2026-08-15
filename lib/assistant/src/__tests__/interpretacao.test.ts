import { describe, expect, it } from "vitest";
import { ehContinuacao, interpretar, type Intencao } from "../interpretacao";

/**
 * O que estes testes protegem: a distinção entre tipos de pergunta.
 *
 * É a decisão mais consequente do assistente. "Como funciona o IPVA" e "quanto
 * mudou o IPVA" nomeiam o mesmo assunto e pedem coisas opostas — a primeira o
 * conceito, a segunda a série. Errar aqui produz uma resposta correta sobre a
 * pergunta errada, que é o defeito mais difícil de perceber lendo.
 *
 * Os casos vêm de perguntas reais, e as variações de linguagem existem para que
 * o classificador não passe por decorar frase: se "onde perdemos mais dinheiro"
 * e "qual parâmetro mais prejudicou a remuneração" não caírem no mesmo lugar,
 * o que existe aqui é um dicionário de frases, não um classificador.
 */

const casos: { pergunta: string; intencao: Intencao }[] = [
  // ---- conceitual ----------------------------------------------------------
  { pergunta: "Como funciona preço de combustível?", intencao: "CONCEITUAL" },
  { pergunta: "O que é preço de combustível?", intencao: "CONCEITUAL" },
  { pergunta: "Como funciona IPVA?", intencao: "CONCEITUAL" },
  { pergunta: "o que significa cobertura da apuração", intencao: "CONCEITUAL" },
  { pergunta: "explique o índice de reajuste", intencao: "CONCEITUAL" },
  { pergunta: "como é calculado o FINAME?", intencao: "CONCEITUAL" },
  { pergunta: "para que serve a curadoria", intencao: "CONCEITUAL" },

  // ---- disponibilidade -----------------------------------------------------
  { pergunta: "Temos preço de combustível?", intencao: "DISPONIBILIDADE" },
  { pergunta: "existe parâmetro de pedágio?", intencao: "DISPONIBILIDADE" },

  // ---- valor ----------------------------------------------------------------
  { pergunta: "Qual o valor do IPVA?", intencao: "VALOR" },
  { pergunta: "quanto está o pneu em agosto?", intencao: "VALOR" },

  // ---- evolução -------------------------------------------------------------
  { pergunta: "Quanto mudou o IPVA desde dezembro?", intencao: "EVOLUCAO" },
  { pergunta: "qual foi a evolução do IPVA", intencao: "EVOLUCAO" },
  { pergunta: "quanto o pneu variou ao longo das vigências", intencao: "EVOLUCAO" },
  { pergunta: "quanto mudou combustível", intencao: "EVOLUCAO" },

  // ---- comparação -----------------------------------------------------------
  { pergunta: "Compare julho com agosto.", intencao: "COMPARACAO" },
  { pergunta: "julho versus agosto", intencao: "COMPARACAO" },
  { pergunta: "qual a diferença entre junho e agosto", intencao: "COMPARACAO" },

  // ---- movimento ------------------------------------------------------------
  { pergunta: "O que mudou em agosto?", intencao: "MOVIMENTO" },
  { pergunta: "quais foram as alterações da última vigência", intencao: "MOVIMENTO" },

  // ---- rankings -------------------------------------------------------------
  { pergunta: "Onde perdemos mais dinheiro?", intencao: "RANKING_PERDA" },
  { pergunta: "Qual parâmetro mais piorou?", intencao: "RANKING_PERDA" },
  { pergunta: "qual parâmetro mais prejudicou a remuneração", intencao: "RANKING_PERDA" },
  { pergunta: "Onde ganhamos mais dinheiro?", intencao: "RANKING_GANHO" },
  { pergunta: "o que melhorou na remuneração", intencao: "RANKING_GANHO" },

  // ---- veículos --------------------------------------------------------------
  { pergunta: "Quais veículos foram mais impactados?", intencao: "VEICULOS" },
  { pergunta: "quais placas sofreram mais alterações", intencao: "VEICULOS" },

  // ---- sem preço --------------------------------------------------------------
  {
    pergunta: "Quais parâmetros não têm preço suficiente para calcular impacto?",
    intencao: "SEM_PRECO",
  },
  { pergunta: "o que ficou sem valoração", intencao: "SEM_PRECO" },

  // ---- Book -------------------------------------------------------------------
  { pergunta: "O que o Book diz sobre IPVA?", intencao: "BOOK" },
  { pergunta: "o book fala alguma coisa sobre combustível?", intencao: "BOOK" },
  { pergunta: "qual a regra do pneu", intencao: "BOOK" },
  /*
    Pedir o documento é pedir o Book.

    As três primeiras vinham da tela: a pessoa perguntou pelo bloco, ouviu que
    a regra estava num arquivo anexado, e insistiu com todas as letras. As três
    caíam em DESCONHECIDA e recebiam de volta o índice — o mesmo parágrafo, sem
    o arquivo que elas nomeiam.
  */
  { pergunta: "você não consegue ler o que tem no documento QLP ADM?", intencao: "BOOK" },
  { pergunta: "me diz o que está no documento de pneu", intencao: "BOOK" },
  { pergunta: "abre o anexo de QLP ADM", intencao: "BOOK" },

  // ---- procedência --------------------------------------------------------------
  { pergunta: "de onde veio esse número?", intencao: "PROCEDENCIA" },
  { pergunta: "Por quê?", intencao: "PROCEDENCIA" },
  { pergunta: "me mostre a fonte", intencao: "PROCEDENCIA" },

  // ---- DRE ------------------------------------------------------------------
  /*
    As perguntas de §28, uma a uma. As três primeiras são as que mais importam:
    nenhuma delas contém a palavra "DRE", e todas pedem resultado apurado. Um
    classificador que só reconhecesse a sigla mandaria as três para lugar nenhum.
  */
  { pergunta: "Qual cavalo mais dá prejuízo?", intencao: "DRE" },
  { pergunta: "Quais caminhões têm EBITDA negativo?", intencao: "DRE" },
  { pergunta: "quanto sobra por caminhão?", intencao: "DRE" },
  { pergunta: "mostre a DRE de agosto", intencao: "DRE" },
  { pergunta: "qual a margem da frota?", intencao: "DRE" },
  { pergunta: "quais veículos são deficitários?", intencao: "DRE" },
  { pergunta: "qual o resultado econômico da unidade?", intencao: "DRE" },
  { pergunta: "Mostre os 10 veículos com maior custo por km", intencao: "DRE" },
  { pergunta: "Por que o ABC1D23 piorou em agosto?", intencao: "DRE" },

  // ---- panorama e contexto ------------------------------------------------------
  { pergunta: "o que temos importado?", intencao: "PANORAMA" },
  { pergunta: "quantas vigências temos?", intencao: "PANORAMA" },
  { pergunta: "quais vigências existem?", intencao: "CATALOGO_DE_CONTEXTO" },
];

describe("classificação de intenção", () => {
  it.each(casos)("$pergunta → $intencao", ({ pergunta, intencao }) => {
    expect(interpretar(pergunta).intencao).toBe(intencao);
  });

  /*
    A fronteira entre DRE e Composição.

    As duas perguntas nomeiam o mesmo equipamento e leem os mesmos fatos, e
    pedem coisas diferentes: uma quer a memória de cálculo do que ele recebe, a
    outra quer o que sobra. Confundi-las produz uma resposta correta sobre a
    pergunta errada.
  */
  /*
    A DRE não pode roubar as perguntas dos rankings nem a de veículos afetados.
    Ela vem antes das duas na ordem dos padrões, então esta é a asserção que
    impede a mudança de ordem de virar uma regressão silenciosa.
  */
  it("não rouba as perguntas de ranking e de veículos afetados", () => {
    expect(interpretar("onde perdemos mais dinheiro?").intencao).toBe("RANKING_PERDA");
    expect(interpretar("qual parâmetro mais prejudicou a remuneração").intencao).toBe(
      "RANKING_PERDA",
    );
    expect(interpretar("quais veículos foram mais impactados?").intencao).toBe("VEICULOS");
    expect(interpretar("quais placas mudaram?").intencao).toBe("VEICULOS");
  });

  it("separa a composição do resultado", () => {
    expect(interpretar("como se compõe a remuneração do cavalo").intencao).toBe("COMPOSICAO");
    expect(interpretar("visão de frota dos cavalos").intencao).toBe("COMPOSICAO");
    expect(interpretar("quanto sobra do cavalo depois dos custos").intencao).toBe("DRE");
    expect(interpretar("o que é DRE?").intencao).toBe("CONCEITUAL");
  });

  it("variações da mesma pergunta caem na mesma intenção", () => {
    const grupos: string[][] = [
      ["onde perdemos mais dinheiro?", "onde tivemos maior perda?", "o que mais prejudicou?"],
      ["o que é IPVA?", "que é IPVA", "o que significa IPVA"],
      ["compare julho com agosto", "compare julho e agosto", "julho x agosto"],
      /*
        As três formas de perguntar a mesma coisa sobre resultado. Se elas se
        separarem, o que existe é um dicionário de frases — a mesma armadilha
        que o cabeçalho deste arquivo descreve.
      */
      [
        "qual cavalo dá mais prejuízo",
        "quais veículos são deficitários",
        "quais caminhões têm EBITDA negativo",
      ],
    ];
    for (const grupo of grupos) {
      const intencoes = new Set(grupo.map((p) => interpretar(p).intencao));
      expect([...intencoes], grupo.join(" / ")).toHaveLength(1);
    }
  });
});

describe("entidades", () => {
  it("lê o mês e o intervalo", () => {
    expect(interpretar("o que mudou em agosto?").entidades.periodo).toEqual({ mes: "agosto" });
    expect(interpretar("quanto mudou desde dezembro?").entidades.intervalo).toEqual({
      de: { mes: "dezembro" },
      ate: null,
    });
    expect(interpretar("compare julho com agosto").entidades.intervalo).toEqual({
      de: { mes: "julho" },
      ate: { mes: "agosto" },
    });
  });

  it("lê o ano quando declarado", () => {
    expect(interpretar("o que mudou em agosto/2026?").entidades.periodo).toEqual({
      mes: "agosto",
      ano: 2026,
    });
  });

  it("lê o relativo", () => {
    expect(interpretar("o que mudou na última vigência?").entidades.periodo).toEqual({
      relativo: "ULTIMA",
    });
  });

  it("extrai o assunto e descarta a operação", () => {
    expect(interpretar("quanto mudou o IPVA desde dezembro?").entidades.assuntoCandidato).toBe("ipva");
    expect(interpretar("onde perdemos mais dinheiro?").entidades.assuntoCandidato).toBeNull();
    expect(interpretar("quais veículos foram mais impactados?").entidades.assuntoCandidato).toBeNull();
  });

  /*
    O nome do bloco é o que sobra depois de tirar o pedido.

    `regraDoBook` casa o título contra este resíduo e `buscarNoTextoDoBook` o
    procura dentro do texto das regras — as duas ficam sem chance quando o
    resíduo carrega "consegue ler documento" na frente do nome.
  */
  it("descarta o vocabulário de quem pede um documento", () => {
    expect(
      interpretar("você não consegue ler o que tem no documento QLP ADM?").entidades
        .assuntoCandidato,
    ).toBe("qlp adm");
    expect(interpretar("abre o anexo de pneu").entidades.assuntoCandidato).toBe("pneu");
  });

  it("lê o equipamento", () => {
    expect(interpretar("quanto mudou no cavalo?").entidades.equipamento).toBe("CAVALO");
    expect(interpretar("e na carreta?").entidades.equipamento).toBe("CARRETA");
  });
});

describe("continuação", () => {
  it("reconhece a frase sem assunto próprio", () => {
    for (const p of ["E julho?", "Por quê?", "compare os dois", "e a vigência anterior?"]) {
      expect(ehContinuacao(p), p).toBe(true);
      expect(interpretar(p).continuacao, p).toBe(true);
    }
  });

  it("não confunde pergunta completa com continuação", () => {
    for (const p of [
      "Compare julho com agosto.",
      "quanto mudou o IPVA desde dezembro?",
      "o que é combustível?",
    ]) {
      expect(interpretar(p).continuacao, p).toBe(false);
    }
  });

  it("a continuação carrega o que a frase traz de novo", () => {
    const leitura = interpretar("E julho?");
    expect(leitura.continuacao).toBe(true);
    expect(leitura.entidades.periodo).toEqual({ mes: "julho" });
    expect(leitura.entidades.assuntoCandidato).toBeNull();
  });
});
