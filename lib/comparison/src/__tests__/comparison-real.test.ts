import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { changeTable, snapshotTable } from "@workspace/db";
import { captureRaw, preview, promote, receiveFile, stage } from "@workspace/ingest";
import { createTestDatabase, realExportPath, type TestDb } from "@workspace/ingest/testing";
import { applyConfirmations, runProposalPass, seedTaxonomy } from "@workspace/curation";
import { computeChangeSet, findPreviousSnapshot } from "../engine";
import { getChangeProvenance, listChanges, listComparableSnapshots } from "../query";
import { getEntityTable } from "../grouped";

/**
 * The engine against the real Freightec export.
 *
 * The totals below were established by an independent analysis of the workbook
 * before any of this code existed. They are the regression contract: if the
 * engine stops reproducing them, it changed its mind about what a change is.
 */

const BASELINE_BY_TRANSITION: Record<string, number> = {
  EMPURRADA_2_1_2026: 560,
  EMPURRADA_2_2_2026: 346,
  EMPURRADA_2_3_2026: 397,
  EMPURRADA_2_4_2026: 402,
  EMPURRADA_2_5_2026: 368,
  EMPURRADA_2_6_2026: 269,
  EMPURRADA_2_7_2026: 593,
  EMPURRADA_1_8_2026: 267,
};
const BASELINE_TOTAL = 3202;

let ctx: TestDb;
let snapshots: Awaited<ReturnType<typeof listComparableSnapshots>>;

