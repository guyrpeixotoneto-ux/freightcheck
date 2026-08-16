import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "../testing";
import { readTicketImport, receiveTicketFile } from "../chamados";
import {
  TicketImportDeletionRefused,
  deleteTicketImport,
  listTicketImportDeletions,
  planTicketImportDeletion,
  porQueNaoDaParaExcluir,
} from "../chamados-deletion";

/**
 * Excluir um envio de chamados, e o que "excluir" quer dizer aqui.
 *
 * O teste ataca as duas metades da promessa. A primeira é que a coisa some de
 * verdade — sem chamado, sem alteração, e com o arquivo liberado para ser
 * reenviado, que é o efeito que o operador vai procurar depois de ter mandado o
 * export errado. A segunda é que ela some **sozinha**: o envio ao lado continua
 * inteiro, e o registro da exclusão não tem porta de saída.
 */

/*
  O diretório de recebidos é apontado para um temporário antes de qualquer
  envio: é ele que decide se o arquivo em disco é nosso para apagar, e sem isto
  o teste do arquivo removido não provaria nada — `removerArquivo` recusaria
  qualquer caminho de fora do diretório configurado, que é o comportamento
  correto e o que o tornaria vazio.
*/
const RECEBIDOS = mkdtempSync(path.join(os.tmpdir(), "chamados-exclusao-"));
process.env.IMPORT_STORAGE_DIR = RECEBIDOS;

let ctx: TestDb;

const EXPORT_DE_CHAMADOS = [
  "Chamado,Status,Placa,Parâmetro,Valor pedido,Valor aplicado",
  "CH-100,Atendido,ABC1D23,Pedágio,1000,1200",
  "CH-101,Atendido,ABC1D23,Seguro,300,300",
  "CH-102,Em análise,XYZ9W88,Pedágio,500,",
].join("\n");

/** Um export em disco, dentro do diretório de recebidos. */
function arquivoDeChamados(conteudo: string, nome: string): string {
  const caminho = path.join(RECEBIDOS, nome);
  writeFileSync(caminho, conteudo, "utf8");
  return caminho;
}

async function importar(
  conteudo: string,
  nome: string,
  opcoes: { ler?: boolean } = {},
) {
  const recebido = await receiveTicketFile(ctx.db, {
    filePath: arquivoDeChamados(conteudo, nome),
    filename: nome,
    receivedBy: "quem.importou@exemplo.com",
  });
  if (opcoes.ler !== false && !recebido.isDuplicate) {
    await readTicketImport(ctx.db, recebido.ticketImportId);
  }
  return recebido;
}

async function contar(query: string): Promise<number> {
  const { rows } = await ctx.pool.query<{ n: string }>(query);
  return Number(rows[0].n);
}

