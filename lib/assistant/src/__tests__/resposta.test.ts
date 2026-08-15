import { describe, expect, it } from "vitest";
import { redacaoDeterministica } from "../resposta";
import { citacoesSemFonte, itensCitaveis, numerosSemLastro, type Dossie } from "../orquestrador";
import { trechosDosBlocos } from "../indice-book";
import { interpretar } from "../interpretacao";

/**
 * O que estes testes protegem: **o que chega aos olhos de quem perguntou.**
 *
 * A resposta que motivou esta reescrita começava assim: "Revisão vigente: 1 — 1
 * revisão guardada. bloco: DESCONTO QLP ADM. tipo: documento anexado." Três
 * frases sobre a administração do Book antes de uma palavra sobre a regra. Nada
 * ali estava errado — era tudo verdade, consultada e citada. Estava tudo fora
 * do assunto.
 *
 * A redação em código não é mais o teto de qualidade do produto (o modelo
 * escreve, quando há chave), mas ela continua sendo o que sai quando não há —
 * e o que sai quando a trava descarta o texto do modelo. Se ela voltar a
 * despejar o dossiê, o produto volta a parecer um buscador com IA nos dois
 * caminhos em que mais importa não parecer.
 */

const trechosDoQlp = trechosDosBlocos(
  [
    { tipo: "TITULO", nivel: 1, texto: "Auditoria QLP ADM" },
    {
      tipo: "PARAGRAFO",
      texto:
        "A auditoria confere se a estrutura administrativa remunerada existe e está aderente ao padrão.",
    },
    { tipo: "TITULO", nivel: 2, texto: "Frequência" },
    { tipo: "PARAGRAFO", texto: "A conferência é bimestral, em todas as operações." },
  ],
  {
    blockKey: "Gente::QLP ADM",
    bloco: "QLP ADM",
    categoria: "Gente",
    revisao: 1,
    tipo: "DOCUMENTO",
    arquivo: "QLP ADM.docx",
  },
);

function dossie(parcial: Partial<Dossie> = {}): Dossie {
  return {
    pergunta: "o que é QLP ADM?",
    leitura: interpretar("o que é QLP ADM?"),
    plano: {
      intencao: "CONCEITUAL",
      necessidades: ["CONCEITUAL"],
      porque: "pede definição",
      assunto: null,
      comoReconheceu: null,
      herdado: [],
      alvo: null,
      resolucao: null,
      contexto: null,
      periodo: null,
      intervalo: null,
    },
    trechos: [],
    documentos: [],
    evidencias: [],
    anexos: [],
    lacunas: [],
    etapas: [],
    desambiguacao: null,
    diagnostico: { book: { candidatos: 0, selecionados: 0, melhorPontuacao: 0 }, ms: 0 },
    ...parcial,
  };
}

const doBook = trechosDoQlp.map((trecho) => ({ trecho, pontos: 1, porque: [] }));

/** O registro do bloco, como `regraDoBook` o devolve: tudo interno. */
const registro = {
  ferramenta: "regraDoBook",
  titulo: "Book · QLP ADM",
  fatos: [
    { rotulo: "Bloco", valor: "QLP ADM", detalhe: "Gente", interno: true },
    { rotulo: "Revisão vigente", valor: "1", detalhe: "1 revisão guardada", interno: true },
    { rotulo: "Tipo", valor: "documento anexado", detalhe: "QLP ADM.docx", interno: true },
  ],
  numeros: [1, 1],
  origem: 'book_entry · bloco "Gente::QLP ADM" · revisão 1',
};

