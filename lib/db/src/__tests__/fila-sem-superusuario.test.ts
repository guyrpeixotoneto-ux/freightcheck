import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigrations, runMigrations } from "../migrate";

/**
 * A fila inteira aplica com o papel que este produto realmente usa.
 *
 * ---------------------------------------------------------------------------
 * O defeito que esta prova existe para fechar
 * ---------------------------------------------------------------------------
 * A `0093` suspendia o gatilho de imutabilidade com
 * `SET LOCAL session_replication_role = 'replica'`. O parâmetro exige
 * superusuário. O papel com que o servidor abre conexão não é um, e a fila
 * parou lá com `SQLSTATE 42501` — a tela de login passou a responder
 * `MIGRATION_FALHOU`, e nenhuma tela que dependesse da `0093` abriu até alguém
 * olhar.
 *
 * O que deixou isso passar não foi falta de prova sobre a `0093`:
 * `quinzena-backfill-0093.test.ts` tem seis, e todas continuam verdes. Foi o
 * **papel** com que toda prova deste repositório roda. `TEST_ADMIN_DATABASE_URL`
 * é a conexão de administração — `postgres`, superusuário, tanto no CI quanto na
 * máquina de quem desenvolve. Sob ela o comando é permitido, e a migration
 * passava em toda montagem que existia aqui, inclusive nas que aplicam a fila
 * de ponta a ponta contra um Postgres de verdade.
 *
 * Nenhuma prova sobre o conteúdo de uma migration alcança isso, porque não é
 * sobre o conteúdo: é sobre quem executa. Por isso esta prova não olha o SQL —
 * ela cria um papel comum, dono do banco e nada além disso, e aplica a fila
 * inteira com ele. Uma migration que precise de privilégio que o produto não
 * tem reprova aqui, sem que ninguém precise saber de antemão qual privilégio
 * procurar.
 *
 * ---------------------------------------------------------------------------
 * Por que dono do banco, e não menos que isso
 * ---------------------------------------------------------------------------
 * É o que o produto tem: as tabelas são criadas por estas mesmas migrations, e
 * quem as cria é o dono delas. O papel daqui é o mais fiel que se consegue
 * montar — pode tudo sobre o que ele mesmo criou, e nada que a instância
 * reserve a superusuário. É essa fronteira, e só ela, que a `0093` cruzou.
 */

const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const temBanco = Boolean(
  process.env.TEST_ADMIN_DATABASE_URL ?? process.env.DATABASE_URL,
);

const PAPEL = `fc_test_sem_super_${process.pid}`;
const SENHA = "quinzena-de-agosto-2026";
const BANCO = `fc_test_sem_super_db_${process.pid}`;

let admin: pg.Pool;

/**
 * A URL do papel comum, derivada da de administração.
 *
 * Trocar usuário, senha e banco na URL que já funciona é o que mantém a prova
 * indiferente ao transporte: soquete na máquina de quem desenvolve, TCP com
 * senha no CI. Só o que precisa mudar muda.
 *
 * É recorte de texto, e não `new URL`, porque a URL de soquete desta casa —
 * `postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433` — tem autoridade
 * vazia e o `URL` do Node a recusa. O recorte do banco é o mesmo que
 * `migration-com-erro-tres-perguntas.test.ts` já usa.
 */
function urlDoPapel(): string {
  const credencial = `${PAPEL}:${encodeURIComponent(SENHA)}`;
  // Sem `@` a URL não traz usuário nenhum, e aí a credencial é inserida em vez
  // de substituída — senão a prova rodaria com o papel de administração e
  // passaria sempre, que é o único desfecho que ela não pode ter.
  const comPapel = /:\/\/[^@/]*@/.test(ADMIN)
    ? ADMIN.replace(/:\/\/[^@/]*@/, `://${credencial}@`)
    : ADMIN.replace("://", `://${credencial}@`);
  return comPapel.replace(/\/[^/?]*(\?|$)/, `/${BANCO}$1`);
}

beforeAll(async () => {
  if (!temBanco) return;

  admin = new pg.Pool({ connectionString: ADMIN });
  // `NOSUPERUSER` é explícito porque é o objeto da prova, e não um padrão de
  // que se dependa em silêncio.
  await admin.query(
    `CREATE ROLE "${PAPEL}" LOGIN NOSUPERUSER PASSWORD '${SENHA}'`,
  );
  await admin.query(`CREATE DATABASE "${BANCO}" OWNER "${PAPEL}"`);
}, 60_000);

afterAll(async () => {
  if (!temBanco) return;

  await admin.query(`DROP DATABASE IF EXISTS "${BANCO}"`);
  await admin.query(`DROP ROLE IF EXISTS "${PAPEL}"`);
  await admin.end();
}, 60_000);

describe.skipIf(!temBanco)("a fila com papel sem superusuário", () => {
  it("aplica todas as migrations, sem nenhuma recusada", async () => {
    const relatorio = await runMigrations(urlDoPapel());

    /*
      A asserção sobre `failure` vem antes da contagem de propósito: quando ela
      reprova, a mensagem já nomeia a migration e o SQLSTATE — que é a
      informação que resolve. Uma contagem que não bate diria só que faltou
      alguma.
    */
    expect(relatorio.failure).toBeUndefined();
    expect(relatorio.applied).toHaveLength(readMigrations().length);
    expect(relatorio.pending).toEqual([]);
  }, 180_000);

  /**
   * A metade que se esquece de provar: o gatilho de imutabilidade fica de pé
   * depois da fila. A `0093` o desliga pelo nome para reescrever a 2ª quinzena
   * e o religa em seguida; um `ENABLE` que não rodasse deixaria o banco sem a
   * proteção que ele acha que tem, e nada mais neste repositório perceberia.
   */
  it("deixa o gatilho de imutabilidade do snapshot ligado", async () => {
    const pool = new pg.Pool({ connectionString: urlDoPapel() });
    try {
      const { rows } = await pool.query<{ tgenabled: string }>(
        `SELECT t.tgenabled
           FROM pg_trigger t
           JOIN pg_class c ON c.oid = t.tgrelid
          WHERE c.relname = 'snapshot'
            AND t.tgname = 'snapshot_immutable'
            AND NOT t.tgisinternal`,
      );
      expect(rows).toHaveLength(1);
      // 'O' é o padrão do Postgres: dispara em origem e local. 'D' é desligado.
      expect(rows[0]!.tgenabled).toBe("O");
    } finally {
      await pool.end();
    }
  }, 60_000);
});
