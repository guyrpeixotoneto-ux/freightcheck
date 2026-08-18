/**
 * O que o upload recusa antes de gravar qualquer coisa.
 *
 * Todo caso aqui é uma recusa que protege um erro de virar outro erro, mais
 * longe da causa: um base64 quebrado que só apareceria como zip corrompido
 * dentro do leitor, um CSV renomeado que só falharia na leitura de abas, um
 * nome de arquivo com caminho dentro. Recusar cedo é o que permite a mensagem
 * dizer o que a pessoa precisa fazer.
 */
import { describe, expect, it } from "vitest";
import { decodeUpload, whyCannotPromote } from "../imports";

/** Um zip mínimo: a assinatura que todo .xlsx carrega nos dois primeiros bytes. */
const zipBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const zipBase64 = zipBytes.toString("base64");

describe("decodeUpload", () => {
  it("aceita um .xlsx e devolve os bytes", () => {
    const result = decodeUpload({
      filename: "Modelo_Cavalo.xlsx",
      contentBase64: zipBase64,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.filename).toBe("Modelo_Cavalo.xlsx");
    expect(result.value.bytes.equals(zipBytes)).toBe(true);
  });

  it("recusa outra extensão dizendo qual é a esperada", () => {
    const result = decodeUpload({
      filename: "export.csv",
      contentBase64: zipBase64,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/\.xlsx/);
  });

  it("recusa conteúdo que não começa como .xlsx", () => {
    const result = decodeUpload({
      filename: "export.xlsx",
      contentBase64: Buffer.from("placa;valor\nABC1D23;10").toString("base64"),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // A mensagem precisa apontar para o arquivo, não para o zip: quem enviou
    // errado não sabe — nem tem por que saber — que .xlsx é um zip.
    expect(result.error).toMatch(/não é uma planilha do Excel/i);
  });

  it("recusa base64 inválido em vez de aceitar bytes truncados", () => {
    // `Buffer.from` descartaria o "!" em silêncio e devolveria um arquivo
    // menor do que o enviado — a pior falha possível: uma que parece sucesso.
    const result = decodeUpload({
      filename: "export.xlsx",
      contentBase64: `${zipBase64}!!`,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/base64/i);
  });

  it("aceita base64 quebrado em linhas", () => {
    const big = Buffer.concat([zipBytes, Buffer.alloc(200, 7)]);
    const wrapped = big.toString("base64").replace(/(.{20})/g, "$1\n");

    const result = decodeUpload({ filename: "e.xlsx", contentBase64: wrapped });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.bytes.equals(big)).toBe(true);
  });

  it("guarda só o nome do arquivo, nunca o caminho que veio junto", () => {
    const result = decodeUpload({
      filename: "../../etc/planilha.xlsx",
      contentBase64: zipBase64,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.filename).toBe("planilha.xlsx");
  });

  it("recusa arquivo vazio", () => {
    const result = decodeUpload({ filename: "e.xlsx", contentBase64: "  " });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/obrigatório/i);
  });

  it("recusa corpo sem os campos, sem estourar", () => {
    expect(decodeUpload(undefined).ok).toBe(false);
    expect(decodeUpload(null).ok).toBe(false);
    expect(decodeUpload({}).ok).toBe(false);
    expect(decodeUpload({ filename: 42, contentBase64: zipBase64 }).ok).toBe(
      false,
    );
  });
});

describe("o tipo declarado no upload", () => {
  const comTipo = (declaredType: unknown) =>
    decodeUpload({
      filename: "Modelo_Cavalo.xlsx",
      contentBase64: zipBase64,
      declaredType,
    });

  it("aceita o envio sem tipo — a dedução por conteúdo continua valendo", () => {
    const result = decodeUpload({
      filename: "Modelo_Cavalo.xlsx",
      contentBase64: zipBase64,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.declaredType).toBeNull();
  });

  it("carrega o tipo declarado até o pipeline", () => {
    const result = comTipo("CAVALO");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.declaredType).toBe("CAVALO");
  });

  it("carrega o QLP, que tem grão declarado como qualquer outro tipo", () => {
    const result = comTipo("QLP_OPERACIONAL");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.declaredType).toBe("QLP_OPERACIONAL");
  });

  it("recusa um tipo que não existe", () => {
    const result = comTipo("BITREM");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/não é um tipo de importação conhecido/);
  });

  it("recusa um tipo que não é texto em vez de o converter", () => {
    const result = comTipo(42);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/precisa ser texto/);
  });
});

describe("whyCannotPromote", () => {
  it("deixa passar só o run já conferido", () => {
    expect(whyCannotPromote("PREVIEWED")).toBeNull();
  });

  it("diz que já entrou, quando já entrou", () => {
    // O caso mais comum é o segundo clique — ou a segunda aba aberta. A
    // resposta precisa ser essa frase, e não o estado interno da máquina.
    expect(whyCannotPromote("PROMOTED")).toMatch(/já foi aprovada/i);
  });

  it("separa 'ainda lendo' de 'deu errado'", () => {
    expect(whyCannotPromote("READING")).toMatch(/ainda está sendo lido/i);
    expect(whyCannotPromote("FAILED")).toMatch(/falhou/i);
  });

  it("separa arquivo repetido de dado repetido, em vez de dizer só 'duplicata'", () => {
    // "Duplicata" era uma palavra só, e escondia duas situações que o operador
    // lê de formas diferentes. Uma diz "você já mandou este arquivo"; a outra
    // diz "o arquivo é outro, mas o número não vai mudar" — e é essa segunda
    // que evita a pergunta "então por que meu dado não apareceu?".
    const arquivo = whyCannotPromote("SKIPPED_DUPLICATE")!;
    expect(arquivo).toMatch(/já foi recebido anteriormente/i);
    expect(arquivo).toMatch(/nenhum dado foi importado novamente/i);

    const dados = whyCannotPromote("SKIPPED_DUPLICATE_DATA")!;
    expect(dados).toMatch(/o arquivo é diferente/i);
    expect(dados).toMatch(/dados normalizados/i);
    expect(dados).toMatch(/nenhum dado foi duplicado/i);

    expect(arquivo).not.toBe(dados);
  });

  it("diz que o dado não fecha, e que o caminho é reenviar", () => {
    const erro = whyCannotPromote("VALIDATION_ERROR")!;
    expect(erro).toMatch(/não fecha/i);
    expect(erro).toMatch(/envie o arquivo de novo/i);
  });

  it("um estado novo no futuro ainda recusa, e diz qual é", () => {
    // Um enum que ganhe um estado não pode virar uma aprovação por descuido:
    // o padrão é recusar, nomeando o que se viu.
    expect(whyCannotPromote("QUARENTENA")).toMatch(/quarentena/i);
  });
});
