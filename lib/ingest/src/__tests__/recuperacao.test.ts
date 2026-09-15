import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "../testing";
import {
  varrerLeiturasOrfas,
  LEITURA_ORFA_MINUTOS,
  PROMOCAO_ORFA_MINUTOS,
} from "../recuperacao";
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

/**
 * Uma aprovação em curso — reservada há tantos minutos.
 *
 * `promocao_em` é o relógio dela, e não `started_at`: um arquivo aprovado três
 * dias depois de enviado tem `started_at` antiquíssimo e uma aprovação recém
 * começada. Escrever os dois separados aqui é o que deixa essa distinção
 * exercitada em vez de presumida.
 */
async function criarPromocaoEmCurso(opcoes: {
  sha: string;
  minutosDaPromocao: number;
  minutosDoRun?: number;
}): Promise<string> {
  const { rows } = await banco.pool.query<{ id: string }>(
    `WITH f AS (
       INSERT INTO source_file (filename, byte_size, content_sha256, storage_path, received_by)
       VALUES ('promovendo.xlsx', 10, $1, '/tmp/promovendo.xlsx', 'teste')
       RETURNING id
     )
     INSERT INTO import_run (source_file_id, status, started_at, promocao_em, triggered_by)
     SELECT id, 'PROMOTING'::import_run_status,
            now() - ($2 || ' minutes')::interval,
            now() - ($3 || ' minutes')::interval,
            'teste'
       FROM f
     RETURNING id`,
    [
      opcoes.sha,
      String(opcoes.minutosDoRun ?? opcoes.minutosDaPromocao),
      String(opcoes.minutosDaPromocao),
    ],
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

  /**
   * A aprovação órfã — o beco que a promoção em segundo plano abriria.
   *
   * Enquanto a promoção inteira cabia numa transação, PROMOTING nunca ficava
   * órfão: o rollback devolvia o run a PREVIEWED sozinho. Deixou de ser assim
   * quando a aprovação saiu da requisição — o estado passou a ser comitado
   * antes da transação —, e sem esta varredura um reinício no meio da gravação
   * deixaria o cartão dizendo "Importando…" para sempre.
   *
   * O desfecho é PREVIEWED, e não um estado terminal: nada entrou, o arquivo
   * continua conferido, e aprovar de novo é um clique. Abortá-lo obrigaria a
   * excluir e reenviar um arquivo que está perfeito.
   */
  it("devolve ao preview a aprovação que o reinício interrompeu", async () => {
    const orfa = await criarPromocaoEmCurso({
      sha: "f".repeat(64),
      minutosDaPromocao: PROMOCAO_ORFA_MINUTOS + 5,
    });

    const relatorio = await varrerLeiturasOrfas(banco.db);
    expect(relatorio.promocoes.map((p) => p.importRunId)).toEqual([orfa]);

    const { rows } = await banco.pool.query<{
      status: string;
      failure_reason: string | null;
      promocao_em: Date | null;
    }>(`SELECT status, failure_reason, promocao_em FROM import_run WHERE id = $1`, [orfa]);
    expect(rows[0].status).toBe("PREVIEWED");
    expect(rows[0].failure_reason).toMatch(/nada dela entrou/i);
    // O relógio zerado é o que impede a varredura seguinte de contá-la de novo.
    expect(rows[0].promocao_em).toBeNull();
  });

  it("não toca na aprovação que começou agora, por mais velho que seja o run", async () => {
    // O caso que separa `promocao_em` de `started_at`: um arquivo enviado há
    // três dias e aprovado há um minuto. Medida pelo começo do run, esta
    // aprovação seria declarada órfã enquanto grava.
    const viva = await criarPromocaoEmCurso({
      sha: "1".repeat(64),
      minutosDaPromocao: 1,
      minutosDoRun: 60 * 24 * 3,
    });

    const relatorio = await varrerLeiturasOrfas(banco.db);
    expect(relatorio.promocoes).toEqual([]);

    const { rows } = await banco.pool.query<{ status: string }>(
      `SELECT status FROM import_run WHERE id = $1`,
      [viva],
    );
    expect(rows[0].status).toBe("PROMOTING");
  });

  it("é idempotente: a segunda passada não encontra nada", async () => {
    const segunda = await varrerLeiturasOrfas(banco.db);
    expect(segunda.importacoes).toEqual([]);
    expect(segunda.promocoes).toEqual([]);
    expect(segunda.chamados).toEqual([]);
  });
});
