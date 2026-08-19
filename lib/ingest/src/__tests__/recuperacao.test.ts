import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "../testing";
import { varrerLeiturasOrfas, LEITURA_ORFA_MINUTOS } from "../recuperacao";
import { whyCannotDelete } from "../deletion";

/**
 * O beco sem saída do reinício, reproduzido — e a varredura que o abre.
 *
 * Comprovado em auditoria: o processo morre no meio de `readInBackground`, o
 * run fica em PENDING para sempre, o reenvio do mesmo arquivo volta 409
 * (duplicata) e a exclusão volta 409 ("ainda está sendo lida"). O usuário só
 * saía dali com um desenvolvedor mexendo no banco. Estas provas fixam:
 *
 * 1. leitura órfã (mais velha que o limite) vira estado terminal com motivo
 *    que diz o que fazer;
 * 2. leitura viva (recente) não é tocada — numa frota de instâncias, a partida
 *    de uma não pode matar a leitura em andamento de outra;
 * 3. o estado terminal destrava a exclusão imediatamente, sem esperar os 30
 *    minutos do zumbi.
 */

let banco: TestDb;

beforeAll(async () => {
  banco = await createTestDatabase("recuperacao");
}, 120_000);

afterAll(async () => {
  await banco.drop();
});

async function criarRunDeLeitura(opcoes: {
  sha: string;
  status: string;
  minutosAtras: number;
}): Promise<string> {
  const { rows } = await banco.pool.query<{ id: string }>(
    `WITH f AS (
       INSERT INTO source_file (filename, byte_size, content_sha256, storage_path, received_by)
       VALUES ('orfa.xlsx', 10, $1, '/tmp/orfa.xlsx', 'teste')
       RETURNING id
     )
     INSERT INTO import_run (source_file_id, status, started_at, triggered_by)
     SELECT id, $2::import_run_status, now() - ($3 || ' minutes')::interval, 'teste' FROM f
     RETURNING id`,
    [opcoes.sha, opcoes.status, String(opcoes.minutosAtras)],
  );
  return rows[0].id;
}

async function criarEnvioDeChamados(opcoes: {
  sha: string;
  status: string;
  minutosAtras: number;
}): Promise<string> {
  const { rows } = await banco.pool.query<{ id: string }>(
    `INSERT INTO ticket_import
       (filename, content_sha256, byte_size, storage_path, status, received_at, received_by)
     VALUES ('chamados.xlsx', $1, 10, '/tmp/chamados.xlsx',
             $2::ticket_import_status, now() - ($3 || ' minutes')::interval, 'teste')
     RETURNING id`,
    [opcoes.sha, opcoes.status, String(opcoes.minutosAtras)],
  );
  return rows[0].id;
}

describe("a varredura de leituras órfãs", () => {
  it("encerra o run órfão com motivo legível, e não toca no run vivo", async () => {
    const orfao = await criarRunDeLeitura({
      sha: "a".repeat(64),
      status: "READING",
      minutosAtras: LEITURA_ORFA_MINUTOS + 5,
    });
    const pendente = await criarRunDeLeitura({
      sha: "b".repeat(64),
      status: "PENDING",
      minutosAtras: LEITURA_ORFA_MINUTOS + 5,
    });
    const vivo = await criarRunDeLeitura({
      sha: "c".repeat(64),
      status: "READING",
      minutosAtras: 1,
    });

    const relatorio = await varrerLeiturasOrfas(banco.db);
    const encerrados = relatorio.importacoes.map((i) => i.importRunId).sort();
    expect(encerrados).toEqual([orfao, pendente].sort());

    const { rows } = await banco.pool.query<{
      id: string;
      status: string;
      failure_reason: string | null;
      finished_at: string | null;
    }>(`SELECT id, status, failure_reason, finished_at FROM import_run ORDER BY started_at`);

    const porId = new Map(rows.map((r) => [r.id, r]));
    expect(porId.get(orfao)!.status).toBe("ABORTED");
    expect(porId.get(orfao)!.failure_reason).toMatch(/reiniciado.*reenvie/is);
    expect(porId.get(orfao)!.finished_at).not.toBeNull();
    expect(porId.get(pendente)!.status).toBe("ABORTED");

    // A leitura viva de outra instância continua viva.
    expect(porId.get(vivo)!.status).toBe("READING");
    expect(porId.get(vivo)!.failure_reason).toBeNull();
  });

  it("o estado terminal destrava a exclusão na hora — sem esperar o zumbi de 30 min", () => {
    // Era o beco: PENDING recente recusava exclusão E o reenvio era duplicata.
    expect(whyCannotDelete("PENDING", new Date())).toMatch(/ainda está sendo lida/);
    // Depois da varredura, o mesmo run é excluível imediatamente.
    expect(whyCannotDelete("ABORTED", new Date())).toBeNull();
  });

  it("faz o mesmo pelos envios de chamados, no enum curto deles", async () => {
    const orfao = await criarEnvioDeChamados({
      sha: "d".repeat(64),
      status: "READING",
      minutosAtras: LEITURA_ORFA_MINUTOS + 5,
    });
    const vivo = await criarEnvioDeChamados({
      sha: "e".repeat(64),
      status: "PENDING",
      minutosAtras: 1,
    });

    const relatorio = await varrerLeiturasOrfas(banco.db);
    expect(relatorio.chamados.map((c) => c.ticketImportId)).toEqual([orfao]);

    const { rows } = await banco.pool.query<{ id: string; status: string; failure_reason: string | null }>(
      `SELECT id, status, failure_reason FROM ticket_import`,
    );
    const porId = new Map(rows.map((r) => [r.id, r]));
    expect(porId.get(orfao)!.status).toBe("FAILED");
    expect(porId.get(orfao)!.failure_reason).toMatch(/reiniciado/i);
    expect(porId.get(vivo)!.status).toBe("PENDING");
  });

  it("não toca em PROMOTING: a transação da promoção já se desfaz sozinha", async () => {
    const promovendo = await criarRunDeLeitura({
      sha: "f".repeat(64),
      status: "PROMOTING",
      minutosAtras: LEITURA_ORFA_MINUTOS + 5,
    });
    await varrerLeiturasOrfas(banco.db);
    const { rows } = await banco.pool.query<{ status: string }>(
      `SELECT status FROM import_run WHERE id = $1`,
      [promovendo],
    );
    expect(rows[0].status).toBe("PROMOTING");
  });

  it("é idempotente: a segunda passada não encontra nada", async () => {
    const segunda = await varrerLeiturasOrfas(banco.db);
    expect(segunda.importacoes).toEqual([]);
    expect(segunda.chamados).toEqual([]);
  });
});
