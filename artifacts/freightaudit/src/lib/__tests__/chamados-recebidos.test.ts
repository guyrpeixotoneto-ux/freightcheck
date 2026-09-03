import { describe, expect, it } from "vitest";

import {
  contaDaLeitura,
  emAndamento,
  envioQueLeu,
  ESTADOS_DO_ENVIO,
  estadoDoEnvio,
  leituraSemChamados,
  mesmoConteudo,
  nomeDoCampo,
  NOMES_DE_CAMPO,
  origemDaSerie,
  type TicketImportSummary,
} from "@/lib/chamados-recebidos";

/**
 * O contrato da lista de exports recebidos, em Importações › Chamados.
 *
 * O que estes casos prendem é o que a aba passou a afirmar quando deixou de ser
 * o painel analítico de Alterações: **cada arquivo recebido tem a sua linha, e
 * o que se diz sobre ele é verdade sobre ele.** As três afirmações que a versão
 * anterior não sustentava — o envio que falhou existia só como um agregado, a
 * duplicata não tinha para onde apontar, e "zero chamados" era a mesma frase em
 * quatro situações diferentes — moram aqui, em funções puras, para não
 * dependerem de montar tela.
 */

const envio = (
  parcial: Partial<TicketImportSummary> = {},
): TicketImportSummary => ({
  id: "1",
  filename: "Chamados Camaçari.xlsx",
  status: "READ",
  contentSha256: "a".repeat(64),
  byteSize: 12345,
  receivedAt: "2026-08-16T10:00:00.000Z",
  receivedBy: "alguem@exemplo.com",
  finishedAt: "2026-08-16T10:00:12.000Z",
  rowCount: 1218,
  ticketCount: 1218,
  ignoredRowCount: 0,
  unmappedColumns: [],
  parameterColumns: [],
  columnMapping: {},
  failureReason: null,
  serie: "CAMAÇARI",
  serieOrigem: "ARQUIVO",
  ...parcial,
});

describe("os nomes dos campos, no painel de mapeamento", () => {
  /*
    O painel existe para não haver jargão, e mostrava `unidadeRaw` e
    `vigenciaLabel` crus no meio de uma lista em português porque metade dos
    campos não tinha nome no dicionário. O tipo `Record<TicketField, string>` é
    quem impede isso de voltar — este caso é o lembrete do porquê.
  */
  it("nomeia em português os campos que mais aparecem no export real", () => {
    expect(nomeDoCampo("unidadeRaw")).toBe("unidade");
    expect(nomeDoCampo("vigenciaLabel")).toBe("vigência de abertura");
    expect(nomeDoCampo("externalId")).toBe("número do chamado");
  });

  it("nenhum nome é o próprio identificador interno", () => {
    for (const [campo, nome] of Object.entries(NOMES_DE_CAMPO))
      expect(nome).not.toBe(campo);
  });

  it("um campo que o dicionário não conhece sai como veio, e não some", () => {
    expect(nomeDoCampo("campoQueAindaNaoExiste")).toBe("campoQueAindaNaoExiste");
  });
});

describe("os estados do envio", () => {
  it("traduz os cinco estados que a máquina de chamados tem", () => {
    expect(Object.keys(ESTADOS_DO_ENVIO).sort()).toEqual([
      "FAILED",
      "PENDING",
      "READ",
      "READING",
      "SKIPPED_DUPLICATE",
    ]);
  });

  it("READ é sucesso, e não um estado de espera — aqui ler é o passo inteiro", () => {
    expect(estadoDoEnvio("READ")).toEqual({ rotulo: "lido", tom: "ok" });
  });

  it("duplicata é neutra, nunca erro: é o SHA-256 tendo feito o trabalho dele", () => {
    expect(estadoDoEnvio("SKIPPED_DUPLICATE").tom).toBe("neutro");
  });

  it("um estado que ninguém conhece não vaza o nome interno em maiúsculas", () => {
    expect(estadoDoEnvio("ALGO_NOVO").rotulo).toBe("algo_novo");
  });

  it("só na fila e lendo são andamento — READ não fica pedindo de novo", () => {
    expect(emAndamento("PENDING")).toBe(true);
    expect(emAndamento("READING")).toBe(true);
    expect(emAndamento("READ")).toBe(false);
    expect(emAndamento("FAILED")).toBe(false);
    expect(emAndamento("SKIPPED_DUPLICATE")).toBe(false);
  });

  it("um estado desconhecido conta como andamento — esperar custa menos que encerrar cedo", () => {
    expect(emAndamento("ALGO_NOVO")).toBe(true);
  });
});

