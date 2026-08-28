import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { readMigrations } from "../migrate";

/**
 * A `0072` contra dado que já existia — a prova de que nada se perde.
 *
 * O recorte de `observacoes` em `falhas`, `gargalos` e `informacoes` acontece
 * num banco que já tem processos escritos: quinze etapas da Operação Empurrada
 * têm texto nessa coluna, e alguém passou uma tarde escrevendo cada uma. Uma
 * migration que renomeasse a coluna, ou que recortasse o texto por adivinhação,
 * destruiria trabalho humano sem deixar rastro — e o `ALTER TABLE ... RENAME`
 * não avisa ninguém.
 *
 * O que se afirma aqui, contra PostgreSQL de verdade:
 *
 * 1. o texto antigo aparece em `informacoes` depois da migration;
 * 2. `observacoes` **continua com o texto original**, intacta;
 * 3. rodar a migration de novo não desfaz o que alguém reescreveu depois;
 * 4. a etapa que já tinha `informacoes` não é sobrescrita pelo texto antigo;
 * 5. `falhas` e `gargalos` nascem vazias — a migration não inventa classificação.
 *
 * O ponto 3 é o que separa "cópia condicionada" de "cópia": a fila pode rodar
 * duas vezes sobre o mesmo banco (um redeploy, um reparo), e a segunda passada
 * não pode desfazer o recorte que a pessoa fez à mão entre uma e outra.
 */
const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const urlDe = (nome: string) => ADMIN.replace("/postgres?", `/${nome}?`);

const TAG = "0072_falhas_gargalos_informacoes";
const criados: string[] = [];

