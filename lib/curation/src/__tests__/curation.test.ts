import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  attributeTable,
  CONFIRMED_SEMANTICS,
  curationEventTable,
  factTable,
} from "@workspace/db";
import { criarBancoComExportRealPromovido, type TestDb } from "@workspace/ingest/testing";
import {
  confirmAttribute,
  gatherEvidence,
  gatherPairRatios,
  getCurationQueue,
  runProposalPass,
} from "../engine";
import { detectPeriodicityConflicts } from "../semantics";
import { seedTaxonomy } from "../taxonomy";

/**
 * Curation against the real dataset.
 *
 * The theme throughout: the engine may propose, the database decides what can
 * be confirmed, and every edit we make is recorded as a CURATION_CHANGE that
 * never touches a fact.
 */

let ctx: TestDb;

beforeAll(async () => {
  ctx = await criarBancoComExportRealPromovido("curation");
  await seedTaxonomy(ctx.db, "test:bootstrap");
  await runProposalPass(ctx.db, "test:proposal");
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

/*
  Os dois primeiros testes deste bloco mediam a base inteira — "nada está
  CONFIRMED", "nenhuma periodicidade preenchida" — e isso valia enquanto uma
  promoção deixava a base sem significado nenhum. Desde que a importação aplica
  o registro canônico, o zero absoluto deixou de ser a régua certa: o que
  continua sendo verdade, e é o que estes testes existem para prender, é que
  **o motor de proposta** não confirma e não inventa periodicidade. A régua
  passa a ser o registro, e qualquer coisa além dele reprova.
*/
const CODIGOS_DO_REGISTRO = CONFIRMED_SEMANTICS.map((e) => e.code).sort();

describe("the proposal pass proposes and nothing more", () => {
  it("confirms nothing, ever", async () => {
    const confirmados = await ctx.db
      .select({ code: attributeTable.code })
      .from(attributeTable)
      .where(eq(attributeTable.semanticsStatus, "CONFIRMED"));
    expect(confirmados.map((c) => c.code).sort()).toEqual(CODIGOS_DO_REGISTRO);
  });

  it("never fills periodicity on its own", async () => {
    const comPeriodicidade = await ctx.db
      .select({ code: attributeTable.code })
      .from(attributeTable)
      .where(sql`${attributeTable.periodicity} IS NOT NULL`);
    const doRegistro = new Set(
      CONFIRMED_SEMANTICS.filter((e) => e.periodicity !== null).map((e) => e.code),
    );
    expect(comPeriodicidade.filter((a) => !doRegistro.has(a.code))).toEqual([]);
  });

  it("writes a rationale for everything it moves to PRESUMED", async () => {
    const presumed = await ctx.db
      .select()
      .from(attributeTable)
      .where(eq(attributeTable.semanticsStatus, "PRESUMED"));
    expect(presumed.length).toBeGreaterThan(50);
    for (const attribute of presumed) {
      expect(attribute.semanticsRationale).toBeTruthy();
    }
  });

  it("records every proposal as a CURATION_CHANGE", async () => {
    const [row] = await ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(curationEventTable)
      .where(eq(curationEventTable.changeCategory, "CURATION_CHANGE"));
    expect(row.count).toBeGreaterThan(0);

    const [other] = await ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(curationEventTable)
      .where(sql`${curationEventTable.changeCategory} <> 'CURATION_CHANGE'`);
    expect(other.count).toBe(0);
  });

  it("is idempotent — a second pass changes nothing", async () => {
    const before = await ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(curationEventTable);
    await runProposalPass(ctx.db, "test:proposal-again");
    const after = await ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(curationEventTable);
    expect(after[0].count).toBe(before[0].count);
  });
});

describe("the ipvaLicenciamento pair, on the real data", () => {
  it("is diagnosed as homonymy rather than a periodicity contradiction", async () => {
    const ratios = await gatherPairRatios(ctx.db);
    const stats = ratios.get("carreta.ipva_licenciamento_mensal");
    expect(stats).toBeDefined();
    expect(stats!.sampleSize).toBeGreaterThan(50);

    // The two columns do not track each other asset by asset, which is what
    // rules out "same quantity, mislabelled periodicity".
    const dispersion = Math.abs(stats!.stddevRatio / stats!.meanRatio);
    expect(dispersion).toBeGreaterThan(0.15);

    const conflicts = detectPeriodicityConflicts(
      await gatherEvidence(ctx.db),
      ratios,
    );
    const pair = conflicts.find(
      (c) => c.monthlyCode === "carreta.ipva_licenciamento_mensal",
    );
    expect(pair).toBeDefined();
    expect(pair!.verdict).toBe("DISTINCT_BASES");
    expect(pair!.blocks).toBe(false);
  });

  it("no longer withholds a proposal from either side", async () => {
    const rows = await ctx.db
      .select()
      .from(attributeTable)
      .where(
        sql`${attributeTable.code} IN ('carreta.ipva_licenciamento', 'carreta.ipva_licenciamento_mensal')`,
      );
    expect(rows).toHaveLength(2);
    for (const attribute of rows) {
      expect(attribute.semanticsStatus).toBe("PRESUMED");
      // ...but the curator is warned that the shared prefix is misleading.
      expect(attribute.semanticsRationale).toMatch(/HOMÔNIMOS/);
      // Periodicity is still nobody's guess but a person's.
      expect(attribute.periodicity).toBeNull();
    }
  });

  it("leaves the cavalos counterpart alone — it has no pair at all", async () => {
    const [cavalo] = await ctx.db
      .select()
      .from(attributeTable)
      .where(eq(attributeTable.code, "cavalo.ipva_licenciamento"));
    /*
      O lado do cavalo não tem par, e por isso nada da confusão de homônimos da
      carreta pode encostar nele. Ele chega aqui CONFIRMED — é entrada do
      registro canônico, aplicada na importação, e o passe de proposta não toca
      em quem já está confirmado —, e a justificativa que carrega é a medição
      que o confirmou, não um aviso de conflito.
    */
    expect(cavalo.semanticsStatus).toBe("CONFIRMED");
    expect(cavalo.unit).toBe("BRL");
    expect(cavalo.periodicity).toBe("ANUAL");
    expect(cavalo.semanticsRationale).not.toMatch(/HOMÔNIMOS|CONFLITO/);
  });
});

describe("confirmation is a human act, enforced by the database", () => {
  it("rejects CONFIRMED without an attributed confirmer, even via raw SQL", async () => {
    // A non-monetary attribute, so the only rule that can fire is the one
    // under test: no confirmer, no confirmation.
    await expect(
      ctx.pool.query(
        `UPDATE attribute SET semantics_status = 'CONFIRMED' WHERE code = 'cavalo.chassi'`,
      ),
    ).rejects.toThrow(/attribute_confirmed_requires_actor/);

    // Half an attribution is still no attribution.
    await expect(
      ctx.pool.query(
        `UPDATE attribute SET semantics_status = 'CONFIRMED', confirmed_by = 'alguem'
          WHERE code = 'cavalo.chassi'`,
      ),
    ).rejects.toThrow(/attribute_confirmed_requires_actor/);
  });

  it("rejects a CONFIRMED monetary attribute with unknown periodicity", async () => {
    await expect(
      ctx.pool.query(
        `UPDATE attribute
            SET semantics_status = 'CONFIRMED',
                confirmed_by = 'someone',
                confirmed_at = now(),
                is_monetary = true,
                unit = 'BRL',
                periodicity = NULL,
                aggregation = 'SUM'
          WHERE code = 'carreta.seguro'`,
      ),
    ).rejects.toThrow(/attribute_confirmed_monetary_is_complete/);
  });

  it("refuses a confirmation with no justification", async () => {
    await expect(
      confirmAttribute(ctx.db, {
        code: "carreta.seguro",
        actor: "guy",
        reason: "   ",
      }),
    ).rejects.toThrow(/justificativa/);
  });

  it("refuses to confirm a monetary attribute whose periodicity is still unknown", async () => {
    await expect(
      confirmAttribute(ctx.db, {
        code: "carreta.seguro",
        actor: "guy",
        reason: "Contrato de seguro anual.",
        periodicity: null,
      }),
    ).rejects.toThrow(/periodicidade/i);
  });

  it("confirms when the semantics are complete, and records who and why", async () => {
    await confirmAttribute(ctx.db, {
      code: "carreta.seguro",
      unit: "BRL",
      periodicity: "MENSAL",
      aggregation: "SUM",
      isMonetary: true,
      taxonomyCode: "cf_seguros_tributos",
      actor: "guy@operalog",
      reason: "Confirmado com a apólice: valor mensal por implemento.",
    });

    const [attribute] = await ctx.db
      .select()
      .from(attributeTable)
      .where(eq(attributeTable.code, "carreta.seguro"));
    expect(attribute.semanticsStatus).toBe("CONFIRMED");
    expect(attribute.confirmedBy).toBe("guy@operalog");
    expect(attribute.confirmedAt).toBeInstanceOf(Date);
    expect(attribute.periodicity).toBe("MENSAL");

    const events = await ctx.db
      .select()
      .from(curationEventTable)
      .where(
        and(
          eq(curationEventTable.targetLabel, "carreta.seguro"),
          eq(curationEventTable.field, "semantics_status"),
        ),
      );
    const confirmation = events.find((e) => e.valueAfter === "CONFIRMED");
    expect(confirmation).toBeDefined();
    expect(confirmation!.actor).toBe("guy@operalog");
    expect(confirmation!.reason).toMatch(/apólice/);
  });
});

describe("curation never masquerades as a source change", () => {
  it("leaves every fact untouched while semantics move around", async () => {
    const [before] = await ctx.db
      .select({
        count: sql<number>`count(*)`.mapWith(Number),
        checksum: sql<string>`md5(string_agg(${factTable.valueHash}, '' ORDER BY ${factTable.id}))`,
      })
      .from(factTable);

    await runProposalPass(ctx.db, "test:another-pass");
    await confirmAttribute(ctx.db, {
      code: "carreta.custo_fixo",
      unit: "BRL",
      periodicity: "MENSAL",
      aggregation: "SUM",
      isMonetary: true,
      actor: "guy@operalog",
      reason: "Custo fixo mensal por implemento, conforme contrato.",
    });

    const [after] = await ctx.db
      .select({
        count: sql<number>`count(*)`.mapWith(Number),
        checksum: sql<string>`md5(string_agg(${factTable.valueHash}, '' ORDER BY ${factTable.id}))`,
      })
      .from(factTable);

    // Byte-for-byte identical: a reclassification can never be mistaken for
    // the Ambev having changed the remuneration.
    expect(after.count).toBe(before.count);
    expect(after.checksum).toBe(before.checksum);
  });
});

describe("the queue puts the money first", () => {
  it("ranks monetary attributes above the rest, by magnitude", async () => {
    const queue = await getCurationQueue(ctx.db);
    const firstNonMonetary = queue.findIndex((i) => i.isMonetary !== true);
    const lastMonetary = queue.map((i) => i.isMonetary === true).lastIndexOf(true);
    expect(lastMonetary).toBeLessThan(firstNonMonetary);

    const monetary = queue.filter((i) => i.isMonetary === true);
    expect(monetary.length).toBeGreaterThanOrEqual(10);
    /*
      A cabeça da fila era `cavalo.valor_nf_compra`, a maior magnitude da base.
      Ela saiu da fila por estar confirmada desde a importação — que é o
      comportamento do teste vizinho, e não uma regressão deste. O que a fila
      tem de continuar fazendo é ordenar por magnitude o que ainda **falta**
      curar, e nenhuma entrada do registro pode aparecer nela.
    */
    for (const item of queue) {
      expect(CODIGOS_DO_REGISTRO, item.code).not.toContain(item.code);
    }

    // Descending magnitude within the monetary block.
    for (let i = 1; i < monetary.length; i++) {
      expect(Math.abs(monetary[i - 1].magnitude ?? 0)).toBeGreaterThanOrEqual(
        Math.abs(monetary[i].magnitude ?? 0),
      );
    }
  });

  it("drops an attribute from the queue once it is confirmed", async () => {
    const queue = await getCurationQueue(ctx.db);
    expect(queue.map((i) => i.code)).not.toContain("carreta.seguro");
  });
});

describe("taxonomy", () => {
  it("is idempotent", async () => {
    const again = await seedTaxonomy(ctx.db, "test:bootstrap-again");
    expect(again.created).toBe(0);
    expect(again.existing).toBeGreaterThan(0);
  });
});
