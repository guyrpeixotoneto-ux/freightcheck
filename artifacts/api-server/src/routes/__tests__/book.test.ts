/**
 * O que uma entrada do Book do Operador recusa antes de gravar.
 *
 * Cada caso aqui é uma recusa que impede um erro de aparecer longe da causa: um
 * `.pdf` que na verdade é outra coisa e só falharia no computador de quem
 * baixasse, um formato que este produto não deveria guardar, um arquivo grande
 * demais que voltaria como 413 do parser sem dizer qual é o limite, um texto
 * que só tem espaços.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_DOCUMENT_BYTES,
  MAX_TEXT_CHARS,
  contentDisposition,
  decodeBookEntry,
  faltaOSchemaDoBook,
  formatarBytes,
  nomeDeTexto,
} from "../book";

/** Os quatro bytes que todo PDF carrega: `%PDF`. */
const pdfBytes = Buffer.concat([
  Buffer.from([0x25, 0x50, 0x44, 0x46]),
  Buffer.from("-1.7\n%fim"),
]);
const pdfBase64 = pdfBytes.toString("base64");

const bloco = {
  blockKey: "Freightech::Book do operador",
  blockCategory: "Freightech",
  blockTitle: "Book do operador",
};

describe("decodeBookEntry — DOCUMENTO", () => {
  it("aceita um PDF e devolve os bytes com o mime do formato", () => {
    const result = decodeBookEntry({
      ...bloco,
      kind: "DOCUMENTO",
      filename: "Book do Operador 2026.pdf",
      contentBase64: pdfBase64,
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.kind !== "DOCUMENTO") return;
    expect(result.value.filename).toBe("Book do Operador 2026.pdf");
    expect(result.value.mimeType).toBe("application/pdf");
    expect(result.value.content.equals(pdfBytes)).toBe(true);
    expect(result.value.byteSize).toBe(pdfBytes.length);
    expect(result.value.bodyText).toBeNull();
    expect(result.value.note).toBeNull();
  });

  it("aceita .docx e .xlsx pela assinatura de zip", () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04]).toString("base64");

    for (const nome of ["contrato.docx", "tabela.xlsx"]) {
      const result = decodeBookEntry({
        ...bloco,
        kind: "DOCUMENTO",
        filename: nome,
        contentBase64: zip,
      });
      expect(result.ok, nome).toBe(true);
    }
  });

  it("recusa um formato fora da lista dizendo quais são os aceitos", () => {
    const result = decodeBookEntry({
      ...bloco,
      kind: "DOCUMENTO",
      filename: "regras.exe",
      contentBase64: pdfBase64,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/\.exe/);
    expect(result.error).toMatch(/\.pdf/);
  });

  it("recusa arquivo sem extensão, porque não há como saber o que é", () => {
    const result = decodeBookEntry({
      ...bloco,
      kind: "DOCUMENTO",
      filename: "documento",
      contentBase64: pdfBase64,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/sem extensão/);
  });

  it("recusa conteúdo que não começa como o formato que o nome promete", () => {
    const result = decodeBookEntry({
      ...bloco,
      kind: "DOCUMENTO",
      filename: "regras.pdf",
      contentBase64: Buffer.from("isto aqui é texto puro").toString("base64"),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // A mensagem precisa falar do arquivo e sugerir a causa provável — o
    // arquivo renomeado —, e não do byte que faltou.
    expect(result.error).toMatch(/renomeado/);
  });

  it("aceita texto puro anexado sem exigir assinatura", () => {
    const result = decodeBookEntry({
      ...bloco,
      kind: "DOCUMENTO",
      filename: "regras.md",
      contentBase64: Buffer.from("# Regras\n").toString("base64"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mimeType).toBe("text/markdown");
  });

  it("recusa acima do teto dizendo o tamanho enviado e o limite", () => {
    const grande = Buffer.concat([
      Buffer.from([0x25, 0x50, 0x44, 0x46]),
      Buffer.alloc(MAX_DOCUMENT_BYTES),
    ]);

    const result = decodeBookEntry({
      ...bloco,
      kind: "DOCUMENTO",
      filename: "gigante.pdf",
      contentBase64: grande.toString("base64"),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/25\.0 MB/);
  });

  it("recusa base64 quebrado em vez de gravar um arquivo truncado", () => {
    const result = decodeBookEntry({
      ...bloco,
      kind: "DOCUMENTO",
      filename: "regras.pdf",
      contentBase64: "%%% isto não é base64 %%%",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/base64/);
  });

  it("tira o caminho do nome do arquivo", () => {
    const result = decodeBookEntry({
      ...bloco,
      kind: "DOCUMENTO",
      filename: "../../etc/passwd.pdf",
      contentBase64: pdfBase64,
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.kind !== "DOCUMENTO") return;
    expect(result.value.filename).toBe("passwd.pdf");
  });
});

describe("decodeBookEntry — TEXTO", () => {
  it("aceita a regra escrita e conta o tamanho em bytes de UTF-8", () => {
    const result = decodeBookEntry({
      ...bloco,
      kind: "TEXTO",
      bodyText: "# Regra\n\nO pneu é remunerado por eixo.\n",
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.kind !== "TEXTO") return;
    expect(result.value.bodyText).toBe(
      "# Regra\n\nO pneu é remunerado por eixo.",
    );
    expect(result.value.mimeType).toBe("text/markdown");
    expect(result.value.filename).toBeNull();
    expect(result.value.content).toBeNull();
    // "é" ocupa dois bytes: o tamanho não é a contagem de caracteres.
    expect(result.value.byteSize).toBe(
      Buffer.byteLength(result.value.bodyText, "utf8"),
    );
  });

  it("preserva recuo e linha em branco no meio, aparando só as pontas", () => {
    const escrito = "\n\n# Título\n\n  - item recuado\n\nfim\n\n";
    const result = decodeBookEntry({
      ...bloco,
      kind: "TEXTO",
      bodyText: escrito,
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.kind !== "TEXTO") return;
    expect(result.value.bodyText).toBe("# Título\n\n  - item recuado\n\nfim");
  });

  it("recusa texto que só tem espaço, apontando as duas saídas", () => {
    const result = decodeBookEntry({
      ...bloco,
      kind: "TEXTO",
      bodyText: "   \n\t\n ",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/vazio/);
    expect(result.error).toMatch(/anexe/);
  });

  it("recusa texto acima do teto sugerindo o anexo no lugar", () => {
    const result = decodeBookEntry({
      ...bloco,
      kind: "TEXTO",
      bodyText: "a".repeat(MAX_TEXT_CHARS + 1),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/anexe o documento/);
  });

  it("recusa bodyText que não é texto", () => {
    const result = decodeBookEntry({ ...bloco, kind: "TEXTO", bodyText: 42 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/bodyText/);
  });
});

describe("decodeBookEntry — o que vale para os dois tipos", () => {
  it("exige um kind conhecido", () => {
    for (const kind of [undefined, "OUTRO", 1]) {
      const result = decodeBookEntry({ ...bloco, kind, bodyText: "x" });
      expect(result.ok, String(kind)).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/DOCUMENTO/);
      expect(result.error).toMatch(/TEXTO/);
    }
  });

  it("exige a identificação do bloco", () => {
    for (const faltando of ["blockKey", "blockCategory", "blockTitle"]) {
      const corpo: Record<string, unknown> = {
        ...bloco,
        kind: "TEXTO",
        bodyText: "regra",
      };
      delete corpo[faltando];

      const result = decodeBookEntry(corpo);
      expect(result.ok, faltando).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(new RegExp(faltando));
    }
  });

  it("guarda a observação sem espaço em volta, e null quando vazia", () => {
    const comNota = decodeBookEntry({
      ...bloco,
      kind: "DOCUMENTO",
      filename: "manual.pdf",
      contentBase64: pdfBase64,
      note: "  versão assinada em 08/2026  ",
    });
    expect(comNota.ok && comNota.value.note).toBe("versão assinada em 08/2026");

    const semNota = decodeBookEntry({
      ...bloco,
      kind: "TEXTO",
      bodyText: "regra",
      note: "   ",
    });
    expect(semNota.ok && semNota.value.note).toBeNull();
  });

  it("dá o mesmo sha256 para o mesmo conteúdo nos dois caminhos", () => {
    const texto = "a regra escrita";
    const comoTexto = decodeBookEntry({
      ...bloco,
      kind: "TEXTO",
      bodyText: texto,
    });
    const comoArquivo = decodeBookEntry({
      ...bloco,
      kind: "DOCUMENTO",
      filename: "regra.md",
      contentBase64: Buffer.from(texto).toString("base64"),
    });

    expect(comoTexto.ok && comoArquivo.ok).toBe(true);
    if (!comoTexto.ok || !comoArquivo.ok) return;
    /*
      O hash coincide porque os bytes são os mesmos — e é por isso que a rota
      compara o tipo junto dele. Um texto e um arquivo idênticos ainda são duas
      entradas diferentes, e sem o tipo na comparação a segunda seria descartada
      como reenvio.
    */
    expect(comoTexto.value.contentSha256).toBe(comoArquivo.value.contentSha256);
    expect(comoTexto.value.kind).not.toBe(comoArquivo.value.kind);
  });
});

/**
 * O erro que não é sobre o arquivo.
 *
 * Um .docx perfeito voltou com "Internal server error" porque a tabela do Book
 * não existia naquele banco — a migration que a cria não tinha rodado. A frase
 * mandava procurar defeito no envio; a causa estava a um `pnpm migrate` de
 * distância. Reconhecer o SQLSTATE é o que permite responder isso.
 */
describe("faltaOSchemaDoBook", () => {
  it("reconhece tabela e tipo inexistentes, que é o mesmo diagnóstico", () => {
    // 42P01: relação inexistente (a tabela book_entry).
    expect(faltaOSchemaDoBook(Object.assign(new Error(), { code: "42P01" }))).toBe(true);
    // 42704: objeto inexistente (o enum book_entry_kind).
    expect(faltaOSchemaDoBook(Object.assign(new Error(), { code: "42704" }))).toBe(true);
  });

  it("acha o código dentro do erro que o drizzle embrulha", () => {
    // É assim que ele chega de verdade: `DrizzleQueryError` por fora, com a
    // consulta e os parâmetros, e o erro do `pg` — o que tem o SQLSTATE — em
    // `cause`. Olhar só a superfície faria toda falha de banco virar 500.
    const embrulhado = Object.assign(new Error("Failed query: select …"), {
      cause: Object.assign(new Error('relation "book_entry" does not exist'), {
        code: "42P01",
      }),
    });

    expect(faltaOSchemaDoBook(embrulhado)).toBe(true);
  });

  it("não confunde com o que é mesmo erro de gravação", () => {
    // 23505 é a corrida de duas revisões — tem resposta própria, e um 503 de
    // "faltam migrations" ali mandaria recarregar a página sem motivo.
    expect(faltaOSchemaDoBook(Object.assign(new Error(), { code: "23505" }))).toBe(false);
    expect(faltaOSchemaDoBook(new Error("qualquer outra coisa"))).toBe(false);
    expect(faltaOSchemaDoBook(undefined)).toBe(false);
  });
});

describe("nomeDeTexto", () => {
  it("usa o título do bloco e a revisão, sem caractere que o disco recusa", () => {
    expect(nomeDeTexto("LUCRO - ARMAZÉM", 3)).toBe(
      "LUCRO - ARMAZÉM — revisão 3.md",
    );
    expect(nomeDeTexto("Chamados: Aprovações", 1)).toBe(
      "Chamados- Aprovações — revisão 1.md",
    );
  });

  it("não devolve nome vazio quando o título só tinha caractere proibido", () => {
    expect(nomeDeTexto("///", 1)).toBe("--- — revisão 1.md");
    expect(nomeDeTexto("   ", 2)).toBe("bloco — revisão 2.md");
  });
});

describe("contentDisposition", () => {
  it("leva o nome com acento inteiro no filename* e um fallback em ASCII", () => {
    const cabecalho = contentDisposition("Remuneração 2026.pdf");

    expect(cabecalho).toMatch(/^attachment; /);
    // O fallback não pode carregar byte alto — vira sublinhado, não some.
    expect(cabecalho).toMatch(/filename="Remunera__o 2026\.pdf"/);
    expect(cabecalho).toContain(
      `filename*=UTF-8''${encodeURIComponent("Remuneração 2026.pdf")}`,
    );
  });

  it("neutraliza aspas, que fechariam o parâmetro no meio do nome", () => {
    const cabecalho = contentDisposition('regra "boa".pdf');
    expect(cabecalho).toMatch(/filename="regra _boa_\.pdf"/);
  });
});

describe("formatarBytes", () => {
  it("escolhe a unidade que a pessoa usaria para falar do arquivo", () => {
    expect(formatarBytes(512)).toBe("512 B");
    expect(formatarBytes(2048)).toBe("2 KB");
    expect(formatarBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
