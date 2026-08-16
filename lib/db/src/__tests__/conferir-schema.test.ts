/**
 * O comparador de schema, travado no caso que o produziu.
 *
 * `attribute.definition` é a coluna da `0022_significado`, e a fila de
 * curadoria é a única tela que a lê. Num banco onde essa migration constava
 * aplicada e não deixou a coluna, a fila respondia 500 enquanto o resumo somava
 * certo e o `/healthz` respondia SAUDAVEL com 23 de 23 registradas. Nenhuma
 * contagem revela esse estado — por isso este módulo pergunta ao
 * `information_schema` em vez de contar migrations.
 *
 * O caso do `semComentarioDeAbertura` não é hipotético: a primeira versão
 * ancorava o casamento em `^alter table` e não achava o comando de nenhuma
 * migration que abrisse com o porquê escrito por extenso — isto é, das mais
 * bem documentadas do repositório, a 0022 entre elas.
 */
import { describe, expect, it } from "vitest";
import {
  comandoQueRepoe,
  compararSchema,
  semComentarioDeAbertura,
  tabelasDeclaradas,
} from "../conferir-schema";
import { readMigrations } from "../migrate";

/** Um `MigrationFile` com o mínimo que `comandoQueRepoe` lê. */
function migration(tag: string, statements: string[]) {
  return { tag, when: 0, hash: tag, statements };
}

describe("o que o repositório declara", () => {
  it("enxerga as tabelas pelo próprio schema, e não por uma lista à parte", () => {
    const declaradas = tabelasDeclaradas();

    expect(declaradas.size).toBeGreaterThan(30);
    expect(declaradas.get("attribute")).toContain("definition");
    expect(declaradas.get("attribute_semantics")).toContain("definition");
  });
});

describe("comparar declarado com real", () => {
  it("não acusa nada quando o banco tem tudo", () => {
    const d = compararSchema(
      new Map([["attribute", new Set(["id", "definition"])]]),
      new Map([["attribute", new Set(["id", "definition", "extra_do_banco"])]]),
    );

    expect(d.tabelasAusentes).toEqual([]);
    expect(d.colunasAusentes).toEqual([]);
  });

  it("acha a coluna do caso vivido", () => {
    const d = compararSchema(
      new Map([["attribute", new Set(["id", "definition"])]]),
      new Map([["attribute", new Set(["id"])]]),
    );

    expect(d.colunasAusentes).toEqual([
      { tabela: "attribute", coluna: "definition" },
    ]);
    expect(d.tabelasAusentes).toEqual([]);
  });

  it("separa tabela inteira ausente de coluna ausente", () => {
    const d = compararSchema(
      new Map([["book_entry", new Set(["id"])]]),
      new Map(),
    );

    expect(d.tabelasAusentes).toEqual(["book_entry"]);
    // Não repete as colunas de uma tabela que nem existe.
    expect(d.colunasAusentes).toEqual([]);
  });
});

describe("de onde vem o comando que repõe", () => {
  it("atravessa o comentário de abertura da migration", () => {
    const bruto =
      "-- O significado de uma coluna, escrito por quem sabe.\n" +
      "-- Duas colunas, ambas anuláveis, nenhum default.\n" +
      'ALTER TABLE "attribute" ADD COLUMN IF NOT EXISTS "definition" text;';

    expect(semComentarioDeAbertura(bruto)).toBe(
      'ALTER TABLE "attribute" ADD COLUMN IF NOT EXISTS "definition" text;',
    );
  });

  it("acha o ADD COLUMN da 0022 nas migrations de verdade", () => {
    const comando = comandoQueRepoe({
      tabela: "attribute",
      coluna: "definition",
    });

    expect(comando).toBeDefined();
    expect(comando).toMatch(/alter\s+table\s+"attribute"\s+add\s+column/i);
    expect(comando).toContain("definition");
    // Sem `;` final: quem executa não precisa dele, e mantê-lo esconderia um
    // segundo comando coleado no mesmo texto.
    expect(comando!.endsWith(";")).toBe(false);
  });

  it("acha para as duas tabelas que a 0022 toca", () => {
    expect(
      comandoQueRepoe({ tabela: "attribute_semantics", coluna: "definition" }),
    ).toBeDefined();
  });

  it("prefere a migration mais recente quando duas mexem na mesma coluna", () => {
    const comando = comandoQueRepoe(
      { tabela: "attribute", coluna: "definition" },
      [
        migration("0001_antiga", [
          'ALTER TABLE "attribute" ADD COLUMN "definition" varchar(80);',
        ]),
        migration("0022_nova", [
          'ALTER TABLE "attribute" ADD COLUMN IF NOT EXISTS "definition" text;',
        ]),
      ],
    );

    expect(comando).toContain("text");
    expect(comando).not.toContain("varchar");
  });

  it("ignora um ADD COLUMN que está dentro de outro comando", () => {
    /*
      Um `DO $$` que acrescenta a coluna no meio de outra coisa não serve: rodá-
      lo fora do seu contexto faria mais do que repor a coluna.
    */
    const comando = comandoQueRepoe({ tabela: "attribute", coluna: "definition" }, [
      migration("0001_bloco", [
        'DO $$ BEGIN\n  ALTER TABLE "attribute" ADD COLUMN "definition" text;\n' +
          "  UPDATE outra_coisa SET x = 1;\nEND $$;",
      ]),
    ]);

    expect(comando).toBeUndefined();
  });

  it("não devolve comando para uma coluna que migration nenhuma cria", () => {
    expect(
      comandoQueRepoe({ tabela: "attribute", coluna: "coluna_inventada" }),
    ).toBeUndefined();
  });

  it("não confunde tabelas cujo nome é prefixo de outra", () => {
    const comando = comandoQueRepoe({ tabela: "attribute", coluna: "definition" }, [
      migration("0001", [
        'ALTER TABLE "attribute_semantics" ADD COLUMN "definition" text;',
      ]),
    ]);

    expect(comando).toBeUndefined();
  });
});

describe("as migrations no disco", () => {
  it("todas as colunas declaradas que a 0022 criou têm comando de reposição", () => {
    // A garantia que o `--aplicar` precisa: para o caso vivido, existe SQL no
    // disco, e portanto nada precisa ser inventado.
    const migrations = readMigrations();
    for (const tabela of ["attribute", "attribute_semantics"]) {
      expect(
        comandoQueRepoe({ tabela, coluna: "definition" }, migrations),
        `${tabela}.definition não tem de onde ser reposta`,
      ).toBeDefined();
    }
  });
});