async function comAdmin<T>(fn: (p: pg.Pool) => Promise<T>): Promise<T> {
  const pool = new pg.Pool({ connectionString: ADMIN });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

/** Aplica a fila até `ate` (inclusive) — uma transação por migration. */
async function aplicarAte(pool: pg.Pool, ate: string): Promise<void> {
  for (const m of readMigrations()) {
    await pool.query("BEGIN");
    for (const comando of m.statements) await pool.query(comando);
    await pool.query("COMMIT");
    if (m.tag === ate) return;
  }
  throw new Error(`migration ${ate} não existe`);
}

/** Só a `0072`, para provar que rodá-la duas vezes é seguro. */
async function aplicarSomenteA0072(pool: pg.Pool): Promise<void> {
  const m = readMigrations().find((x) => x.tag === TAG);
  if (!m) throw new Error(`migration ${TAG} não existe`);
  await pool.query("BEGIN");
  for (const comando of m.statements) await pool.query(comando);
  await pool.query("COMMIT");
}

async function bancoNaVespera(): Promise<pg.Pool> {
  const nome = `fc_fgi_${process.pid}_${criados.length + 1}`;
  await comAdmin(async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS "${nome}"`);
    await admin.query(`CREATE DATABASE "${nome}"`);
  });
  criados.push(nome);
  const pool = new pg.Pool({ connectionString: urlDe(nome) });

  /*
    A fila para **na migration anterior**: é neste estado — com `observacoes` e
    sem as três colunas — que o banco de produção está no instante em que a
    `0072` vai rodar. Aplicar a fila inteira e depois inserir provaria outra
    coisa (a cópia rodando sobre linha nenhuma).
  */
  const anterior = readMigrations()[readMigrations().findIndex((m) => m.tag === TAG) - 1]!;
  await aplicarAte(pool, anterior.tag);
  return pool;
}

afterAll(async () => {
  await comAdmin(async (admin) => {
    for (const nome of criados) {
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
        [nome],
      );
      await admin.query(`DROP DATABASE IF EXISTS "${nome}"`);
    }
  });
}, 300_000);

/** Uma empresa, um fluxo e as etapas do caso — como estavam antes da `0072`. */
async function semear(
  pool: pg.Pool,
  etapas: { nome: string; observacoes: string | null }[],
): Promise<void> {
  const { rows: unidade } = await pool.query<{ id: string }>(
    `INSERT INTO "unidade" ("nome", "cnpj") VALUES ('CDD Teste', '12345678000199') RETURNING "id"`,
  );
  const { rows: fluxo } = await pool.query<{ id: string }>(
    `INSERT INTO "fluxo_operacional" ("empresa_id", "nome", "slug", "categoria")
     VALUES ($1, 'Operação empurrada', 'operacao-empurrada', 'Faturamento') RETURNING "id"`,
    [unidade[0]!.id],
  );
  for (const [ordem, etapa] of etapas.entries()) {
    await pool.query(
      `INSERT INTO "fluxo_etapa" ("empresa_id", "fluxo_id", "nome", "ordem", "observacoes")
       VALUES ($1, $2, $3, $4, $5)`,
      [unidade[0]!.id, fluxo[0]!.id, etapa.nome, ordem, etapa.observacoes],
    );
  }
}

interface LinhaDaEtapa {
  nome: string;
  falhas: string | null;
  gargalos: string | null;
  informacoes: string | null;
  observacoes: string | null;
}

const lerEtapas = async (pool: pg.Pool): Promise<Map<string, LinhaDaEtapa>> => {
  const { rows } = await pool.query<LinhaDaEtapa>(
    `SELECT "nome", "falhas", "gargalos", "informacoes", "observacoes"
       FROM "fluxo_etapa" ORDER BY "ordem"`,
  );
  return new Map(rows.map((r) => [r.nome, r]));
};

describe("a 0072 recorta observações em três sem perder o que estava escrito", () => {
  const ORIGINAL =
    "Saída: informação do trecho validada no Freitec/TMS.\nA VALIDAR: quais tabelas originam a tarifa.";

  it("copia o texto para informações e mantém o original onde estava", async () => {
    const pool = await bancoNaVespera();
    await semear(pool, [
      { nome: "Origem da tarifa", observacoes: ORIGINAL },
      { nome: "Etapa sem observação", observacoes: null },
      { nome: "Etapa com espaço em branco", observacoes: "   " },
    ]);

    await aplicarSomenteA0072(pool);
    const etapas = await lerEtapas(pool);

    expect(etapas.get("Origem da tarifa")).toMatchObject({
      informacoes: ORIGINAL,
      /* Intacta: é o texto de quem escreveu a etapa, e ele não é reescrito. */
      observacoes: ORIGINAL,
      /*
        E a migration não distribui o texto entre as três: dizer que uma frase
        é falha e outra é gargalo é classificação, e ninguém a fez ainda.
      */
      falhas: null,
      gargalos: null,
    });

    expect(etapas.get("Etapa sem observação")).toMatchObject({
      informacoes: null,
      observacoes: null,
    });
    /* Só espaço não é texto: copiar isso encheria a etapa de brancos. */
    expect(etapas.get("Etapa com espaço em branco")!.informacoes).toBeNull();

    await pool.end();
  });

  it("rodar de novo não desfaz o recorte que alguém fez à mão", async () => {
    const pool = await bancoNaVespera();
    await semear(pool, [{ nome: "Origem da tarifa", observacoes: ORIGINAL }]);
    await aplicarSomenteA0072(pool);

    /*
      Entre uma passada e outra, a pessoa abre a etapa e faz o que a separação
      existe para permitir: tira a falha do meio do texto e a põe no campo dela.
    */
    await pool.query(
      `UPDATE "fluxo_etapa"
          SET "informacoes" = 'A VALIDAR: quais tabelas originam a tarifa.',
              "falhas" = 'A tarifa chega sem tabela e o faturamento recalcula à mão.'`,
    );

    await aplicarSomenteA0072(pool);
    const etapas = await lerEtapas(pool);

    expect(etapas.get("Origem da tarifa")).toMatchObject({
      informacoes: "A VALIDAR: quais tabelas originam a tarifa.",
      falhas: "A tarifa chega sem tabela e o faturamento recalcula à mão.",
      observacoes: ORIGINAL,
    });

    await pool.end();
  });
});
