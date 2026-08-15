/**
 * Quais migrations pedem conferência à mão depois de adotadas.
 *
 * A adoção declara que o schema já está como a migration o deixaria. Isso não
 * diz nada sobre um backfill, e por isso as adotadas que mexem em dados saem
 * nomeadas. O valor desse aviso está inteiro na sua precisão: um que acuse
 * migrations sem backfill ensina quem opera a ignorá-lo.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mexeEmDados, readMigrations } from "../migrate";

describe("mexeEmDados", () => {
  it("reconhece backfill de verdade", () => {
    expect(mexeEmDados([`UPDATE "snapshot" SET "status" = 'X'`])).toBe(true);
    expect(mexeEmDados([`INSERT INTO "entity" ("id") VALUES ('a')`])).toBe(true);
    expect(mexeEmDados([`DELETE FROM "fact" WHERE "id" = 'a'`])).toBe(true);
  });

  it("estrutura pura não mexe em dados", () => {
    expect(mexeEmDados([`CREATE TABLE "x" ("id" text)`])).toBe(false);
    expect(mexeEmDados([`ALTER TABLE "x" ADD COLUMN "y" text`])).toBe(false);
  });

  /**
   * O falso positivo que motivou o corte: os `UPDATE` da `0009` vivem todos
   * dentro de `freightcheck_correct_entity_type`. Eles rodam quando alguém
   * chama a função — não quando a migration entra.
   */
  it("um UPDATE dentro de corpo de função não é backfill", () => {
    const sql = `
      CREATE OR REPLACE FUNCTION corrige(p_de text, p_para text)
      RETURNS void AS $$
      BEGIN
        UPDATE entity SET entity_type = p_para WHERE entity_type = p_de;
        INSERT INTO auditoria (o_que) VALUES ('corrigido');
      END;
      $$ LANGUAGE plpgsql;
    `;
    expect(mexeEmDados([sql])).toBe(false);
  });

  it("mas um UPDATE fora do corpo, no mesmo arquivo, continua contando", () => {
    const sql = `
      CREATE OR REPLACE FUNCTION corrige() RETURNS void AS $$
      BEGIN
        UPDATE entity SET a = 1;
      END;
      $$ LANGUAGE plpgsql;
      UPDATE snapshot SET status = 'SUPERSEDED';
    `;
    expect(mexeEmDados([sql])).toBe(true);
  });

  /**
   * A regressão contra as migrations reais deste repositório: a `0009` define
   * uma função e não faz backfill nenhum; a `0015` faz backfill de verdade, com
   * `UPDATE` em cima de tabelas existentes, e precisa continuar sendo apontada.
   */
  it("classifica as migrations deste repositório como elas são", () => {
    const pasta = path.resolve(import.meta.dirname, "../../migrations");
    const porTag = new Map(
      readMigrations(pasta).map((m) => [m.tag, m.statements]),
    );

    expect(mexeEmDados(porTag.get("0009_entity_type_correction")!)).toBe(false);
    expect(mexeEmDados(porTag.get("0015_canonical_identity")!)).toBe(true);

    // E a 0009 de fato só tem os DML dentro do corpo — se um dia ganhar um
    // backfill de verdade, este teste avisa antes de o aviso sumir sozinho.
    const bruto = readFileSync(
      path.join(pasta, "0009_entity_type_correction.sql"),
      "utf8",
    );
    expect(bruto).toMatch(/CREATE OR REPLACE FUNCTION/);
    expect(bruto).toMatch(/UPDATE /);
  });
});
