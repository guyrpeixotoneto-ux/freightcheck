import { describe, expect, it } from "vitest";
import { LIMIAR_DO_BOOK, ranquear, trechosDosBlocos, type TrechoDoBook } from "../indice-book";
import type { BlocoDeDocumento } from "../documento";

/**
 * O que estes testes protegem: **qual** trecho responde a pergunta.
 *
 * É a decisão mais consequente do retrieval, e a que menos aparece quando
 * quebra: a resposta continua saindo, com a fonte ao lado, e simplesmente
 * responde outra coisa. Cada caso aqui é uma forma de errar que a busca
 * anterior cometia — casar a palavra em vez da regra, perder o documento
 * inteiro para um bloco só, partir a tabela que continha o critério.
 */

const meta = (bloco: string, categoria = "Gente") => ({
  blockKey: `${categoria}::${bloco}`,
  bloco,
  categoria,
  revisao: 1,
  tipo: "DOCUMENTO" as const,
  arquivo: `${bloco}.docx`,
});

const QLP: BlocoDeDocumento[] = [
  { tipo: "TITULO", nivel: 1, texto: "Auditoria QLP ADM" },
  {
    tipo: "PARAGRAFO",
    texto:
      "A auditoria confere se a estrutura administrativa remunerada existe e está aderente ao padrão da operação.",
  },
  { tipo: "TITULO", nivel: 2, texto: "Frequência" },
  { tipo: "PARAGRAFO", texto: "A conferência é bimestral em todas as operações." },
  { tipo: "TITULO", nivel: 2, texto: "Critérios" },
  {
    tipo: "TABELA",
    cabecalho: ["Item", "Evidência", "Consequência"],
    linhas: [
      ["Organograma", "Documento assinado", "Questionamento"],
      ["Folha de pagamento", "Relatório do mês", "Questionamento"],
    ],
  },
];

const PNEU: BlocoDeDocumento[] = [
  { tipo: "TITULO", nivel: 1, texto: "PNEU" },
  {
    tipo: "PARAGRAFO",
    texto: "A remuneração de pneus é composta por vida útil, sulco e valor de reposição.",
  },
  { tipo: "PARAGRAFO", texto: "A conferência de sulco é mensal." },
];

const INDICE: TrechoDoBook[] = [
  ...trechosDosBlocos(QLP, meta("QLP ADM")),
  ...trechosDosBlocos(PNEU, meta("PNEU", "Equipamentos")),
];

describe("chunking", () => {
  const trechos = trechosDosBlocos(QLP, meta("QLP ADM"));

  it("cada título começa um trecho, e o trecho guarda a seção", () => {
    expect(trechos).toHaveLength(3);
    expect(trechos.map((t) => t.secao)).toEqual([
      "Auditoria QLP ADM",
      "Auditoria QLP ADM › Frequência",
      "Auditoria QLP ADM › Critérios",
    ]);
  });

  /*
    A tabela não se separa do título que a nomeia.

    Um trecho com a tabela de critérios e sem a palavra "Critérios" em lugar
    nenhum é recuperável só por acaso — e, recuperado, não diz de que ele é a
    tabela.
  */
  it("a tabela viaja inteira, junto do título dela", () => {
    const comTabela = trechos.find((t) => t.temTabela)!;
    expect(comTabela.texto).toContain("## Critérios");
    expect(comTabela.texto).toContain("| Item | Evidência | Consequência |");
    expect(comTabela.texto).toContain("| Folha de pagamento | Relatório do mês | Questionamento |");
  });

  it("uma tabela grande demais vira fatias que repetem o cabeçalho", () => {
    const gigante: BlocoDeDocumento[] = [
      {
        tipo: "TABELA",
        cabecalho: ["Placa", "Observação"],
        linhas: Array.from({ length: 60 }, (_, i) => [
          `ABC${i}`,
          "uma observação longa o bastante para empurrar a tabela para além do teto de um trecho",
        ]),
      },
    ];
    const fatias = trechosDosBlocos(gigante, meta("INVENTÁRIO"));
    expect(fatias.length).toBeGreaterThan(1);
    for (const fatia of fatias) expect(fatia.texto).toContain("| Placa | Observação |");
  });
});