describe("a redação em código", () => {
  it("abre pelo conteúdo do Book, não pela ficha do bloco", () => {
    const texto = redacaoDeterministica(
      dossie({ documentos: doBook, evidencias: [registro] }),
    );

    expect(texto.startsWith("## Auditoria QLP ADM")).toBe(true);
    expect(texto).toContain("estrutura administrativa remunerada");
    expect(texto).toContain("bimestral");
  });

  /*
    A lista abaixo é literal: cada item apareceu na tela de alguém.
  */
  it("não diz uma palavra sobre a mecânica do produto", () => {
    const texto = redacaoDeterministica(
      dossie({ documentos: doBook, evidencias: [registro] }),
    );

    for (const proibido of [
      "Revisão vigente",
      "revisão guardada",
      "documento anexado",
      "Bloco:",
      "bloco:",
      "diagramação",
      "extração",
      "trecho recuperado",
    ]) {
      expect(texto, `"${proibido}" não pertence a uma resposta`).not.toContain(proibido);
    }
  });

  it("cada pedaço do Book leva a citação da fonte que o sustenta", () => {
    const d = dossie({ documentos: doBook });
    const texto = redacaoDeterministica(d);
    const citadas = [...texto.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));

    expect(citadas.length).toBeGreaterThan(0);
    expect(citacoesSemFonte(texto, d)).toEqual([]);
    expect(Math.max(...citadas)).toBeLessThanOrEqual(itensCitaveis(d).length);
  });

  /*
    O parágrafo de abertura voltava inteiro no fim, com a mesma citação — era o
    defeito mais visível de todos, porque não é preciso entender de remuneração
    para reparar nele.
  */
  it("não repete o parágrafo com que abriu", () => {
    const conceito = {
      trecho: {
        id: "book:Gente::QLP ADM",
        corpus: "BOOK_INDICE" as const,
        titulo: "QLP ADM",
        secao: "Gente",
        texto: '"QLP ADM" é um bloco da categoria Gente do Book do Operador.',
        termos: [],
        fonte: "Book do Operador · Gente › QLP ADM",
        parametros: [],
        atributos: [],
        colunasDaOrigem: [],
      },
      pontos: 1,
    };

    const texto = redacaoDeterministica(dossie({ trechos: [conceito] }));
    const paragrafos = texto.split("\n\n").map((p) => p.replace(/\s*\[\d+\]\s*$/, "").trim());
    expect(new Set(paragrafos).size).toBe(paragrafos.length);
  });

  it("sem nada encontrado, diz onde procurou em vez de encerrar o assunto", () => {
    const texto = redacaoDeterministica(
      dossie({
        lacunas: [
          {
            tipo: "NAO_ENCONTREI",
            explicacao:
              "Procurei nos três lugares que este produto tem — o Book do Operador, o catálogo " +
              "de parâmetros do Freightech e os dados importados deste recorte — e não encontrei nada.",
          },
        ],
      }),
    );
    expect(texto).toContain("Book do Operador");
    expect(texto).toContain("não encontrei");
  });
});

describe("a trava de lastro, com o Book no dossiê", () => {
  /*
    Esta é a correção que devolveu ao modelo a liberdade de transcrever uma
    regra. O conteúdo do Book chegava como **anexo** — um arquivo que a trava
    não tem como conferir —, e por isso a licença era dada por frase, a quem
    citasse o anexo. Uma resposta que reproduzisse a tabela de critérios em
    lista, com a citação só na última linha, tinha cada linha anterior conferida
    contra as evidências (onde os números do documento não estão) e era
    descartada inteira. Com o texto no dossiê, conferir "bimestral" ou "1.234" é
    a mesma operação de sempre.
  */
  it("um número escrito no documento tem lastro", () => {
    const comNumero = trechosDosBlocos(
      [{ tipo: "PARAGRAFO", texto: "O prazo de resposta ao questionamento é de 15 dias." }],
      {
        blockKey: "Gente::QLP ADM",
        bloco: "QLP ADM",
        categoria: "Gente",
        revisao: 1,
        tipo: "DOCUMENTO",
        arquivo: "QLP ADM.docx",
      },
    ).map((trecho) => ({ trecho, pontos: 1, porque: [] }));

    const d = dossie({ documentos: comNumero });
    expect(numerosSemLastro("O prazo é de 15 dias [1].", d)).toEqual([]);
    expect(numerosSemLastro("O prazo é de 45 dias [1].", d)).toContain("45");
  });

  it("um número que não está em lugar nenhum continua sendo recusado", () => {
    const d = dossie({ documentos: doBook });
    expect(numerosSemLastro("A auditoria custou R$ 39.936 [1].", d)).toContain("39.936");
  });
});
