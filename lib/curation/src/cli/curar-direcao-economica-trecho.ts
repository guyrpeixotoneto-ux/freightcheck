/**
 * Aplicar a primeira rodada de curadoria de direção econômica de TRECHO.
 *
 *   DATABASE_URL=... pnpm run curar:direcao-economica-trecho -- "seu@email.com"
 *
 * Grava `attribute.economic_direction`/`economic_effect` (e a versão em
 * vigor de `attribute_semantics`) para os ~107 atributos revisados em
 * `direcao-economica-trecho.ts` — sem isso, o Radar de Trechos não tem como
 * saber se uma variação foi favorável ou desfavorável, e todo trecho com
 * alteração cai em Inconclusivo por falta de classificação.
 *
 * Idempotente: rodar de novo não regrava nada que já estivesse certo (ver
 * `definirDirecaoEconomica`, que resolve "já estava" sem `UPDATE`). Cada
 * gravação vira um `curation_event` com o autor e a data, então repetir a
 * chamada com um autor diferente não apaga o rastro da vez anterior — só
 * não muda nada, porque o valor já é o mesmo.
 */
import { createDb } from "@workspace/db";
import { aplicarDirecaoEconomicaTrecho, DIRECAO_ECONOMICA_TRECHO } from "../direcao-economica-trecho";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL não definida.");
  process.exit(1);
}

const actor = process.argv[2];
if (!actor || !actor.trim()) {
  console.error(
    'Informe o responsável pela curadoria: DATABASE_URL=... pnpm run curar:direcao-economica-trecho -- "seu@email.com"',
  );
  process.exit(1);
}

const { db, pool } = createDb(url);
try {
  console.log(
    `Aplicando direção econômica a ${DIRECAO_ECONOMICA_TRECHO.length} atributos de TRECHO, como ${actor}…`,
  );
  const resumo = await aplicarDirecaoEconomicaTrecho(db, actor);
  console.log(`  ${resumo.gravadas} gravadas, ${resumo.jaEstavam} já estavam certas.`);
  if (resumo.falhas.length > 0) {
    console.log(`  ${resumo.falhas.length} falha(s):`);
    for (const f of resumo.falhas) console.log(`    ${f.code}: ${f.erro}`);
    process.exitCode = 1;
  } else {
    console.log("Concluído sem falhas.");
  }
} finally {
  await pool.end();
}
