/**
 * O que este processo acha que precisa estar aplicado.
 *
 * A lista alimenta `/api/healthz`, e é dela que sai a frase "faltam
 * 0008_book_entries e 0009_…". Se ela ficasse fora de ordem, ou se esquecesse
 * um arquivo que existe na pasta, o diagnóstico ficaria errado justamente no
 * dia em que alguém precisasse dele.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readMigrations } from "@workspace/db/migrate";
import { expectedMigrations, migrationsFolder } from "../migrations";

describe("expectedMigrations", () => {
  it("lê todas as migrations do disco, sem sobrar arquivo na pasta", () => {
    const naPasta = readdirSync(migrationsFolder())
      .filter((nome) => nome.endsWith(".sql"))
      .map((nome) => path.basename(nome, ".sql"))
      .sort();

    const tags = expectedMigrations()
      .map((migration) => migration.tag)
      .sort();

    expect(tags).toEqual(naPasta);
  });

  it("vem em ordem de aplicação, que é a ordem do carimbo", () => {
    const carimbos = expectedMigrations().map((migration) => migration.when);
    expect(carimbos).toEqual([...carimbos].sort((a, b) => a - b));
  });

  it("cada migration traz comandos e um hash do arquivo inteiro", () => {
    for (const migration of readMigrations(migrationsFolder())) {
      expect(migration.statements.length, migration.tag).toBeGreaterThan(0);
      // O hash é o do drizzle: sha256 em hexadecimal, 64 caracteres. Guardar
      // outro formato faria o migrator dele deixar de reconhecer o que rodou
      // por aqui, e repetir migrations já aplicadas.
      expect(migration.hash, migration.tag).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("separa os comandos pelo mesmo marcador que o drizzle usa", () => {
    const book = readMigrations(migrationsFolder()).find(
      (migration) => migration.tag === "0008_book_entries",
    );

    expect(book).toBeDefined();
    // A migration do Book cria o tipo, a tabela, três índices e três CHECKs:
    // se tudo isso chegasse ao banco como um comando só, o primeiro erro
    // levaria junto o que já estava certo.
    expect(book!.statements.length).toBeGreaterThan(3);
    expect(book!.statements.some((s) => s.includes("CREATE TABLE"))).toBe(true);
    expect(
      book!.statements.every((s) => !s.includes("statement-breakpoint")),
    ).toBe(true);
  });
});