beforeAll(async () => {
  ctx = await createTestDatabase("chamados_deletion");
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("excluir um envio de chamados", () => {
  it("tira os chamados, as alterações e o arquivo — e libera o reenvio", async () => {
    const recebido = await importar(EXPORT_DE_CHAMADOS, "agosto.csv");
    const caminho = path.join(RECEBIDOS, "agosto.csv");

    expect(await contar("SELECT count(*) AS n FROM ticket")).toBe(3);
    expect(await contar("SELECT count(*) AS n FROM ticket_change")).toBe(3);

    // A prévia promete, e a exclusão cumpre: são a mesma conta, escrita uma vez.
    const previa = await planTicketImportDeletion(ctx.db, recebido.ticketImportId);
    expect(previa?.refusal).toBeNull();
    expect(previa?.removes).toMatchObject({
      tickets: 3,
      ticketChanges: 3,
      storedFile: 1,
    });

    const resultado = await deleteTicketImport(ctx.db, recebido.ticketImportId, {
      deletedBy: "quem.excluiu@exemplo.com",
      reason: "export de teste",
    });
    expect(resultado.removed).toEqual(previa!.removes);

    expect(await contar("SELECT count(*) AS n FROM ticket")).toBe(0);
    expect(await contar("SELECT count(*) AS n FROM ticket_change")).toBe(0);
    expect(await contar("SELECT count(*) AS n FROM ticket_import")).toBe(0);
    expect(existsSync(caminho)).toBe(false);

    // O registro sobrevive ao dado: é a única forma de "isto foi apagado"
    // continuar sendo uma afirmação verificável depois.
    const historico = await listTicketImportDeletions(ctx.db);
    expect(historico).toHaveLength(1);
    expect(historico[0]).toMatchObject({
      filename: "agosto.csv",
      importStatus: "READ",
      deletedBy: "quem.excluiu@exemplo.com",
      reason: "export de teste",
    });
    expect(historico[0].removed.ticketChanges).toBe(3);

    // E o mesmo conteúdo volta a entrar: era o SHA-256 do envio excluído que o
    // recusava, e sair do banco é o que devolve esse direito.
    const reenvio = await importar(EXPORT_DE_CHAMADOS, "agosto.csv");
    expect(reenvio.isDuplicate).toBe(false);
    expect(await contar("SELECT count(*) AS n FROM ticket")).toBe(3);

    await deleteTicketImport(ctx.db, reenvio.ticketImportId, {
      deletedBy: "limpeza@exemplo.com",
    });
  });

  it("leva junto a tentativa que foi recusada como duplicata", async () => {
    const primeiro = await importar(EXPORT_DE_CHAMADOS, "setembro.csv");
    const repetido = await importar(EXPORT_DE_CHAMADOS, "setembro-de-novo.csv");
    expect(repetido.isDuplicate).toBe(true);
    expect(await contar("SELECT count(*) AS n FROM ticket_import")).toBe(2);

    const previa = await planTicketImportDeletion(ctx.db, primeiro.ticketImportId);
    expect(previa?.removes.duplicateAttempts).toBe(1);

    await deleteTicketImport(ctx.db, primeiro.ticketImportId, {
      deletedBy: "quem.excluiu@exemplo.com",
    });

    /*
      A recusa não carregava dado nenhum, mas apontava para o mesmo conteúdo — e
      sozinha ela deixaria na tela um envio órfão, apontando para um arquivo que
      já não existe. Sai junto, e vira linha no registro em vez de sumir.
    */
    expect(await contar("SELECT count(*) AS n FROM ticket_import")).toBe(0);
    // O registro é do banco inteiro e append-only — as exclusões dos outros
    // casos continuam nele, e é isso que se espera de uma auditoria.
    const historico = await listTicketImportDeletions(ctx.db);
    expect(
      historico.map((h) => h.filename).filter((f) => f.startsWith("setembro")).sort(),
    ).toEqual(["setembro-de-novo.csv", "setembro.csv"]);
    expect(
      historico.find((h) => h.filename === "setembro-de-novo.csv")?.reason,
    ).toContain("duplicata");
  });

  it("não encosta no envio vizinho", async () => {
    const outubro = await importar(EXPORT_DE_CHAMADOS, "outubro.csv");
    const novembro = await importar(
      [
        "Chamado,Status,Placa,Parâmetro,Valor pedido,Valor aplicado",
        "CH-200,Atendido,QQQ1R11,Pedágio,900,950",
      ].join("\n"),
      "novembro.csv",
    );

    await deleteTicketImport(ctx.db, outubro.ticketImportId, {
      deletedBy: "quem.excluiu@exemplo.com",
    });

    expect(
      await contar(
        `SELECT count(*) AS n FROM ticket WHERE ticket_import_id = '${novembro.ticketImportId}'`,
      ),
    ).toBe(1);
    expect(await contar("SELECT count(*) AS n FROM ticket_import")).toBe(1);
    // O arquivo do vizinho continua onde estava.
    expect(existsSync(path.join(RECEBIDOS, "novembro.csv"))).toBe(true);

    await deleteTicketImport(ctx.db, novembro.ticketImportId, {
      deletedBy: "limpeza@exemplo.com",
    });
  });

  it("recusa um envio ainda em leitura, e libera o que ficou travado", async () => {
    const recebido = await importar(EXPORT_DE_CHAMADOS, "dezembro.csv", {
      ler: false,
    });
    await ctx.pool.query(
      `UPDATE ticket_import SET status = 'READING' WHERE id = $1`,
      [recebido.ticketImportId],
    );

    const previa = await planTicketImportDeletion(ctx.db, recebido.ticketImportId);
    expect(previa?.refusal).toContain("ainda está sendo lido");
    await expect(
      deleteTicketImport(ctx.db, recebido.ticketImportId, {
        deletedBy: "quem.excluiu@exemplo.com",
      }),
    ).rejects.toBeInstanceOf(TicketImportDeletionRefused);

    /*
      Esperar não pode ser para sempre. Quem lia era o servidor, e um deploy no
      meio da leitura leva junto quem terminaria o trabalho: o envio fica em
      READING sem ninguém por trás. Segurar a exclusão desse envio transformaria
      um reinício em sujeira permanente.
    */
    await ctx.pool.query(
      `UPDATE ticket_import SET received_at = now() - interval '2 hours' WHERE id = $1`,
      [recebido.ticketImportId],
    );
    const depois = await planTicketImportDeletion(ctx.db, recebido.ticketImportId);
    expect(depois?.refusal).toBeNull();
    await deleteTicketImport(ctx.db, recebido.ticketImportId, {
      deletedBy: "quem.excluiu@exemplo.com",
    });
    expect(await contar("SELECT count(*) AS n FROM ticket_import")).toBe(0);
  });

  it("recusa excluir o que não existe", async () => {
    await expect(
      deleteTicketImport(ctx.db, "00000000-0000-0000-0000-000000000000", {
        deletedBy: "quem.excluiu@exemplo.com",
      }),
    ).rejects.toThrow(/não encontrado/);
  });

  it("não deixa editar nem apagar o registro da exclusão", async () => {
    // Uma auditoria que se pode reescrever não é uma auditoria. A trigger da
    // 0020 recusa os dois verbos em qualquer circunstância.
    await expect(
      ctx.pool.query(`UPDATE ticket_import_deletion SET deleted_by = 'outro'`),
    ).rejects.toThrow(/append-only/);
    await expect(
      ctx.pool.query(`DELETE FROM ticket_import_deletion`),
    ).rejects.toThrow(/append-only/);
  });
});

describe("porQueNaoDaParaExcluir", () => {
  it("deixa passar o que já terminou, dê no que der", () => {
    for (const status of ["READ", "FAILED", "SKIPPED_DUPLICATE"]) {
      expect(porQueNaoDaParaExcluir(status, new Date())).toBeNull();
    }
  });

  it("segura só a leitura que ainda pode estar acontecendo", () => {
    expect(porQueNaoDaParaExcluir("READING", new Date())).toContain(
      "ainda está sendo lido",
    );
    expect(porQueNaoDaParaExcluir("PENDING", new Date())).toContain(
      "ainda está sendo lido",
    );
    const faz2Horas = new Date(Date.now() - 2 * 60 * 60 * 1000);
    expect(porQueNaoDaParaExcluir("READING", faz2Horas)).toBeNull();
  });
});
