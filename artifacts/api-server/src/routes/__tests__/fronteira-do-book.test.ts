import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeBookEntry, TIPOS_ACEITOS } from "../book";

/**
 * A fronteira do Book do Operador — as duas metades de uma decisão.
 *
 * O Book é a terceira entrada do produto, e ela **fica**: quem opera anexa ali
 * o contrato, o manual e a planilha de apoio, e é assim que deve continuar
 * sendo (decidido em 16/08/2026, registrado em
 * `docs/AUDITORIA-INGESTAO-PROPAGACAO.md`, Parte 1.3).
 *
 * A regra do produto não é "duas portas e ponto". Ela é mais precisa, e é a
 * precisão que a torna sustentável:
 *
 *   > Dado que vira número entra por duas portas — Importações e Chamados.
 *   > Regra que sustenta número entra pelo Book. Nenhum documento do Book
 *   > escreve fato canônico, e nenhum número do produto sai dele.
 *
 * Uma regra assim tem dois jeitos de morrer, opostos, e este arquivo tranca os
 * dois:
 *
 * 1. **Alguém fecha o Book** achando que está fechando uma porta indevida — a
 *    auditoria listou duas para fechar, e a semelhança superficial ("também
 *    recebe arquivo por base64") é convite para levar a terceira junto.
 * 2. **Alguém abre o Book para o cálculo** — liga `book_entry` a uma soma
 *    porque "o número está no contrato". No dia em que isso acontecer, um valor
 *    da tela deixa de ter lastro em `fact`, e a rastreabilidade até a célula de
 *    origem — que é a razão de este produto existir — passa a ter uma exceção
 *    que ninguém declarou.
 *
 * O primeiro caso é coberto por asserção de comportamento; o segundo, por
 * varredura de código-fonte, porque é a única forma de provar uma **ausência**.
 */

/** Um PDF mínimo: a assinatura que o formato obriga nos quatro primeiros bytes. */
const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

const BLOCO = {
  blockKey: "remuneracao.custo-fixo",
  blockCategory: "Remuneração",
  blockTitle: "Custo fixo",
};

describe("o Book continua recebendo arquivo — e isso é decisão, não descuido", () => {
  it("aceita o documento anexado, que é o caminho principal da tela", () => {
    const resultado = decodeBookEntry({
      ...BLOCO,
      kind: "DOCUMENTO",
      filename: "Contrato de remuneração 2026.pdf",
      contentBase64: PDF.toString("base64"),
    });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok || resultado.value.kind !== "DOCUMENTO") return;
    expect(resultado.value.content.equals(PDF)).toBe(true);
    expect(resultado.value.mimeType).toBe("application/pdf");
  });

  it("continua aceitando planilha e documento de texto, e não só PDF", () => {
    // O que chega neste bloco é o que a operação tem à mão: o contrato em PDF,
    // a tabela de apoio em XLSX, o manual em DOCX. Estreitar a lista para um
    // formato só empurraria quem opera a converter arquivo para nos agradar.
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04]).toString("base64");
    for (const nome of ["tabela-de-apoio.xlsx", "manual.docx"]) {
      const resultado = decodeBookEntry({
        ...BLOCO,
        kind: "DOCUMENTO",
        filename: nome,
        contentBase64: zip,
      });
      expect(resultado.ok, nome).toBe(true);
    }
    expect(Object.keys(TIPOS_ACEITOS)).toEqual(
      expect.arrayContaining([".pdf", ".docx", ".xlsx", ".png", ".csv"]),
    );
  });

  it("a regra escrita à mão continua valendo tanto quanto o arquivo", () => {
    // Os dois tipos dividem a mesma numeração de revisão de propósito:
    // escrever hoje e anexar o contrato assinado no mês que vem é a sequência
    // mais provável de todas, e ela só se lê como sequência assim.
    const resultado = decodeBookEntry({
      ...BLOCO,
      kind: "TEXTO",
      bodyText: "O custo fixo é rateado por conjunto, conforme a cláusula 4.2.",
    });
    expect(resultado.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------

/**
 * Os pacotes que produzem número na tela.
 *
 * Todo valor que o produto exibe sai de um destes, e todos eles têm de poder
 * ser seguidos até uma célula de planilha por `fact.raw_cell_id`. Um documento
 * do Book não tem esse rastro — ele é a *regra*, não a medida —, e por isso
 * nenhum deles pode lê-lo.
 */
const MOTORES_DE_CALCULO = [
  "comparison",
  "coverage",
  "composition",
  "dre",
  "balance",
  "simulation",
  "curation",
  "ingest",
];

/**
 * Quem pode citar o Book, e por quê.
 *
 * `lib/knowledge` e `lib/assistant` aparecem de fora desta lista de propósito:
 * eles **citam** o documento como fonte de uma regra, com link, e é exatamente
 * o que o Book existe para permitir. A diferença entre citar e calcular é a
 * mesma que separa "isto se apoia no contrato" de "isto vale R$ 4.677,85", e é
 * ela que esta lista guarda.
 */
const RAIZ = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
);

function arquivosDeFonte(dir: string): string[] {
  const saida: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const caminho = path.join(dir, entrada);
    if (statSync(caminho).isDirectory()) {
      // Os testes de um pacote podem falar do que quiserem; o que não pode
      // ler o Book é o código que roda em produção.
      if (entrada === "__tests__" || entrada === "node_modules") continue;
      saida.push(...arquivosDeFonte(caminho));
      continue;
    }
    if (entrada.endsWith(".ts") || entrada.endsWith(".tsx")) saida.push(caminho);
  }
  return saida;
}

describe("nenhum motor de cálculo lê o Book", () => {
  it.each(MOTORES_DE_CALCULO)(
    "@workspace/%s não referencia `book_entry`",
    (pacote) => {
      const dir = path.join(RAIZ, "lib", pacote, "src");
      const infratores = arquivosDeFonte(dir).filter((arquivo) => {
        const fonte = readFileSync(arquivo, "utf8");
        return /bookEntryTable|\bbook_entry\b/.test(fonte);
      });

      expect(
        infratores.map((f) => path.relative(RAIZ, f)),
        `um motor de cálculo passou a ler o Book. Um número da tela deixaria de ` +
          `ter lastro em \`fact\` — ver docs/AUDITORIA-INGESTAO-PROPAGACAO.md, Parte 1.3.`,
      ).toEqual([]);
    },
  );

  it("a varredura de fato olha para dentro dos arquivos — a prova de que a prova funciona", () => {
    // Uma asserção de ausência que não sabe encontrar presença não prova nada.
    // `lib/knowledge` é o vizinho que *pode* citar o Book, e serve de controle:
    // se a varredura não o achar, ela não acharia um infrator tampouco.
    const citam = arquivosDeFonte(path.join(RAIZ, "lib", "knowledge", "src")).filter(
      (arquivo) => /bookEntryTable|\bbook_entry\b/.test(readFileSync(arquivo, "utf8")),
    );
    expect(citam.length).toBeGreaterThan(0);
  });
});