describe("a conta das linhas", () => {
  it("fecha quando todo destino foi contado", () => {
    const conta = contaDaLeitura(
      envio({ rowCount: 1220, ticketCount: 1218, ignoredRowCount: 2 }),
    );
    expect(conta).toEqual({ aferivel: true, fecha: true, diferenca: 0 });
  });

  it("denuncia a linha que sumiu sem destino registrado", () => {
    const conta = contaDaLeitura(
      envio({ rowCount: 1220, ticketCount: 1200, ignoredRowCount: 2 }),
    );
    expect(conta.fecha).toBe(false);
    expect(conta.diferenca).toBe(18);
  });

  /*
    O caso que gerava alarme falso: enquanto a leitura não termina os três
    contadores estão em zero porque nada foi gravado ainda, e chamar isso de
    divergência seria acusar o relógio.
  */
  it("não afere o envio que ainda está sendo lido", () => {
    const conta = contaDaLeitura(
      envio({ status: "READING", rowCount: 0, ticketCount: 0, ignoredRowCount: 0 }),
    );
    expect(conta.aferivel).toBe(false);
    expect(conta.fecha).toBe(false);
  });

  it("não afere o envio que falhou — nada foi gravado, não há conta", () => {
    expect(contaDaLeitura(envio({ status: "FAILED" })).aferivel).toBe(false);
  });
});

describe("zero chamados não é uma situação só", () => {
  it("com chamados, não há o que dizer", () => {
    expect(leituraSemChamados(envio())).toBeNull();
  });

  it("em leitura: espere", () => {
    expect(leituraSemChamados(envio({ status: "READING", ticketCount: 0 }))).toBe(
      "EM_LEITURA",
    );
  });

  it("falhou: o motivo está gravado", () => {
    expect(leituraSemChamados(envio({ status: "FAILED", ticketCount: 0 }))).toBe(
      "FALHOU",
    );
  });

  it("duplicata: o arquivo nem chegou a ser aberto", () => {
    expect(
      leituraSemChamados(envio({ status: "SKIPPED_DUPLICATE", ticketCount: 0 })),
    ).toBe("DUPLICATA");
  });

  /*
    O caso silencioso, e o motivo de esta função existir: o arquivo entrou, a
    leitura terminou sem erro nenhum e não saiu um chamado sequer. Sem separá-lo
    dos outros três, ele se lê como qualquer um deles.
  */
  it("lido inteiro e sem reconhecer um chamado sequer é caso próprio", () => {
    expect(
      leituraSemChamados(envio({ status: "READ", rowCount: 440, ticketCount: 0 })),
    ).toBe("LIDO_SEM_CHAMADOS");
  });
});

describe("a série, e o quanto se pode confiar nela", () => {
  it("lida das linhas do arquivo, sobrevive a alguém renomear o arquivo", () => {
    expect(origemDaSerie(envio({ serieOrigem: "ARQUIVO" }))).toEqual({
      serie: "CAMAÇARI",
      origem: "lida da coluna Unidade das linhas",
      confiavel: true,
    });
  });

  it("lida do nome do arquivo, não sobrevive — e a tela precisa dizer isso", () => {
    expect(origemDaSerie(envio({ serieOrigem: "NOME_DO_ARQUIVO" }))?.confiavel).toBe(
      false,
    );
  });

  it("mista é o arquivo que nomeia mais de uma unidade", () => {
    expect(origemDaSerie(envio({ serieOrigem: "MISTA" }))?.confiavel).toBe(false);
  });

  /*
    `null` é série indeterminada, e não "compara com qualquer um": o motor a
    trata como uma série própria. Comparar Recife com Camaçari produziria
    "todos os chamados de Recife sumiram" — movimentação falsa em massa.
  */
  it("sem série não há o que dizer — e a tela não inventa uma", () => {
    expect(origemDaSerie(envio({ serie: null, serieOrigem: null }))).toBeNull();
  });
});

describe("o mesmo conteúdo em mais de um envio", () => {
  const lido = envio({ id: "1", status: "READ" });
  const recusado = envio({
    id: "2",
    status: "SKIPPED_DUPLICATE",
    filename: "Chamados Camaçari (1).xlsx",
    ticketCount: 0,
    rowCount: 0,
  });
  const outro = envio({ id: "3", contentSha256: "b".repeat(64) });
  const todos = [recusado, lido, outro];

  it("acha os irmãos pelo SHA-256, e não pelo nome do arquivo", () => {
    expect(mesmoConteudo(todos, recusado).map((e) => e.id)).toEqual(["1"]);
  });

  it("não conta o próprio envio como irmão de si mesmo", () => {
    expect(mesmoConteudo(todos, outro)).toEqual([]);
  });

  /*
    É isto que transforma "arquivo já recebido" numa frase verificável: a
    duplicata aponta para o envio que de fato leu o conteúdo, em vez de mandar
    quem lê procurar na lista qual dos arquivos com o mesmo nome foi o bom.
  */
  it("a duplicata aponta para quem leu o conteúdo", () => {
    expect(envioQueLeu(todos, recusado)?.id).toBe("1");
  });

  it("quando o envio que leu já foi excluído, não aponta para lugar nenhum", () => {
    expect(envioQueLeu([recusado, outro], recusado)).toBeNull();
  });
});
