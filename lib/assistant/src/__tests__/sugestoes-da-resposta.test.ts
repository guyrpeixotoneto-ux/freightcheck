import { describe, expect, it } from "vitest";
import { nomeDaSecao, secoesComAssunto, sugerir } from "../resposta";
import type { Dossie } from "../orquestrador";
import { trechosDosBlocos } from "../indice-book";
import { interpretar } from "../interpretacao";

/**
 * O que estes testes protegem: **que a próxima pergunta leve a algum lugar.**
 *
 * As três sugestões abaixo de uma resposta sobre o Book saíram assim na tela
 * de quem estava auditando:
 *
 *   O que o Book diz sobre 1. introdução em CUSTO FIXO DE EQUIPAMENTOS?
 *   O que o Book diz sobre 2. regra de negócio em CUSTO FIXO DE EQUIPAMENTOS?
 *   Algum parâmetro relacionado a CUSTO FIXO DE EQUIPAMENTOS mudou na última
 *   vigência?
 *
 * Duas delas são o sumário do documento lido em voz alta — com a numeração do
 * papel dentro da frase —, e a única que atravessa para o número, que é o
 * outro lado do produto, ficou em terceiro. Quem está investigando um custo
 * não precisa de um índice clicável.
 */

describe("o nome de uma seção", () => {
  it("perde a numeração do documento", () => {
    expect(nomeDaSecao("1. Introdução")).toBe("Introdução");
    expect(nomeDaSecao("2) Regra de Negócio")).toBe("Regra de Negócio");
    expect(nomeDaSecao("4.1 Cálculo do adicional")).toBe("Cálculo do adicional");
    expect(nomeDaSecao("3 - Reajuste anual")).toBe("Reajuste anual");
    expect(nomeDaSecao("IV. Anexos")).toBe("Anexos");
    expect(nomeDaSecao("a) Escopo")).toBe("Escopo");
  });

  /*
    O contrário do teste acima, e o que faria dele um estrago: um título que
    começa com número sem ser numerado.
  */
  it("não come o assunto de quem começa com número", () => {
    expect(nomeDaSecao("13º salário")).toBe("13º salário");
    expect(nomeDaSecao("12 meses de vigência")).toBe("12 meses de vigência");
    expect(nomeDaSecao("Reajuste 2026")).toBe("Reajuste 2026");
  });
});

describe("as seções que viram pergunta", () => {
  it("deixam de fora os títulos de forma", () => {
    expect(
      secoesComAssunto(
        [
          "Custo fixo › 1. Introdução",
          "Custo fixo › 2. Regra de Negócio",
          "Custo fixo › 3. Considerações finais",
          "Custo fixo › 4. Depreciação do cavalo",
        ],
        "CUSTO FIXO DE EQUIPAMENTOS",
      ),
    ).toEqual(["Depreciação do cavalo"]);
  });

  it("não devolvem a seção que repete o bloco, nem a mesma duas vezes", () => {
    expect(
      secoesComAssunto(
        ["QLP ADM", "Auditoria › Frequência", "Outra › frequência", null, undefined],
        "QLP ADM",
      ),
    ).toEqual(["Frequência"]);
  });

  it("sobrevivem a um dossiê sem seção nenhuma", () => {
    expect(secoesComAssunto([], "QLP ADM")).toEqual([]);
  });
});

const trechosDoCusto = trechosDosBlocos(
  [
    { tipo: "TITULO", nivel: 1, texto: "1. Introdução" },
    { tipo: "PARAGRAFO", texto: "Este capítulo trata do custo fixo de equipamentos." },
    { tipo: "TITULO", nivel: 1, texto: "2. Regra de Negócio" },
    { tipo: "PARAGRAFO", texto: "O custo fixo é apurado por equipamento ativo." },
    { tipo: "TITULO", nivel: 1, texto: "3. Depreciação do cavalo" },
    { tipo: "PARAGRAFO", texto: "A depreciação segue a tabela do fabricante." },
  ],
  {
    blockKey: "Equipamentos::CUSTO FIXO DE EQUIPAMENTOS",
    bloco: "CUSTO FIXO DE EQUIPAMENTOS",
    categoria: "Equipamentos",
    revisao: 1,
    tipo: "DOCUMENTO",
    arquivo: "Custo fixo.docx",
  },
);

function dossie(parcial: Partial<Dossie> = {}): Dossie {
  const pergunta = "o que é custo fixo de equipamentos?";
  return {
    pergunta,
    leitura: interpretar(pergunta),
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
      origemDoRecorte: "PADRAO" as const,
      unidadeCitada: null,
      periodoImpossivel: null,
      periodo: null,
      intervalo: null,
    },
    trechos: [],
    documentos: trechosDoCusto.map((trecho) => ({ trecho, pontos: 1, porque: [] })),
    evidencias: [],
    anexos: [],
    lacunas: [],
    etapas: [],
    desambiguacao: null,
    encadeamentos: [],
    telaScopeHash: null,
    diagnostico: { book: { candidatos: 0, selecionados: 0, melhorPontuacao: 0 }, ms: 0 },
    ...parcial,
  };
}

describe("as três sugestões de uma resposta do Book", () => {
  /*
    A ordem é a correção: a ponte para o número vinha em terceiro, atrás de
    duas leituras do mesmo documento.
  */
  it("abrem pela ponte para o número, que é o outro lado do produto", () => {
    expect(sugerir(dossie())[0]).toBe(
      "Algum parâmetro relacionado a CUSTO FIXO DE EQUIPAMENTOS mudou na última vigência?",
    );
  });

  it("não repetem o sumário do documento nem a numeração dele", () => {
    const saida = sugerir(dossie());

    expect(saida.length).toBeLessThanOrEqual(3);
    for (const s of saida) {
      expect(s).not.toMatch(/\b\d+\.\s/);
      expect(s).not.toContain("introdução");
      expect(s).not.toContain("regra de negócio");
    }
    expect(saida).toContain(
      "O que o Book diz sobre depreciação do cavalo em CUSTO FIXO DE EQUIPAMENTOS?",
    );
  });
});
