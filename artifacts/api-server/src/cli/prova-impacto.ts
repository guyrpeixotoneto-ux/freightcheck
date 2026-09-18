/**
 * PROVA DO CASO REAL — as três leituras do mesmo dinheiro, lado a lado.
 *
 * Lê o banco de `scripts/prova-local.mjs` (exports reais da Freightec) e imprime
 * o que cada superfície publicaria. Não escreve nada.
 *
 *   DATABASE_URL=... npx tsx src/cli/prova-impacto.ts
 */
import { db } from "@workspace/db";
import {
  getFamiliesView,
  getRangeAnalysis,
  prepararParDoPanorama,
  listPeriods,
  resolveContext,
  type FamiliesView,
} from "@workspace/comparison";

const baldes = (r: Record<string, number>) => {
  const e = Object.entries(r);
  return e.length === 0 ? "{}" : e.map(([k, v]) => `${k}=${v.toFixed(2)}`).join(" ");
};

const ladosDe = (view: FamiliesView) =>
  view.summary.sides.map(
    (s) =>
      `${s.periodicity}: liq=${s.net.toFixed(2)} ganhos=${s.gains.total.toFixed(2)} perdas=${s.losses.total.toFixed(2)}`,
  );

async function main(): Promise<void> {
  const contexto = await resolveContext(db, {});
  if (!contexto) throw new Error("sem contexto");
  const periodos = (await listPeriods(db, contexto))
    .map((p) => p.effective_date)
    .sort();
  console.log("VIGÊNCIAS:", periodos.join(", "));

  console.log("\n===== A) COLUNA DO SELETOR — cada vigência contra a anterior dela =====");
  const range = await getRangeAnalysis(
    db,
    periodos[0],
    periodos[periodos.length - 1],
    {},
  );
  if (!range) throw new Error("sem range");
  for (const m of range.movements) {
    console.log(
      `  ${m.period}  alt=${String(m.changes).padStart(4)}  byPeriodicity={${baldes(
        m.impact.byPeriodicity,
      )}}  calc=${m.impact.calculatedChanges} naoCalc=${m.impact.notCalculable}`,
    );
  }
  console.log("  gaps:", range.gaps.map((g) => g.period).join(", ") || "(nenhuma)");
  console.log("\n  cada linha do seletor agora DECLARA o seu recorte:");
  for (const m of range.movements.slice(0, 3)) {
    console.log(
      `    ${m.period}  recorte=${m.leitura.recorte}  par=${m.leitura.de?.label ?? "-"} -> ${m.leitura.para.label}  estado=${m.leitura.estado}`,
    );
  }
  console.log(
    `\n  E o INTERVALO é outro recorte: ${range.leitura.recorte} ` +
      `${range.leitura.de?.label} -> ${range.leitura.para.label} · estado=${range.leitura.estado} · ` +
      `consecutivo=${range.leitura.consecutivo}`,
  );

  // O dado cru que as funções da tela vão ler, gravado para a prova do front.
  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    process.env.DUMP ?? "/tmp/range.json",
    JSON.stringify(
      {
        from: range.from,
        to: range.to,
        periods: range.periods,
        movements: range.movements.map((m) => ({
          period: m.period,
          label: m.label,
          changes: m.changes,
          impact: m.impact,
        })),
        entries: range.entries,
        gaps: range.gaps,
      },
      null,
      2,
    ),
  );
  console.log("  (dump em", process.env.DUMP ?? "/tmp/range.json", ")");

  console.log("\n===== B) CARD — par canônico contra par salteado =====");
  const para = periodos[periodos.length - 1];
  const pares: [string, string][] = [
    ["CANÔNICO", periodos[periodos.length - 2]],
    ["SALTEADO", periodos[periodos.length - 3]],
    ["SALTEADO-LONGO", periodos[0]],
  ];
  for (const [rotulo, de] of pares) {
    const par = await prepararParDoPanorama(db, contexto, { de, para }, periodos);
    const view = await getFamiliesView(db, para, {}, undefined, de);
    if (!view) throw new Error("sem view");
    console.log(`\n  [${rotulo}] ${de} -> ${para} (invertido=${par.invertido}, calculadas=${par.calculadas})`);
    console.log(`    totals.changes       = ${view.totals.changes}`);
    console.log(`    vehiclesTouched      = ${view.totals.vehiclesTouched}`);
    console.log(`    calculatedChanges    = ${view.summary.impact.calculatedChanges}`);
    console.log(`    notCalculable        = ${view.summary.impact.notCalculable}`);
    console.log(`    impact.byPeriodicity = {${baldes(view.summary.impact.byPeriodicity)}}`);
    console.log(`    summary.sides        = [${ladosDe(view).join(" | ") || "VAZIO"}]`);
    const l = view.leitura;
    console.log(`    --- LEITURA CANÔNICA ---`);
    console.log(`    recorte              = ${l.recorte}`);
    console.log(`    par                  = ${l.de?.label ?? "(sem ponta De)"} -> ${l.para.label}`);
    console.log(`    consecutivo          = ${l.consecutivo}  invertido = ${l.invertido}`);
    console.log(`    intermediarias       = [${l.intermediarias.join(", ")}]`);
    console.log(`    estado               = ${l.estado}`);
    console.log(
      `    periodicidades       = ${
        l.periodicidades
          .map(
            (x) =>
              `${x.periodicity}(liq=${x.liquido.toFixed(2)} bruto=${x.movimentoBruto.toFixed(2)} movimento=${x.temMovimento})`,
          )
          .join(" ") || "NENHUMA"
      }`,
    );
    console.log(
      `    cobertura            = ${l.cobertura ? `${l.cobertura.percentual.toFixed(1)}% (${l.cobertura.apuradas}/${l.cobertura.total}) ${l.cobertura.qualidade.palavra}` : "n/a"}`,
    );
    console.log(`    semEfeitoFinanceiro  = ${l.totais.semEfeitoFinanceiro}`);
    for (const pend of l.pendencias.slice(0, 4)) {
      console.log(
        `      pendência: ${pend.alteracoes.toString().padStart(4)} · ${pend.motivo.slice(0, 64)}… (${pend.atributos.length} atributos)`,
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((erro) => {
    console.error(erro);
    process.exit(1);
  });
