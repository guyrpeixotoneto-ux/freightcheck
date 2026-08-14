import { describe, expect, it } from "vitest";
import { extrairAnexo, lerZip, textoDoXml } from "../anexos";

/**
 * A extração é testada contra arquivos de verdade — zips reais, escritos com o
 * mesmo compressor que o Office usa, e não contra um objeto que finge ser um
 * documento. É a única forma de o teste falhar pelos motivos certos: um leitor
 * de zip que erra o deslocamento do cabeçalho local, ou um XML cujo texto vem
 * partido em várias execuções de formatação, só aparecem no arquivo verdadeiro.
 *
 * As fixtures são mínimas de propósito, e cada uma carrega um caso que já
 * quebrou implementações parecidas: texto partido em dois `<w:t>`, entidade
 * XML escapada, imagem em formato que o modelo não lê no meio das que ele lê,
 * e slides cuja ordem alfabética contradiz a ordem da apresentação.
 */

const DOCX = Buffer.from(
  "UEsDBBQAAAAIAMiqDl1hU7AHhgAAANUAAAARAAAAd29yZC9kb2N1bWVudC54bWxtjsEKwjAQRH9lCehJTD2IUNP24B/4B6uJUkk2Jcna+ve6oFjBy1uYmR3GdFPwcHcp95EatVlXqmvNWNt45uCowMumXI+NmpTop2gfcgdBEpT26PDGuThAYvRgHRgtujDNcrvVdvHj6HfPvOzgkTN7hOyuTBZhiWHYw6Un9H+e9WeS/m5un1BLAwQUAAAACADIqg5dUQ/aAkAAAABFAAAAFQAAAHdvcmQvbWVkaWEvaW1hZ2UxLnBuZ+sM8HPn5ZLiYmBg4PX0cAkC0owgzMEEJCeUB98DUjyeLo4hFXOSf5w/wMDAzMjIcPLfpPdAcQZPVz+XdU4JTQBQSwMEFAAAAAgAyKoOXUphAbMWAAAAFAAAABQAAAB3b3JkL21lZGlhL3RodW1iLmVtZstLzNdN1c3MTUxPzdXNSU3PLEvNAQBQSwECFAMUAAAACADIqg5dYVOwB4YAAADVAAAAEQAAAAAAAAAAAAAAgAEAAAAAd29yZC9kb2N1bWVudC54bWxQSwECFAMUAAAACADIqg5dUQ/aAkAAAABFAAAAFQAAAAAAAAAAAAAAgAG1AAAAd29yZC9tZWRpYS9pbWFnZTEucG5nUEsBAhQDFAAAAAgAyKoOXUphAbMWAAAAFAAAABQAAAAAAAAAAAAAAIABKAEAAHdvcmQvbWVkaWEvdGh1bWIuZW1mUEsFBgAAAAADAAMAxAAAAHABAAAAAA==",
  "base64",
);
const PPTX = Buffer.from(
  "UEsDBBQAAAAIAMiqDl3kBUWsNgAAAD8AAAAVAAAAcHB0L3NsaWRlcy9zbGlkZTEueG1ssymwKs5JUajIzckrtkq0VapQsrNJtCoAESV2AUWZuamZRfkKxTmZKak2+iAxEAmU1gfrswMAUEsDBBQAAAAIAMiqDl0gCbCoNQAAAD4AAAAVAAAAcHB0L3NsaWRlcy9zbGlkZTIueG1ssymwKs5JUajIzckrtkq0VapQsrNJtCoAESV2wanppXkp+QrFOZkpqTb6ICEQCZTVB2uzAwBQSwMEFAAAAAgAyKoOXXJna6s0AAAAPQAAABYAAABwcHQvc2xpZGVzL3NsaWRlMTAueG1ssymwKs5JUajIzckrtkq0VapQsrNJtCoAESV2LqnJmbn5CsU5mSmpNvogERAJlNQH67IDAFBLAwQUAAAACADIqg5drj8hoBAAAAAOAAAAEwAAAHBwdC9tZWRpYS9mb3RvLmpwZWf7f+O/blpiTnG+blZBajoAUEsBAhQDFAAAAAgAyKoOXeQFRaw2AAAAPwAAABUAAAAAAAAAAAAAAIABAAAAAHBwdC9zbGlkZXMvc2xpZGUxLnhtbFBLAQIUAxQAAAAIAMiqDl0gCbCoNQAAAD4AAAAVAAAAAAAAAAAAAACAAWkAAABwcHQvc2xpZGVzL3NsaWRlMi54bWxQSwECFAMUAAAACADIqg5dcmdrqzQAAAA9AAAAFgAAAAAAAAAAAAAAgAHRAAAAcHB0L3NsaWRlcy9zbGlkZTEwLnhtbFBLAQIUAxQAAAAIAMiqDl2uPyGgEAAAAA4AAAATAAAAAAAAAAAAAACAATkBAABwcHQvbWVkaWEvZm90by5qcGVnUEsFBgAAAAAEAAQACwEAAHoBAAAAAA==",
  "base64",
);
const XLSX = Buffer.from(
  "UEsDBBQAAAAIAMiqDl0t9FkjLQAAAEsAAAAUAAAAeGwvc2hhcmVkU3RyaW5ncy54bWyzKS4usbMpzrSzKbELyElMTrTRB/L1QQIQQc+AMEd0MUcnZ0MXI2OEsD7IFABQSwMEFAAAAAgAyKoOXVxeeQZKAAAAlwAAABgAAAB4bC93b3Jrc2hlZXRzL3NoZWV0MS54bWyzKc8vyi7OSE0tsbMBUy6JJYl2NkX55XY2yQoltkrFSnY2ZXYGNvpldjb6ySiChnBBfbB6dE1GCE1g5UbGJnqmaHr0kSzVR7gFAFBLAQIUAxQAAAAIAMiqDl0t9FkjLQAAAEsAAAAUAAAAAAAAAAAAAACAAQAAAAB4bC9zaGFyZWRTdHJpbmdzLnhtbFBLAQIUAxQAAAAIAMiqDl1cXnkGSgAAAJcAAAAYAAAAAAAAAAAAAACAAV8AAAB4bC93b3Jrc2hlZXRzL3NoZWV0MS54bWxQSwUGAAAAAAIAAgCIAAAA3wAAAAAA",
  "base64",
);

