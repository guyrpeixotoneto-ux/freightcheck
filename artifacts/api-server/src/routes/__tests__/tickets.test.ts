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
import { decodeTicketUpload, faltaOSchemaDeChamados } from "../tickets";

/**
 * Banco desatualizado não é defeito do pedido.
 *
 * Este caso existe porque a tela mostrou "Internal server error" para um export
 * perfeito, nas duas pontas — no upload e na listagem —, num ambiente onde as
 * migrations de chamados não tinham rodado. A frase mandava procurar no arquivo,
 * que estava certo.
 */
describe("faltaOSchemaDeChamados", () => {
  it("reconhece coluna que não existe — o caso mais traiçoeiro", () => {
    // A 0012 cria as tabelas e as 0013/0014 acrescentam colunas: num banco
    // parado na 0012 a tabela existe, então nada indica "falta migration", e
    // toda consulta morre por causa de uma coluna.
    expect(faltaOSchemaDeChamados({ code: "42703" })).toBe(true);
  });

  it("reconhece tabela e tipo que não existem", () => {
    expect(faltaOSchemaDeChamados({ code: "42P01" })).toBe(true);
    expect(faltaOSchemaDeChamados({ code: "42704" })).toBe(true);
  });

  it("enxerga o código através do erro que o embrulha", () => {
    // O drizzle embrulha o erro do driver; sem descer pelo `cause` o código
    // some e a falha volta a ser um 500 mudo.
    expect(faltaOSchemaDeChamados({ cause: { code: "42703" } })).toBe(true);
  });

  it("não confunde defeito de verdade com migration faltando", () => {
    expect(faltaOSchemaDeChamados({ code: "23505" })).toBe(false);
    expect(faltaOSchemaDeChamados(new Error("boom"))).toBe(false);
    expect(faltaOSchemaDeChamados(null)).toBe(false);
  });
});

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