describe("ranqueamento", () => {
  it("a pergunta pelo nome do bloco traz o bloco, não o vizinho", () => {
    const achados = ranquear(INDICE, "o que é QLP ADM?");
    expect(achados[0]?.trecho.bloco).toBe("QLP ADM");
    expect(achados[0]?.trecho.posicao, "a definição abre o documento").toBe(0);
  });

  /*
    "Qual a frequência?" é a pergunta de continuidade que mais aparece — e ela
    não nomeia assunto nenhum. Sem o bloco preferido, ela casa "mensal" no
    documento de PNEU, que também fala de frequência: uma resposta verdadeira
    sobre outro assunto.
  */
  it("a continuidade fica dentro do bloco de que a conversa falava", () => {
    const solta = ranquear(INDICE, "qual a frequência?");
    const comFio = ranquear(INDICE, "qual a frequência?", { blocoPreferido: "QLP ADM" });

    expect(comFio[0]?.trecho.bloco).toBe("QLP ADM");
    expect(comFio[0]?.trecho.secao).toContain("Frequência");
    expect(solta.length, "sem o fio, a busca continua acontecendo").toBeGreaterThan(0);
  });

  /*
    O documento real escreveu "Periodicidade"; a pessoa perguntou "frequência".
    Nenhuma busca lexical liga as duas — e nenhum dicionário de sinônimos
    escrito à mão conheceria o vocabulário desta operação de antemão. O que liga
    é a conversa: o turno anterior falava daquele bloco.
  */
  it("o fio da conversa vale mais que a palavra exata", () => {
    const comSinonimo = trechosDosBlocos(
      [
        { tipo: "TITULO", nivel: 2, texto: "Periodicidade" },
        { tipo: "PARAGRAFO", texto: "A auditoria é realizada bimestralmente." },
      ],
      meta("DESCONTO QLP ADM"),
    );

    expect(ranquear(comSinonimo, "qual a frequência?"), "sem fio, não há como saber").toEqual([]);

    const comFio = ranquear(comSinonimo, "qual a frequência?", {
      blocoPreferido: "DESCONTO QLP ADM",
    });
    expect(comFio[0]?.trecho.texto).toContain("bimestralmente");
  });

  it("acha a regra pela tabela, e não só pelo parágrafo", () => {
    const achados = ranquear(INDICE, "qual a evidência exigida no organograma?");
    expect(achados[0]?.trecho.temTabela).toBe(true);
    expect(achados[0]?.trecho.texto).toContain("Documento assinado");
  });

  /*
    A expansão vem do próprio índice: "QLP" casa o título "QLP ADM" e traz
    "adm" junto. É o que substitui um dicionário de sinônimos escrito à mão.
  */
  it("uma sigla solta alcança o bloco cujo título a contém", () => {
    const achados = ranquear(INDICE, "me explica o QLP");
    expect(achados[0]?.trecho.bloco).toBe("QLP ADM");
  });

  it("não devolve nada quando a pergunta não toca o Book", () => {
    expect(ranquear(INDICE, "qual o preço do dólar hoje?")).toEqual([]);
  });

  /*
    O caso que apareceu na tela, e o mais caro de todos.

    "Teve alteração na remuneração?" é uma pergunta sobre o dado — o que mudou
    entre as vigências. Ela devolvia um documento inteiro do Book porque a
    palavra "remuneração" está em quase metade dos blocos, e o ranqueamento a
    contava com o mesmo peso de "pneu", que está em um. Uma pergunta feita só de
    palavras que não distinguem nada não procura documento nenhum.
  */
  it("palavra que está em quase tudo não recupera nada", () => {
    const comuns = [
      ...trechosDosBlocos(
        [{ tipo: "PARAGRAFO", texto: "Detalhamento da composição do modelo de remuneração." }],
        meta("CUSTO FIXO DE EQUIPAMENTOS", "Equipamentos"),
      ),
      ...trechosDosBlocos(
        [{ tipo: "PARAGRAFO", texto: "Detalhamento do modelo de remuneração da equipe." }],
        meta("EQUIPE ARMAZÉM"),
      ),
      ...trechosDosBlocos(
        [{ tipo: "PARAGRAFO", texto: "Detalhamento da remuneração de pneus por eixo." }],
        meta("PNEU", "Equipamentos"),
      ),
    ];

    /*
      Não é um corte binário: a nota cai abaixo do limiar, e é `buscarNoBook`
      que descarta. A diferença importa — um corte por presença de palavra
      recusaria também "o que o Book diz sobre remuneração?", que é legítima.
    */
    const soComum = ranquear(comuns, "teve alteração na remuneração?");
    expect(soComum[0]!.pontos).toBeLessThan(LIMIAR_DO_BOOK);

    // Uma palavra que discrimina muda tudo — e traz o bloco certo à frente.
    const comPneu = ranquear(comuns, "teve alteração na remuneração de pneu?");
    expect(comPneu[0]!.pontos).toBeGreaterThan(LIMIAR_DO_BOOK);
    expect(comPneu[0]!.trecho.bloco).toBe("PNEU");

    // E a pergunta legítima sobre o mesmo assunto continua achando.
    expect(ranquear(comuns, "o que o Book diz sobre remuneração?")[0]!.pontos).toBeGreaterThan(
      LIMIAR_DO_BOOK,
    );
  });

  it("não deixa um documento só ocupar a resposta inteira", () => {
    const muitos = [
      ...INDICE,
      ...trechosDosBlocos(
        Array.from({ length: 12 }, (_, i) => ({
          tipo: "PARAGRAFO" as const,
          texto: `A auditoria administrativa da estrutura é conferida no item ${i}.`,
        })),
        meta("DESCONTO QLP ADM"),
      ),
    ];
    const achados = ranquear(muitos, "auditoria da estrutura administrativa", { limite: 6 });
    const doMesmo = achados.filter((a) => a.trecho.bloco === "DESCONTO QLP ADM");
    expect(doMesmo.length).toBeLessThanOrEqual(3);
    expect(new Set(achados.map((a) => a.trecho.bloco)).size).toBeGreaterThan(1);
  });
});
