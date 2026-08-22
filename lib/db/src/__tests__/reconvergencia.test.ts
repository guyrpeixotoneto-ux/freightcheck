import { describe, expect, it } from "vitest";
import pg from "pg";
import { readMigrations, runMigrations } from "../migrate";
import {
  comandoQueCriaTabela,
  constraintsDaFila,
  constraintsTocadasPor,
  indicesDaFila,
  reconvergirSchema,
} from "../reconvergencia";

/**
 * As peças da reconvergência, uma a uma.
 *
 * A prova de que o conjunto fecha o ciclo do deploy — Production mutilada pelo
 * Provision, partida, schema de volta — mora em
 * `artifacts/api-server/src/__tests__/deploy-normal-reconverge.test.ts`, que é
 * onde o boot vive. Aqui se prova o que cada levantador devolve, e a
 * propriedade que nenhum cenário pode quebrar: num banco íntegro, a
 * reconvergência não toca em nada.
 */

const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

describe("os levantadores devolvem a fila, nunca uma segunda redação", () => {
  it("uma tabela volta pelo CREATE TABLE da migration que a criou", () => {
    const comando = comandoQueCriaTabela("entity_expectation");

    expect(comando).toMatch(
      /^CREATE TABLE IF NOT EXISTS "entity_expectation"/i,
    );
    /* Verbatim: as colunas e a constraint inline vêm juntas, como na 0032. */
    expect(comando).toContain("entity_id");
  });

  it("tabela que a fila não cria devolve undefined — nunca DDL inventado", () => {
    expect(comandoQueCriaTabela("tabela_que_nao_existe")).toBeUndefined();
  });

  it("o que a fila removeu de propósito não volta", () => {
    /*
      `snapshot_business_key_uq` foi criado cedo e removido pela 0016, quando a
      identidade canônica o substituiu. Reimpor a unicidade que a fila aboliu
      seria pior do que não repor nada — e foi exatamente o que a primeira
      versão deste módulo fazia, pega pelo teste do banco íntegro abaixo.
    */
    const indices = indicesDaFila();

    expect(indices.has("snapshot_business_key_uq")).toBe(false);
    expect(indices.has("snapshot_business_key_live_uq")).toBe(false);
    expect(indices.has("ticket_attribute_idx")).toBe(false);
  });

  it("o índice único do ON CONFLICT está entre os levantáveis", () => {
    /*
      `snapshot_entity_type_uq` é o índice que a 0021 cria e que o `ON
      CONFLICT` da importação usa como árbitro. Um `DROP COLUMN` em cascata o
      leva junto; sem ele a importação morre com 42P10 — e é por isso que a
      reconvergência não para nas colunas.
    */
    const indices = indicesDaFila();
    const alvo = indices.get("snapshot_entity_type_uq");

    expect(alvo).toBeDefined();
    expect(alvo!.comando).toMatch(/^CREATE UNIQUE INDEX IF NOT EXISTS/i);
  });

  it("constraints são levantáveis nas duas formas que a fila usa", () => {
    /*
      A forma direta (`ALTER TABLE … ADD CONSTRAINT`) e o bloco reentrante que
      a fila escreve desde a 0028 (`DO $$ … IF NOT EXISTS(pg_constraint) …`).
      Nada além das duas: um DO que faça mais do que a guarda + o ADD não casa.
    */
    const constraints = constraintsDaFila();

    expect(constraints.size).toBeGreaterThan(0);
    for (const [, { comando }] of constraints) {
      expect(comando).toMatch(/^(ALTER TABLE|DO )/i);
      expect(comando).toMatch(/ADD CONSTRAINT/i);
    }
    /* As FKs da 0028/0032, que vivem no bloco reentrante, estão no mapa. */
    expect(constraints.has("entity_expectation_entity_id_entity_id_fk")).toBe(
      true,
    );
  });

  it("a constraint que a fila substituiu vem marcada — e só ela", () => {
    const constraints = constraintsDaFila();

    /* 0021 cria inline, 0032 troca a definição: substituída. */
    expect(constraints.get("coverage_expectation_origin_ck")?.substituida).toBe(
      true,
    );
    /* Uma FK adicionada uma vez só, nunca. */
    expect(
      constraints.get("entity_expectation_entity_id_entity_id_fk")?.substituida,
    ).toBe(false);
  });

  /**
   * A pergunta que separa "o valor está errado" de "a regra aqui é de antes".
   *
   * Quem a faz é a classificação de erro do servidor, com as migrations
   * pendentes: uma `23514` sobre uma constraint que uma delas reescreve não é
   * defeito do pedido — ver `regraDeMigrationPendente`, em
   * `artifacts/api-server/src/lib/schema-ausente.ts`.
   */
  describe("as constraints que um pedaço da fila mexe", () => {
    const so = (...tags: string[]) =>
      constraintsTocadasPor(readMigrations().filter((m) => tags.includes(m.tag)));

    it("a 0055 é nomeada como quem reescreve a lista fechada do documento", () => {
      /*
        O caso vivido: a tela oferecia `DISPONIBILIDADE_FF`, o banco ainda
        aplicava a lista sem ele, e o envio morria em 23514. A 0055 derruba e
        recria `fechamento_documento_tipo` — é isso que a torna a explicação.
      */
      expect(so("0055_disponibilidade_por_frota")).toContain(
        "fechamento_documento_tipo",
      );
    });

    it("uma migration que não encosta na constraint não a nomeia", () => {
      /* Sem este lado, todo `check_violation` viraria "faltam migrations" —
         que é mandar rodar a fila por causa de um dado errado. */
      expect(so("0053_rastro_da_resposta")).not.toContain(
        "fechamento_documento_tipo",
      );
    });

    it("um recorte vazio da fila não toca constraint nenhuma", () => {
      expect(constraintsTocadasPor([]).size).toBe(0);
    });

    it("enxerga as duas formas que a fila usa, e o DROP também", () => {
      /* O bloco reentrante que a fila escreve desde a 0028 (`DO $$ …
         pg_constraint …`) conta como mexer, do mesmo jeito que o `ALTER TABLE
         … ADD CONSTRAINT` direto. */
      expect(so("0032_universo_esperado")).toContain(
        "entity_expectation_entity_id_entity_id_fk",
      );
      /* A 0055 nomeia a constraint pelo DROP **e** pelo ADD: reescrever é as
         duas coisas, e reconhecer só uma deixaria de fora a migration que
         apenas remove uma regra velha. */
      expect(
        readMigrations()
          .find((m) => m.tag === "0055_disponibilidade_por_frota")!
          .statements.filter((s) => /drop\s+constraint/i.test(s)).length,
      ).toBeGreaterThan(0);
    });
  });
});

describe("num banco íntegro, a reconvergência é um não-evento", () => {
  it("fila inteira aplicada → relatório vazio, nada tocado", async () => {
    const nome = `fc_reconv_limpo_${process.pid}`;
    const admin = new pg.Pool({ connectionString: ADMIN });
    await admin.query(`DROP DATABASE IF EXISTS "${nome}"`);
    await admin.query(`CREATE DATABASE "${nome}"`);
    const url = ADMIN.replace("/postgres?", `/${nome}?`);

    try {
      expect((await runMigrations(url)).failure).toBeUndefined();

      const relatorio = await reconvergirSchema(url);

      expect(relatorio.aplicados).toEqual([]);
      expect(relatorio.semComando).toEqual([]);
      expect(relatorio.falhas).toEqual([]);
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS "${nome}"`);
      await admin.end();
    }
  }, 300_000);
});
