import { describe, expect, it } from "vitest";
import { portaoDeLastro } from "../resposta";
import type { Dossie } from "../orquestrador";

/**
 * O portão é o que separa "o texto sai enquanto é escrito" de "o texto sai sem
 * ser conferido", e a diferença entre os dois não aparece em tela nenhuma até
 * um número errado já ter sido lido. Por isso ele é testado sozinho, sem banco
 * e sem rede: o que se afirma aqui é a promessa do produto — nada sem lastro
 * chega a ser exibido — e não o comportamento de um modelo.
 *
 * Os pedaços chegam partidos em posições incômodas de propósito. O fluxo real
 * não respeita fronteira de frase nem de número: um delta pode terminar no meio
 * de "28.511,24", e um portão que cortasse ali reprovaria um número que está no
 * dossiê.
 */

/** Um dossiê mínimo — só o que as duas conferências leem. */
function dossieCom(opcoes: { numeros?: number[]; fatos?: string[]; fontes?: number }): Dossie {
  const fontes = opcoes.fontes ?? 1;
  const evidencias = Array.from({ length: fontes }, (_, i) => ({
    ferramenta: `ferramenta-${i}`,
    titulo: "Alterações da vigência",
    origem: "teste",
    numeros: opcoes.numeros ?? [],
    fatos: (opcoes.fatos ?? []).map((valor) => ({ rotulo: "Total", valor })),
  }));
  return {
    pergunta: "",
    leitura: {} as Dossie["leitura"],
    plano: {} as Dossie["plano"],
    trechos: [],
  documentos: [],
    evidencias: evidencias as unknown as Dossie["evidencias"],
    anexos: [],
    lacunas: [],
    etapas: [],
    desambiguacao: null,
  };
}

/** Entrega o texto em pedaços de `n` caracteres, como o fluxo faria. */
function transmitir(portao: { receber(p: string): void }, texto: string, n: number): void {
  for (let i = 0; i < texto.length; i += n) portao.receber(texto.slice(i, i + n));
}

describe("portão de lastro", () => {
  it("libera a frase assim que ela fecha, e não antes", () => {
    const saida: string[] = [];
    const portao = portaoDeLastro(dossieCom({}), (p) => saida.push(p));

    portao.receber("O consumo negociado caiu");
    expect(saida.join(""), "frase incompleta não sai").toBe("");

    portao.receber(" em vários veículos. E depois");
    expect(saida.join("")).toBe("O consumo negociado caiu em vários veículos.");
  });

  it("deixa passar o número que a evidência autoriza, partido no meio", () => {
    const saida: string[] = [];
    const portao = portaoDeLastro(
      dossieCom({ fatos: ["28.511,24"] }),
      (p) => saida.push(p),
    );

    // Pedaços de 3 caracteres partem "28.511,24" em vários deltas — e o ponto
    // de milhar não pode virar fronteira de frase.
    transmitir(portao, "O impacto foi de 28.511,24 no período. Fim.", 3);

    expect(saida.join("")).toContain("28.511,24");
    expect(saida.join("")).toContain("no período.");
  });

  it("fecha na frase que traz número sem lastro, e não libera nada depois", () => {
    const saida: string[] = [];
    const portao = portaoDeLastro(
      dossieCom({ fatos: ["267"] }),
      (p) => saida.push(p),
    );

    transmitir(portao, "Houve 267 alterações. O total foi 99.999,00. E mais uma frase aqui.", 5);

    const texto = saida.join("");
    expect(texto, "a frase conferida sai").toContain("267 alterações.");
    expect(texto, "a frase com número inventado não sai").not.toContain("99.999,00");
    expect(texto, "nada depois dela sai").not.toContain("E mais uma frase");
  });

  it("fecha na citação que aponta para fonte inexistente", () => {
    const saida: string[] = [];
    const portao = portaoDeLastro(
      dossieCom({ fatos: ["267"], fontes: 2 }),
      (p) => saida.push(p),
    );

    transmitir(portao, "Foram 267 alterações [2]. Confira também [7]. E o resto.", 4);

    const texto = saida.join("");
    expect(texto, "citação dentro do dossiê passa").toContain("[2]");
    expect(texto, "citação para fonte que não existe não passa").not.toContain("[7]");
  });

  it("não libera a última frase quando ela não fecha", () => {
    const saida: string[] = [];
    const portao = portaoDeLastro(dossieCom({}), (p) => saida.push(p));

    /*
      O rabo sem ponto final fica retido de propósito: liberá-lo exigiria
      conferir uma frase que ainda pode ganhar um número na próxima palavra. O
      evento final da rota carrega o texto inteiro, então nada se perde — só
      aparece um instante depois.
    */
    transmitir(portao, "Primeira frase completa. Segunda ainda sem", 6);

    expect(saida.join("")).toBe("Primeira frase completa.");
  });

  it("trata a quebra de linha como fronteira", () => {
    const saida: string[] = [];
    const portao = portaoDeLastro(dossieCom({}), (p) => saida.push(p));

    portao.receber("Um item da lista\nOutro item");

    expect(saida.join("")).toBe("Um item da lista\n");
  });
});

/**
 * A isenção do anexo — e o seu limite.
 *
 * Quando um documento vai junto para o modelo, os números que saem dele não têm
 * como ser conferidos contra uma lista: o conteúdo do PDF só é conhecido por
 * quem o leu. A regra que substitui a lista é a citação — e o que estes testes
 * fixam é que ela **não** vira licença geral. A frase que aponta para o
 * documento passa; a frase ao lado, que não aponta para nada, continua sendo
 * descartada como sempre foi.
 */
function dossieComAnexo(fatos: string[]): Dossie {
  const base = dossieCom({ fatos });
  return {
    ...base,
    anexos: [
      {
        titulo: "Book · PNEU · contrato.pdf",
        filename: "contrato.pdf",
        origem: "book_entry",
        conteudo: { forma: "NATIVO", mimeType: "application/pdf", dados: "" },
      },
    ] as unknown as Dossie["anexos"],
  };
}

describe("números que vêm de um anexo", () => {
  // Uma evidência + um anexo: a evidência é [1], o anexo é [2].
  it("aceita número sem lastro na frase que cita o anexo", () => {
    const saida: string[] = [];
    const portao = portaoDeLastro(dossieComAnexo(["267"]), (p) => saida.push(p));

    transmitir(portao, "O contrato fixa o reajuste em 7,5% ao ano [2]. Fim.", 6);

    expect(saida.join(""), "o que o modelo leu no PDF sai, com a fonte ao lado").toContain("7,5%");
  });

  it("continua recusando número sem lastro na frase que não cita o anexo", () => {
    const saida: string[] = [];
    const portao = portaoDeLastro(dossieComAnexo(["267"]), (p) => saida.push(p));

    transmitir(portao, "Houve 267 alterações [1]. O total foi 99.999,00. E o resto.", 5);

    const texto = saida.join("");
    expect(texto, "a frase com evidência passa").toContain("267 alterações");
    expect(texto, "sem citação, o número segue sem lastro").not.toContain("99.999,00");
  });

  it("conta o anexo como fonte válida para citar", () => {
    const saida: string[] = [];
    const portao = portaoDeLastro(dossieComAnexo(["267"]), (p) => saida.push(p));

    // Com uma evidência e um anexo há duas fontes: [2] existe, [3] não.
    transmitir(portao, "Está no contrato [2]. Veja também [3]. Fim.", 4);

    const texto = saida.join("");
    expect(texto).toContain("[2]");
    expect(texto, "citação além do anexo continua sem fonte").not.toContain("[3]");
  });
});
