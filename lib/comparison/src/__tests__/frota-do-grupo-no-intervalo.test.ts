import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestDb } from "@workspace/ingest/testing";
import { criarBancoComModelosCurados } from "../testing";
import { listPeriods } from "../consolidated";
import { getRangeAnalysis } from "../families-view";
import { getGroupedView } from "../grouped";

/**
 * A frota de um grupo, lida pelo intervalo e lida pela vigência.
 *
 * São o mesmo grupo e têm de dizer o mesmo denominador. Hoje não dizem:
 * `families-view.ts:561` grava o mapa de frota com a chave `change_set_id`,
 * enquanto `buildGroup` consulta `change_set_id\u001fentity_type`
 * (`grouped.ts:519`) — a chave composta que só o caminho da vigência grava
 * (`grouped.ts:1002`). O `get` erra sempre, o `?? 0` dispara, e `fleet` desaba
 * para o número de veículos do próprio grupo: "5 de 71 carretas" vira "toda a
 * frota · 5 de 5". O mesmo defeito está em `end-to-end.ts:284`.
 *
 * Nenhum valor financeiro depende de `fleet` — só o selo de cobertura.
 *
 * Está marcado `it.fails` porque a correção ainda não foi decidida: enquanto o
 * defeito existir, a asserção falha e o teste passa. Corrigidas as chaves, este
 * teste quebra — e a correção é trocar `it.fails` por `it`.
 */

let ctx: TestDb;

beforeAll(async () => {
  ctx = await criarBancoComModelosCurados("diag_frota");
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

it.fails("o intervalo e a vigência dão a mesma frota para o mesmo grupo", async () => {
  const periodos = await listPeriods(ctx.db);
  const fim = periodos[0].effective_date;
  const inicio = periodos[1].effective_date;
  console.log("INTERVALO:", inicio, "->", fim);

  const vigencia = await getGroupedView(ctx.db, fim);
  const naVigencia = new Map(
    vigencia!.groups.map((g) => [g.key, g]),
  );
  console.log(
    "FROTA POR SÉRIE (getGroupedView):",
    vigencia!.series.map((s) => `${s.entityTypeSet}=${s.fleet}`),
  );

  const analise = await getRangeAnalysis(ctx.db, inicio, fim);
  const doIntervalo = analise!.entries.filter((e) => e.period === fim);

  let iguaisAVehicles = 0;
  const divergentes: string[] = [];
  for (const e of doIntervalo) {
    const par = naVigencia.get(e.group.key);
    if (e.group.fleet === e.group.vehicles) iguaisAVehicles++;
    if (par && par.fleet !== e.group.fleet) {
      divergentes.push(
        `${e.group.attributeCode} [${e.group.entityType}] ` +
          `intervalo: ${e.group.vehicles} de ${e.group.fleet} (${e.group.coverageLabel}) | ` +
          `vigência: ${par.vehicles} de ${par.fleet} (${par.coverageLabel})`,
      );
    }
  }
  console.log(`GRUPOS NO INTERVALO: ${doIntervalo.length}`);
  console.log(`GRUPOS COM fleet === vehicles (cobertura "N de N"): ${iguaisAVehicles}`);
  console.log(`GRUPOS QUE DIVERGEM DA VIGÊNCIA: ${divergentes.length}`);
  for (const d of divergentes.slice(0, 12)) console.log("  -", d);

  // Nenhum grupo do intervalo pode contradizer a mesma leitura na vigência.
  // Hoje 17 dos 20 contradizem.
  expect(divergentes).toEqual([]);
});