const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MIME_PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

describe("leitor de zip", () => {
  it("abre um zip real e devolve os arquivos por caminho", () => {
    const arquivos = lerZip(DOCX);
    expect([...arquivos.keys()]).toContain("word/document.xml");
    expect(arquivos.get("word/document.xml")!.toString("utf8")).toContain("Reajuste");
  });

  it("devolve vazio para bytes que não são zip, sem lançar", () => {
    expect(lerZip(Buffer.from("nao sou um zip")).size).toBe(0);
  });
});

describe("texto de XML do Office", () => {
  it("junta execuções partidas e desescapa entidades", () => {
    const t = textoDoXml('<w:p><w:r><w:t>Reajuste de </w:t></w:r><w:r><w:t>7,5%</w:t></w:r></w:p>');
    expect(t).toBe("Reajuste de 7,5%");
  });
});

describe("Word", () => {
  it("tira o texto do documento, com o valor íntegro", () => {
    const r = extrairAnexo(MIME_DOCX, DOCX)!;
    expect(r.texto).toContain("Reajuste anual de 7,5%");
    expect(r.texto, "entidade XML volta a ser o caractere").toContain("Clausula segunda & final");
  });

  it("traz as figuras intactas e ignora o que o modelo não lê", () => {
    const r = extrairAnexo(MIME_DOCX, DOCX)!;
    expect(r.imagens).toHaveLength(1);
    expect(r.imagens[0].mimeType).toBe("image/png");
    // Os bytes são os do PNG original — a assinatura sobrevive ao base64.
    expect(Buffer.from(r.imagens[0].dados, "base64").subarray(1, 4).toString()).toBe("PNG");
  });
});

describe("PowerPoint", () => {
  it("põe os slides na ordem da apresentação, não na alfabética", () => {
    const r = extrairAnexo(MIME_PPTX, PPTX)!;
    const ordem = [...r.texto.matchAll(/\[slide (\d+)\]\n(.+)/g)].map((m) => m[2]);
    expect(ordem).toEqual(["Primeiro slide", "Segundo slide", "Decimo slide"]);
  });

  it("traz as figuras do deck", () => {
    expect(extrairAnexo(MIME_PPTX, PPTX)!.imagens[0]!.mimeType).toBe("image/jpeg");
  });
});

describe("Excel", () => {
  it("resolve as strings compartilhadas e mantém os números", () => {
    const r = extrairAnexo(MIME_XLSX, XLSX)!;
    expect(r.texto).toContain("Placa | IPVA");
    expect(r.texto).toContain("ABC1D23 | 1234.5");
  });
});

describe("texto puro", () => {
  it("entra como é, sem tradução nenhuma", () => {
    const r = extrairAnexo("text/plain", Buffer.from("regra escrita à mão"))!;
    expect(r.texto).toBe("regra escrita à mão");
    expect(r.imagens).toEqual([]);
  });

  it("vale para csv e markdown", () => {
    expect(extrairAnexo("text/csv", Buffer.from("a,b\n1,2"))!.texto).toBe("a,b\n1,2");
    expect(extrairAnexo("text/markdown", Buffer.from("# t"))!.texto).toBe("# t");
  });
});

describe("o que não tem caminho", () => {
  /*
    O `.doc` antigo é OLE2, não zip. Devolver null aqui é o que faz a resposta
    voltar a dizer que não leu o documento — que continua sendo verdade, e é
    melhor do que entregar o lixo binário que uma leitura otimista produziria.
  */
  it("formato legado devolve null", () => {
    expect(extrairAnexo("application/msword", Buffer.from("\xd0\xcf\x11\xe0qualquer"))).toBeNull();
  });

  it("arquivo vazio ou ilegível devolve null", () => {
    expect(extrairAnexo(MIME_DOCX, Buffer.from(""))).toBeNull();
    expect(extrairAnexo("text/plain", Buffer.from("   "))).toBeNull();
  });
});
