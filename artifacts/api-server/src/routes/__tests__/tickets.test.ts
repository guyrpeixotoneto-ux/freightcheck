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
import {
  contarVigenciasNoRecorte,
  decodeTicketUpload,
  eixoParaTela,
  faltaOSchemaDeChamados,
  parseJanela,
} from "../tickets";

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

/**
 * O recorte De/Até da aba Chamados, do lado da rota.
 *
 * Três decisões deste arquivo, e nenhuma delas mora na biblioteca: como a query
 * vira pedido, como o eixo vira seletor, e o que a tela lê como "N de M".
 */
describe("parseJanela", () => {
  it("sem pontas, não há recorte — e null é o envio inteiro", () => {
    expect(parseJanela({})).toBeNull();
    // Vazio não é valor: `?de=` sem nada viraria um recorte que a tela anuncia
    // e o servidor descarta.
    expect(parseJanela({ de: "", ate: "" })).toBeNull();
  });

  it("aceita meia janela, que é um pedido legítimo", () => {
    expect(parseJanela({ de: "2026-02-01" })).toEqual({
      de: "2026-02-01",
      ate: undefined,
    });
    expect(parseJanela({ ate: "2026-02-01" })).toEqual({
      de: undefined,
      ate: "2026-02-01",
    });
  });

  it("ignora o que não é texto, em vez de deixar chegar ao SQL", () => {
    expect(parseJanela({ de: 20260201, ate: ["2026-03-01"] })).toBeNull();
  });
});

describe("eixoParaTela", () => {
  const eixo = {
    disponiveis: ["2026-01-01", "2026-02-01"],
    rotulos: {
      "2026-01-01": ["EMPURRADA_1_1_2026"],
      // O mesmo dia escrito de duas formas: filtrar usa as duas, o seletor
      // mostra uma — dois nomes numa opção fariam uma diferença de escrita
      // parecer uma diferença de período.
      "2026-02-01": ["EMPURRADA_01_2_2026", "EMPURRADA_1_2_2026"],
    },
    semVigencia: 3,
  };

  it("dá uma legenda por data, e leva o contador do que fica de fora", () => {
    expect(eixoParaTela(eixo)).toEqual({
      disponiveis: ["2026-01-01", "2026-02-01"],
      rotulos: {
        "2026-01-01": "EMPURRADA_1_1_2026",
        "2026-02-01": "EMPURRADA_01_2_2026",
      },
      semVigencia: 3,
    });
  });

  it("conta as vigências que o recorte alcançou, e zero quando não alcança nada", () => {
    expect(contarVigenciasNoRecorte(eixo, null)).toBe(2);
    expect(contarVigenciasNoRecorte(eixo, ["EMPURRADA_1_1_2026"])).toBe(1);
    // Uma data conta uma vez, mesmo entrando pelas duas grafias.
    expect(
      contarVigenciasNoRecorte(eixo, ["EMPURRADA_01_2_2026", "EMPURRADA_1_2_2026"]),
    ).toBe(1);
    // Recorte que nenhuma vigência atende: zero, e não o eixo inteiro.
    expect(contarVigenciasNoRecorte(eixo, [])).toBe(0);
  });
});
