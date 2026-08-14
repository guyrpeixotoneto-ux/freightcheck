/**
 * O que o upload de chamados recusa antes de gravar qualquer coisa.
 *
 * A diferença para `decodeUpload` da vigência é uma só, e é de fonte e não de
 * rigor: aqui o `.csv` é aceito, porque é assim que a fila do Freightech
 * exporta. Daí decorre a regra que estes casos protegem — a assinatura "PK" só
 * pode ser cobrada do `.xlsx`; cobrá-la do `.csv` recusaria justamente o
 * arquivo certo, com uma mensagem sobre estrutura de zip que não ajudaria
 * ninguém.
 */
import { describe, expect, it } from "vitest";
import { decodeTicketUpload } from "../tickets";

/** Um zip mínimo: a assinatura que todo .xlsx carrega nos dois primeiros bytes. */
const zipBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const zipBase64 = zipBytes.toString("base64");

const csvBytes = Buffer.from("Chamado,Status\nCH-1,Aberto");
const csvBase64 = csvBytes.toString("base64");

describe("decodeTicketUpload", () => {
  it("aceita um .xlsx e devolve os bytes", () => {
    const result = decodeTicketUpload({
      filename: "chamados-agosto.xlsx",
      contentBase64: zipBase64,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.filename).toBe("chamados-agosto.xlsx");
    expect(result.value.extension).toBe(".xlsx");
    expect(result.value.bytes.equals(zipBytes)).toBe(true);
  });

  it("aceita um .csv sem exigir dele a assinatura de zip", () => {
    // O caso que motiva a rota separada: um CSV é texto, e recusá-lo por não
    // começar com "PK" obrigaria quem opera a abrir e salvar de novo no Excel
    // só para nos agradar.
    const result = decodeTicketUpload({
      filename: "fila.csv",
      contentBase64: csvBase64,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extension).toBe(".csv");
    expect(result.value.bytes.equals(csvBytes)).toBe(true);
  });

  it("recusa outra extensão dizendo quais são as esperadas", () => {
    const result = decodeTicketUpload({
      filename: "chamados.pdf",
      contentBase64: zipBase64,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/\.xlsx/);
    expect(result.error).toMatch(/\.csv/);
  });

  it("recusa um .xlsx que na verdade é texto, e sugere a saída", () => {
    const result = decodeTicketUpload({
      filename: "chamados.xlsx",
      contentBase64: csvBase64,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Aqui a saída existe e a mensagem precisa dizê-la: renomear para .csv,
    // que esta rota lê.
    expect(result.error).toMatch(/renomeie para \.csv/i);
  });

  it("recusa base64 inválido em vez de aceitar bytes truncados", () => {
    const result = decodeTicketUpload({
      filename: "fila.csv",
      contentBase64: `${csvBase64}!!`,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/base64/i);
  });

  it("recusa arquivo vazio", () => {
    const result = decodeTicketUpload({ filename: "fila.csv", contentBase64: "  " });
    expect(result.ok).toBe(false);
  });

  it("guarda só o nome, nunca o caminho que veio junto", () => {
    const result = decodeTicketUpload({
      filename: "../../etc/fila.csv",
      contentBase64: csvBase64,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.filename).toBe("fila.csv");
  });

  it("recusa corpo que não é objeto, sem estourar", () => {
    expect(decodeTicketUpload(null).ok).toBe(false);
    expect(decodeTicketUpload("fila.csv").ok).toBe(false);
  });
});
