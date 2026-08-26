import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { computeMissingChangeSets } from "../consolidated";
import { getRangeAnalysis } from "../families-view";
import { getGroupVehicles } from "../grouped";
import { listContexts } from "../series";
import { buildFixture, type AttributeSpec } from "./fixtures";

/**
 * O que `getGroupVehicles` responde com contexto e sem contexto.
 *
 * Escrito para diagnosticar um defeito de tela: `detalhe-do-intervalo.tsx` e
 * `group-card.tsx` pediam a lista de placas sem `scopeHash` nem `canal`, e a
 * gaveta passava a listar placas de outra unidade por baixo de um total que
 * continuava certo — `/changes/range` recebia o contexto e a lista não. A
 * correção é nas telas (ver `paramsDosVeiculosDoGrupo` e o teste que obriga
 * todas a usá-la), e não aqui: o servidor sempre se comportou como o
 * documentado.
 *
 * O que fica preso aqui é justamente esse comportamento, porque ele é a razão
 * de o defeito ter sido invisível. **Contexto ausente não quer dizer "sem
 * filtro"**: `resolveContext` cai em `contexts[0]` — a unidade com a vigência
 * mais recente —, devolve uma resposta plausível e não avisa ninguém. Enquanto
 * for assim, toda chamada tem de mandar o contexto, e é o custo desse padrão
 * que os dois casos abaixo deixam medido.
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

it("sem contexto, a resposta é do contexts[0] — plausível e de outra unidade", async () => {
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

  /*
    O total é da unidade B: −1.000, uma carreta. Sem contexto, a mesma pergunta
    devolve a placa da unidade A com +200 — nem a placa, nem o valor, nem o
    sinal. Nada na resposta diz que o assunto mudou, e é por isso que a tela
    tem de mandar o contexto.
  */
  expect(entrada.amount).toBe(-1000);
  expect(semContexto.map((v) => v.plate)).toEqual(["AAA1A11"]);
  expect(semContexto.map((v) => v.impactAmount)).toEqual([200]);

  // Com o contexto — o que as telas passaram a fazer —, a lista é a do total.
  expect(comContexto.map((v) => v.plate)).toEqual(["BBB2B22"]);
  expect(comContexto.map((v) => v.impactAmount)).toEqual([-1000]);
});
