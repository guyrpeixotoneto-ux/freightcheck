import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { computeMissingChangeSets } from "../consolidated";
import { getRangeAnalysis } from "../families-view";
import { getGroupVehicles } from "../grouped";
import { listContexts } from "../series";
import { buildFixture, type AttributeSpec } from "./fixtures";

/**
 * A lista de placas do nível 2 é do mesmo contexto que o total que a abriu?
 *
 * Hoje **não é**, e este arquivo é a prova. `detalhe-do-intervalo.tsx` e
 * `group-card.tsx` chamam `/changes/grouped/vehicles` sem `scopeHash` nem
 * `canal`; sem eles, `resolveContext` cai em `contexts[0]` em silêncio
 * (`series.ts:382`) — que é a unidade com a vigência mais recente, não a que
 * está na tela. O total continua certo, porque `/changes/range` recebe o
 * contexto; só a lista muda de assunto.
 *
 * Está marcado `it.fails` porque a correção ainda não foi decidida: enquanto o
 * defeito existir, a asserção falha e o teste passa. No dia em que o contexto
 * for repassado, este teste quebra — e a correção é trocar `it.fails` por `it`.
 */

let ctx: TestDb;

const UNIDADE_A = "aaa-unidade-a";
const UNIDADE_B = "bbb-unidade-b";

const CUSTO: AttributeSpec[] = [
  {
    code: "carreta.custo_fixo",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
    taxonomyCode: "cf_frota_carreta",
  },
];

beforeAll(async () => {
  ctx = await createTestDatabase("diag_contexto");
  await seedTaxonomy(ctx.db, "test");

  // Unidade A: uma placa, 1000 -> 1200 (+200/mês).
  await buildFixture(
    ctx.db,
    CUSTO,
    [
      { label: "EMPURRADA_2_1_2026", effectiveDate: "2026-01-02", data: { AAA1A11: { "carreta.custo_fixo": 1000 } } },
      { label: "EMPURRADA_2_2_2026", effectiveDate: "2026-02-02", data: { AAA1A11: { "carreta.custo_fixo": 1200 } } },
    ],
    { entityType: "CARRETA", scopeHash: UNIDADE_A },
  );

  // Unidade B: outra placa, mesmas datas, 5000 -> 4000 (−1000/mês).
  await buildFixture(
    ctx.db,
    CUSTO,
    [
      { label: "EMPURRADA_2_1_2026", effectiveDate: "2026-01-02", data: { BBB2B22: { "carreta.custo_fixo": 5000 } } },
      { label: "EMPURRADA_2_2_2026", effectiveDate: "2026-02-02", data: { BBB2B22: { "carreta.custo_fixo": 4000 } } },
    ],
    { entityType: "CARRETA", scopeHash: UNIDADE_B },
  );

  await computeMissingChangeSets(ctx.db, "test");
}, 180_000);

afterAll(async () => {
  await ctx?.drop();
});

it.fails("as placas do nível 2 são do contexto que o total abriu", async () => {
  const contextos = await listContexts(ctx.db);
  console.log("CONTEXTOS (ordem de listContexts):", contextos.map((c) => `${c.scopeHash}|${c.channel}`));

  const analise = await getRangeAnalysis(ctx.db, "2026-01-02", "2026-02-02", {
    scopeHash: UNIDADE_B,
  });
  const entrada = analise!.entries[0];
  console.log("CONTEXTO RESOLVIDO PELO TOTAL:", analise!.context.scopeHash, analise!.context.channel);
  console.log("TOTAL DO GRUPO (unidade B):", entrada.amount, entrada.periodicity, "veículos:", entrada.vehicles);

  // Exatamente a chamada que `detalhe-do-intervalo.tsx` e `group-card.tsx` fazem:
  // sem scopeHash, sem canal.
  const semContexto = await getGroupVehicles(ctx.db, {
    period: entrada.period,
    attributeCode: entrada.group.attributeCode!,
    entityType: entrada.group.entityType!,
    changeType: entrada.group.changeType,
    comparability: entrada.group.comparability,
    impactConfidence: entrada.group.impact.confidence,
  });
  console.log(
    "PLACAS SEM CONTEXTO:",
    semContexto.map((v) => `${v.plate}: ${v.numericBefore} -> ${v.numericAfter} = ${v.impactAmount}`),
  );

  // A mesma chamada que `prioridade.tsx` faz: com o contexto da tela.
  const comContexto = await getGroupVehicles(ctx.db, {
    period: entrada.period,
    attributeCode: entrada.group.attributeCode!,
    entityType: entrada.group.entityType!,
    changeType: entrada.group.changeType,
    comparability: entrada.group.comparability,
    impactConfidence: entrada.group.impact.confidence,
    scopeHash: UNIDADE_B,
  });
  console.log(
    "PLACAS COM CONTEXTO (B):",
    comContexto.map((v) => `${v.plate}: ${v.numericBefore} -> ${v.numericAfter} = ${v.impactAmount}`),
  );

  // A lista de placas tem de ser a do contexto do total. Hoje devolve AAA1A11
  // — a placa da unidade A — sob um total de −1.000 que é da unidade B.
  expect(semContexto.map((v) => v.plate)).toEqual(["BBB2B22"]);
});
