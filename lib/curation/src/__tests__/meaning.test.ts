import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import {
  attributeSemanticsTable,
  attributeTable,
  curationEventTable,
} from "@workspace/db";
import { captureRaw, preview, promote, receiveFile, stage } from "@workspace/ingest";
import { createTestDatabase, realExportPath, type TestDb } from "@workspace/ingest/testing";
import { getCurationQueue, runProposalPass } from "../engine";
import { saveMeaning } from "../meaning";
import { seedTaxonomy } from "../taxonomy";
import { backfillSemantics, recordSourceSemanticsChange } from "../versioning";

/**
 * Registrar o significado de uma coluna sem confirmar coisa alguma.
 *
 * O que estes testes prendem é a separação: a confirmação continua sendo o ato
 * caro, com justificativa obrigatória e, se for monetário, unidade +
 * periodicidade + agregação; escrever o que a coluna é não paga nada disso e,
 * em troca, não destrava nada. Se um dia `saveMeaning` mexer em
 * `semantics_status`, prosa passa a liberar dinheiro — e é este arquivo que
 * falha.
 */

let ctx: TestDb;

/** Monetário e sem semântica: o caso em que confirmar é caro. */
const CODE = "cavalo.valor_nf_compra";

beforeAll(async () => {
  ctx = await createTestDatabase("meaning");
  const received = await receiveFile(ctx.db, { filePath: realExportPath() });
  await captureRaw(ctx.db, received.importRunId);
  await stage(ctx.db, received.importRunId);
  await preview(ctx.db, received.importRunId);
  await promote(ctx.db, received.importRunId);
  await seedTaxonomy(ctx.db, "test:bootstrap");
  await runProposalPass(ctx.db, "test:proposal");
  await backfillSemantics(ctx.db);
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

async function attribute(code: string) {
  const [row] = await ctx.db
    .select()
    .from(attributeTable)
    .where(eq(attributeTable.code, code));
  return row;
}

async function currentVersion(attributeId: string) {
  const [row] = await ctx.db
    .select()
    .from(attributeSemanticsTable)
    .where(
      and(
        eq(attributeSemanticsTable.attributeId, attributeId),
        isNull(attributeSemanticsTable.effectiveUntil),
      ),
    );
  return row;
}

describe("escrever o significado é o passo barato", () => {
  it("grava sem justificativa, sem unidade e sem periodicidade", async () => {
    const antes = await attribute(CODE);
    expect(antes.semanticsStatus).not.toBe("CONFIRMED");

    const result = await saveMeaning(ctx.db, {
      code: CODE,
      definition: "Valor da nota fiscal de compra do cavalo mecânico.",
      actor: "curador@teste",
    });

    expect(result.definition).toBe(
      "Valor da nota fiscal de compra do cavalo mecânico.",
    );
    expect(result.changed).toEqual(["definition"]);

    const depois = await attribute(CODE);
    expect(depois.definition).toBe(
      "Valor da nota fiscal de compra do cavalo mecânico.",
    );
  });

  it("não move o status — prosa não destrava dinheiro", async () => {
    const antes = await attribute(CODE);
    await saveMeaning(ctx.db, {
      code: CODE,
      definition: "Outra redação, mesma coluna.",
      actor: "curador@teste",
    });
    const depois = await attribute(CODE);

    expect(depois.semanticsStatus).toBe(antes.semanticsStatus);
    expect(depois.confirmedBy).toBe(antes.confirmedBy);
    expect(depois.confirmedAt).toEqual(antes.confirmedAt);
    // A justificativa/proposta é do outro ato, e continua onde estava.
    expect(depois.semanticsRationale).toBe(antes.semanticsRationale);
  });

  it("exige um responsável, como toda edição auditável", async () => {
    await expect(
      saveMeaning(ctx.db, { code: CODE, definition: "x", actor: "  " }),
    ).rejects.toThrow(/responsável/i);
  });

  it("recusa uma chamada que não pede nada", async () => {
    await expect(
      saveMeaning(ctx.db, { code: CODE, actor: "curador@teste" }),
    ).rejects.toThrow(/Nada a gravar/);
  });

  it("registra o que mudou, sem inventar um motivo", async () => {
    const a = await attribute(CODE);
    await saveMeaning(ctx.db, {
      code: CODE,
      definition: "Redação final para o teste de evento.",
      actor: "curador@teste",
    });

    const eventos = await ctx.db
      .select()
      .from(curationEventTable)
      .where(
        and(
          eq(curationEventTable.targetId, a.id),
          eq(curationEventTable.field, "definition"),
        ),
      );

    expect(eventos.length).toBeGreaterThan(0);
    const ultimo = eventos.at(-1)!;
    expect(ultimo.actor).toBe("curador@teste");
    expect(ultimo.valueAfter).toBe("Redação final para o teste de evento.");
    // `reason` é do ato de confirmar. Aqui o valor novo já é o conteúdo.
    expect(ultimo.reason).toBeNull();
    expect(ultimo.changeCategory).toBe("CURATION_CHANGE");
  });

  it("não escreve evento quando nada mudou", async () => {
    const a = await attribute(CODE);
    const contar = async () =>
      (
        await ctx.db
          .select()
          .from(curationEventTable)
          .where(
            and(
              eq(curationEventTable.targetId, a.id),
              eq(curationEventTable.field, "definition"),
            ),
          )
      ).length;

    const antes = await contar();
    const result = await saveMeaning(ctx.db, {
      code: CODE,
      definition: "Redação final para o teste de evento.",
      actor: "curador@teste",
    });

    expect(result.changed).toEqual([]);
    expect(await contar()).toBe(antes);
  });

  it("trata campo em branco como 'não tenho nada a dizer'", async () => {
    const result = await saveMeaning(ctx.db, {
      code: CODE,
      definition: "   ",
      actor: "curador@teste",
    });
    expect(result.definition).toBeNull();
    expect((await attribute(CODE)).definition).toBeNull();
  });
});

describe("o significado é versionado como o resto da semântica", () => {
  const OUTRO = "cavalo.ipva_licenciamento";

  it("escreve na versão em vigor, e não só na projeção", async () => {
    await saveMeaning(ctx.db, {
      code: OUTRO,
      definition: "IPVA e licenciamento do cavalo.",
      calculationBasis: "1,000% do valor da NF.",
      actor: "curador@teste",
    });

    const a = await attribute(OUTRO);
    const v = await currentVersion(a.id);
    expect(v.definition).toBe("IPVA e licenciamento do cavalo.");
    expect(v.calculationBasis).toBe("1,000% do valor da NF.");
    expect(a.definition).toBe("IPVA e licenciamento do cavalo.");
  });

  it("sobrevive a uma mudança de semântica da fonte", async () => {
    /*
      O caso real: a Ambev trocou a base de cálculo do IPVA sem trocar a
      unidade nem a periodicidade. A coluna continua sendo o IPVA do cavalo, e
      por isso a definição atravessa para a versão nova — o que muda é a base.
      Se a nova versão nascesse com `definition` nulo, uma mudança da fonte
      apagaria em silêncio o que o curador escreveu.
    */
    await recordSourceSemanticsChange(ctx.db, {
      code: OUTRO,
      effectiveFrom: "2030-01-01",
      calculationBasis: "0,651% do valor da NF.",
      actor: "curador@teste",
      reason: "A fonte mudou a base de cálculo a partir de 2030.",
    });

    const a = await attribute(OUTRO);
    const v = await currentVersion(a.id);
    expect(v.version).toBeGreaterThan(1);
    expect(v.definition).toBe("IPVA e licenciamento do cavalo.");
    expect(v.calculationBasis).toBe("0,651% do valor da NF.");
    // A projeção acompanha a versão em vigor.
    expect(a.definition).toBe("IPVA e licenciamento do cavalo.");
  });

  it("preserva na versão anterior o que ela dizia", async () => {
    const a = await attribute(OUTRO);
    const todas = await ctx.db
      .select()
      .from(attributeSemanticsTable)
      .where(eq(attributeSemanticsTable.attributeId, a.id));

    const antiga = todas.find((v) => v.effectiveUntil !== null)!;
    expect(antiga.calculationBasis).toBe("1,000% do valor da NF.");
  });
});

describe("a fila carrega o significado", () => {
  it("entrega definição e base de cálculo junto com o resto", async () => {
    const fila = await getCurationQueue(ctx.db, { includeConfirmed: true });
    const item = fila.find((i) => i.code === "cavalo.ipva_licenciamento")!;

    expect(item.definition).toBe("IPVA e licenciamento do cavalo.");
    expect(item.calculationBasis).toBe("0,651% do valor da NF.");
  });

  it("não perde nenhum atributo por causa do join da versão", async () => {
    /*
      O join com `attribute_semantics` filtra a versão em vigor. Feito como
      INNER, ou com o filtro no WHERE, ele sumiria justamente com os atributos
      que ninguém olhou ainda — os que a fila existe para mostrar.
    */
    const fila = await getCurationQueue(ctx.db, { includeConfirmed: true });
    const [{ count }] = await ctx.db
      .select({ count: attributeTable.id })
      .from(attributeTable)
      .then((rows) => [{ count: rows.length }]);

    expect(fila.length).toBe(count);
  });
});
