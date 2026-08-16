import { describe, expect, it } from "vitest";
import {
  blocosDoTexto,
  blocosDoWord,
  elementosDeTopo,
  renderizarBlocos,
} from "../documento";

/**
 * O que estes testes protegem: a estrutura do documento.
 *
 * A extração anterior arrancava as tags e devolvia as palavras na ordem em que
 * apareciam. Para uma cláusula em prosa isso bastava; para o Book do Operador,
 * não — as regras de lá moram em tabela, e uma tabela sem cabeçalho é uma lista
 * de valores sem nome de coluna. A ressalva que a tela mostrava ("a diagramação
 * não sobreviveu") era verdadeira, e era este defeito.
 *
 * O XML abaixo é o que o Word escreve, com o que costuma quebrar leitor
 * artesanal: texto partido em duas execuções de formatação, parágrafo dentro de
 * célula (que não pode virar parágrafo do corpo), e tabela dentro de tabela.
 */

const p = (texto: string, extra = "") =>
  `<w:p>${extra}<w:r><w:t>${texto}</w:t></w:r></w:p>`;

const celula = (texto: string) => `<w:tc>${p(texto)}</w:tc>`;
const linha = (...textos: string[]) =>
  `<w:tr>${textos.map(celula).join("")}</w:tr>`;

const DOCUMENTO = `<w:document><w:body>
  ${p("Auditoria QLP ADM", '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>')}
  ${p("A auditoria confere a estrutura administrativa remunerada.")}
  ${p("Conferir o organograma", '<w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr>')}
  <w:tbl>
    ${linha("Item", "Frequência")}
    ${linha("Auditoria de estrutura", "Bimestral")}
  </w:tbl>
  ${p("Fim do documento.")}
</w:body></w:document>`;

describe("varredura de XML", () => {
  it("devolve só os elementos de primeiro nível, na ordem", () => {
    const achados = elementosDeTopo(DOCUMENTO, ["w:p", "w:tbl"]);
    expect(achados.map((e) => e.tag)).toEqual([
      "w:p",
      "w:p",
      "w:p",
      "w:tbl",
      "w:p",
    ]);
  });

  /*
    O parágrafo de dentro da célula não é parágrafo do corpo.

    Sem contar profundidade, cada célula viraria também um parágrafo solto — e a
    mesma frase apareceria duas vezes, uma dentro da tabela e outra fora dela.
    Um modelo que lê duas cópias tem todo motivo para achar que são dois casos.
  */
  it("não confunde parágrafo de célula com parágrafo do corpo", () => {
    // As duas tags juntas: é a tabela que "esconde" os parágrafos das células,
    // e quem varre só `w:p` está pedindo os parágrafos onde quer que estejam.
    const achados = elementosDeTopo(DOCUMENTO, ["w:p", "w:tbl"]);
    const paragrafos = achados.filter((e) => e.tag === "w:p");
    expect(paragrafos).toHaveLength(4);
    expect(paragrafos.some((e) => e.xml.includes("Bimestral"))).toBe(false);
  });

  it("conta tabela aninhada como parte da tabela de fora", () => {
    const aninhada = `<w:body><w:tbl>${linha("a")}<w:tbl>${linha("b")}</w:tbl></w:tbl></w:body>`;
    const achados = elementosDeTopo(aninhada, ["w:tbl"]);
    expect(achados).toHaveLength(1);
    expect(achados[0].xml).toContain(">b<");
  });
});

describe("Word em blocos", () => {
  const blocos = blocosDoWord(DOCUMENTO);

  it("reconhece título, parágrafo, item de lista e tabela", () => {
    expect(blocos.map((b) => b.tipo)).toEqual([
      "TITULO",
      "PARAGRAFO",
      "ITEM",
      "TABELA",
      "PARAGRAFO",
    ]);
  });

  it("promove a primeira linha da tabela a cabeçalho", () => {
    const tabela = blocos.find((b) => b.tipo === "TABELA");
    expect(tabela).toMatchObject({
      cabecalho: ["Item", "Frequência"],
      linhas: [["Auditoria de estrutura", "Bimestral"]],
    });
  });

  /*
    Documento de operação quase nunca usa estilo de título — usa negrito. Sem a
    heurística, um documento inteiro chega sem nenhuma seção, e o índice do Book
    perde a única pista que ele tem de onde cada regra começa.
  */
  it("lê linha curta em negrito como título", () => {
    const negrito = `<w:body>${p("Frequência", "<w:pPr><w:rPr><w:b/></w:rPr></w:pPr>")}${p("Bimestral.")}</w:body>`;
    expect(blocosDoWord(negrito)[0]).toEqual({
      tipo: "TITULO",
      nivel: 2,
      texto: "Frequência",
    });
  });

  it("não confunde parágrafo longo em negrito com título", () => {
    const longo =
      "Esta é uma frase longa o bastante para não ser título de coisa nenhuma, e termina com ponto.";
    const xml = `<w:body>${p(longo, "<w:pPr><w:rPr><w:b/></w:rPr></w:pPr>")}</w:body>`;
    expect(blocosDoWord(xml)[0].tipo).toBe("PARAGRAFO");
  });
});

describe("markdown", () => {
  it("a tabela sai como tabela, com cabeçalho e separador", () => {
    const md = renderizarBlocos(blocosDoWord(DOCUMENTO));
    expect(md).toContain("## Auditoria QLP ADM");
    expect(md).toContain("- Conferir o organograma");
    expect(md).toContain("| Item | Frequência |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("| Auditoria de estrutura | Bimestral |");
  });

  it("um pipe dentro da célula não parte a tabela", () => {
    const md = renderizarBlocos([
      { tipo: "TABELA", cabecalho: ["a"], linhas: [["x | y"]] },
    ]);
    expect(md).toContain("| x \\| y |");
  });
});

describe("texto escrito à mão", () => {
  it("reconhece o markdown que quem escreve regra já usa", () => {
    const blocos = blocosDoTexto(
      "# Regra\ntexto solto\n- primeiro\n2) segundo",
    );
    expect(blocos.map((b) => b.tipo)).toEqual([
      "TITULO",
      "PARAGRAFO",
      "ITEM",
      "ITEM",
    ]);
    expect(blocos[3]).toMatchObject({ texto: "segundo" });
  });
});