beforeAll(async () => {
  ctx = await createTestDatabase("comparison_real");
  const received = await receiveFile(ctx.db, { filePath: realExportPath() });
  await captureRaw(ctx.db, received.importRunId);
  await stage(ctx.db, received.importRunId);
  await preview(ctx.db, received.importRunId);
  await promote(ctx.db, received.importRunId);
  await seedTaxonomy(ctx.db, "test");
  await runProposalPass(ctx.db, "test:proposal");
  snapshots = await listComparableSnapshots(ctx.db);
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("baseline", () => {
  it("reproduz a contagem de cada transição e o total", async () => {
    let total = 0;
    for (let i = 1; i < snapshots.length; i++) {
      const a = snapshots[i - 1];
      const b = snapshots[i];
      const set = await computeChangeSet(ctx.db, a.id, b.id, { force: true });
      expect(set.valueChanges, `${a.sourceLabel} → ${b.sourceLabel}`).toBe(
        BASELINE_BY_TRANSITION[b.sourceLabel],
      );
      total += set.valueChanges;
    }
    expect(total).toBe(BASELINE_TOTAL);
  }, 300_000);

  it("acha a movimentação de frota de Abr→Mai", async () => {
    const a = snapshots.find((s) => s.sourceLabel === "EMPURRADA_2_4_2026")!;
    const b = snapshots.find((s) => s.sourceLabel === "EMPURRADA_2_5_2026")!;
    const set = await computeChangeSet(ctx.db, a.id, b.id);
    // 4 carretas in, 9 carretas plus 2 cavalos out.
    expect(set.entitiesAdded).toBe(4);
    expect(set.entitiesRemoved).toBe(11);
  });

  it("não inventa colunas novas nem removidas num arquivo de layout único", async () => {
    for (let i = 1; i < snapshots.length; i++) {
      const set = await computeChangeSet(ctx.db, snapshots[i - 1].id, snapshots[i].id);
      expect(set.attributesAdded).toBe(0);
      expect(set.attributesRemoved).toBe(0);
    }
  });
});

describe("o achado do IPVA aparece no topo do que é comparável", () => {
  it("mostra a queda de 4.096,31 para 2.513,19 com origem dos dois lados", async () => {
    const a = snapshots.find((s) => s.sourceLabel === "EMPURRADA_2_6_2026")!;
    const b = snapshots.find((s) => s.sourceLabel === "EMPURRADA_2_7_2026")!;
    const set = await computeChangeSet(ctx.db, a.id, b.id);

    const { rows } = await listChanges(ctx.db, set.id, {
      attributeCode: "cavalo.ipva_licenciamento",
      limit: 200,
    });
    expect(rows.length).toBe(62);

    const qyq = rows.find((r) => r.entityLabel === "QYQ6A80")!;
    expect(Number(qyq.valueBefore)).toBeCloseTo(4096.31, 2);
    expect(Number(qyq.valueAfter)).toBeCloseTo(2513.19, 2);
    expect(qyq.deltaAbsolute).toBeCloseTo(-1583.12, 2);
    expect(qyq.deltaPercent).toBeCloseTo(-38.65, 1);
    // Semantics still unconfirmed, so no money is claimed.
    expect(qyq.impactConfidence).toBe("NOT_CALCULABLE");

    const provenance = (await getChangeProvenance(ctx.db, qyq.id)) as Record<string, unknown>;
    expect(provenance.sheet_before).toBe("cavalos");
    expect(provenance.sheet_after).toBe("cavalos");
    expect(provenance.header_before).toBe("ipvaLicenciamento");
    expect(provenance.header_after).toBe("ipvaLicenciamento");
    // Different physical rows, same asset — identity, not position.
    expect(provenance.row_before).not.toBe(provenance.row_after);
    expect(Number(provenance.raw_before)).toBeCloseTo(4096.31, 2);
    expect(Number(provenance.raw_after)).toBeCloseTo(2513.19, 2);
  });
});

describe("as 298 alterações destravadas pela curadoria", () => {
  it("mantém 345 alterações com impacto calculável na série inteira", async () => {
    await applyConfirmations(ctx.db);
    for (let i = 1; i < snapshots.length; i++) {
      await computeChangeSet(ctx.db, snapshots[i - 1].id, snapshots[i].id, { force: true });
    }

    const [calculated] = await ctx.db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(changeTable)
      .where(eq(changeTable.impactConfidence, "CALCULATED"));
    // 47 before the audit, 345 after confirming the high-confidence block.
    expect(calculated.n).toBe(345);

    // And the change count itself is untouched: curation prices changes, it
    // never creates or destroys them.
    const [values] = await ctx.db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(changeTable)
      .where(eq(changeTable.changeType, "VALUE_CHANGED"));
    expect(values.n).toBe(3202);
  }, 300_000);

  it("não deixa nenhum impacto calculado sem periodicidade declarada", async () => {
    const [orphans] = await ctx.db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(changeTable)
      .where(
        sql`${changeTable.impactConfidence} = 'CALCULATED'
            AND ${changeTable.impactPeriodicity} IS NULL`,
      );
    expect(orphans.n).toBe(0);
  });
});

describe("impacto nunca mistura periodicidades", () => {
  it("separa o mensal do anual na série real", async () => {
    const a = snapshots.find((s) => s.sourceLabel === "EMPURRADA_2_12_2025")!;
    const b = snapshots.find((s) => s.sourceLabel === "EMPURRADA_2_1_2026")!;
    const set = await computeChangeSet(ctx.db, a.id, b.id, { force: true });

    // This transition carries both: the IPVA drop (annual) and the FINAME
    // family (monthly). A scalar would have reported one misleading total.
    const buckets = set.calculatedImpactByPeriodicity;
    expect(Object.keys(buckets).sort()).toEqual(["ANUAL", "MENSAL"]);
    expect(buckets.ANUAL).toBeLessThan(-500_000);
    expect(buckets.MENSAL).toBeLessThan(0);
    expect(buckets.MENSAL).toBeGreaterThan(-200_000);
  });
});

describe("nada é escondido", () => {
  it("classifica as inconclusivas e as mantém na lista", async () => {
    const a = snapshots.find((s) => s.sourceLabel === "EMPURRADA_2_7_2026")!;
    const b = snapshots.find((s) => s.sourceLabel === "EMPURRADA_1_8_2026")!;
    const set = await computeChangeSet(ctx.db, a.id, b.id);

    // dataFimContrato is the column the source types inconsistently.
    expect(set.inconclusive).toBe(62);
    const { rows, total } = await listChanges(ctx.db, set.id, {
      comparability: "INCONCLUSIVE",
      limit: 100,
    });
    expect(total).toBe(62);
    expect(rows.every((r) => r.inconclusiveReason !== null)).toBe(true);
    expect(rows[0].attributeCode).toBe("cavalo.data_fim_contrato");

    // And they are part of the unfiltered listing, not a separate bucket.
    const all = await listChanges(ctx.db, set.id, { limit: 400 });
    expect(all.total).toBe(set.valueChanges);
  });

  it("filtra por classe de custo sem perder o que não tem classe", async () => {
    const a = snapshots.find((s) => s.sourceLabel === "EMPURRADA_2_7_2026")!;
    const b = snapshots.find((s) => s.sourceLabel === "EMPURRADA_1_8_2026")!;
    const set = await computeChangeSet(ctx.db, a.id, b.id);

    const fixo = await listChanges(ctx.db, set.id, { costClass: "FIXO", limit: 500 });
    const variavel = await listChanges(ctx.db, set.id, { costClass: "VARIAVEL", limit: 500 });
    const semClasse = await listChanges(ctx.db, set.id, { costClass: "SEM_CLASSE", limit: 500 });
    const todas = await listChanges(ctx.db, set.id, { limit: 500 });

    expect(fixo.total + variavel.total + semClasse.total).toBe(todas.total);
    expect(fixo.total).toBeGreaterThan(0);
    expect(variavel.total).toBeGreaterThan(0);
  });
});

describe("a série entregue junto com outra continua sendo uma série entregue", () => {
  it("CARRETA é reconhecida dentro do conjunto CARRETA+CAVALO", async () => {
    /*
      Este workbook traz os dois equipamentos, então a vigência guarda
      `entity_type_set = 'CARRETA+CAVALO'`. Comparar esse conjunto com o tipo
      pedido por igualdade respondia "esta vigência não trouxe CARRETA" para o
      formato em que o export chegou primeiro — e a tela usa essa resposta para
      mandar importar um arquivo que já está no banco. A pergunta é de
      pertinência ao conjunto, e não de igualdade com ele.
    */
    const tabela = (await getEntityTable(ctx.db, "CARRETA", [
      "carreta.placa",
      "carreta.chassi",
    ]))!;

    expect(tabela.seriesDelivered).toBe(true);
    expect(tabela.rows.length).toBeGreaterThan(0);
  });
});

describe("reimportar o mesmo conteúdo não gera alteração falsa", () => {
  it("compara a revisão 2 com a revisão 1 e não encontra nada", async () => {
    // A byte-different copy of the same workbook, promoted as a new revision:
    // the content is identical, so the comparison must be empty.
    const { copyFileSync, appendFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const copy = path.join(tmpdir(), `freightec-cmp-${process.pid}.xlsx`);
    copyFileSync(realExportPath(), copy);
    appendFileSync(copy, Buffer.from("cmp"));

    const received = await receiveFile(ctx.db, { filePath: copy });
    await captureRaw(ctx.db, received.importRunId);
    await stage(ctx.db, received.importRunId);
    await preview(ctx.db, received.importRunId);
    await promote(ctx.db, received.importRunId, { onExistingSnapshot: "NEW_REVISION" });

    const label = "EMPURRADA_1_8_2026";
    const revisions = await ctx.db
      .select()
      .from(snapshotTable)
      .where(eq(snapshotTable.sourceLabel, label))
      .orderBy(snapshotTable.revision);
    expect(revisions).toHaveLength(2);

    const set = await computeChangeSet(ctx.db, revisions[0].id, revisions[1].id, {
      force: true,
    });
    expect(set.valueChanges).toBe(0);
    expect(set.entitiesAdded).toBe(0);
    expect(set.entitiesRemoved).toBe(0);
    expect(set.attributesAdded).toBe(0);
    expect(set.attributesRemoved).toBe(0);
    expect(set.inconclusive).toBe(0);
    expect(set.unchanged).toBeGreaterThan(9000);

    const [count] = await ctx.db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(changeTable)
      .where(eq(changeTable.changeSetId, set.id));
    expect(count.n).toBe(0);
  }, 300_000);
});

describe("escolha do snapshot anterior", () => {
  it("aponta para a vigência imediatamente anterior", async () => {
    const julho = snapshots.find((s) => s.sourceLabel === "EMPURRADA_2_7_2026")!;
    const previous = await findPreviousSnapshot(ctx.db, julho.id);
    const [row] = await ctx.db
      .select()
      .from(snapshotTable)
      .where(eq(snapshotTable.id, previous!));
    expect(row.sourceLabel).toBe("EMPURRADA_2_6_2026");
  });

  it("devolve null para a primeira vigência da série", async () => {
    const primeira = snapshots[0];
    expect(await findPreviousSnapshot(ctx.db, primeira.id)).toBeNull();
  });
});

describe("recomputar não acumula", () => {
  it("gera o mesmo resultado quantas vezes rodar", async () => {
    const a = snapshots.find((s) => s.sourceLabel === "EMPURRADA_2_6_2026")!;
    const b = snapshots.find((s) => s.sourceLabel === "EMPURRADA_2_7_2026")!;
    const first = await computeChangeSet(ctx.db, a.id, b.id, { force: true });
    const second = await computeChangeSet(ctx.db, a.id, b.id, { force: true });
    expect(second.valueChanges).toBe(first.valueChanges);

    const { total } = await listChanges(ctx.db, second.id, { limit: 1 });
    expect(total).toBe(second.valueChanges);
  }, 120_000);
});
