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
 *
 * ---------------------------------------------------------------------------
 * Duas coisas que este arquivo aprendeu em 26/08/2026
 * ---------------------------------------------------------------------------
 * **O `--` do pnpm não é argumento.** `process.argv[2]` era `"--"`, passava na
 * validação de "não está vazio", e a rodada anunciou `como --…`. O responsável
 * agora sai de `atorDosArgumentos`, que descarta separador e bandeira; um ator
 * que comece por `-` deixa de existir, e a rodada recusa antes de escrever.
 *
 * **A causa mora em `err.cause`.** A mesma rodada devolveu 110 linhas de
 * `Failed query: select …` — o envelope do drizzle, nunca o motivo. Schema
 * atrasado e banco fora do ar produzem esse texto **idêntico**, então a saída
 * antiga não permitia escolher entre rodar uma migration e corrigir a URL.
 * Agora a falha estrutural para a rodada na primeira ocorrência e sai com
 * SQLSTATE, mensagem do Postgres e — quando é coluna ausente — a migration
 * que a cria.
 */
import { createDb } from "@workspace/db";
import { migrationQueRepoe } from "@workspace/db/conferir-schema";
import { textoDaFalhaDoBanco } from "@workspace/db/falha-do-banco";
import { aplicarDirecaoEconomicaTrecho, DIRECAO_ECONOMICA_TRECHO } from "../direcao-economica-trecho";
import { atorDosArgumentos } from "./argumentos";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL não definida.");
  process.exit(1);
}

const actor = atorDosArgumentos(process.argv.slice(2));
if (!actor) {
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

  if (resumo.interrompidaPor) {
    const { code, falha } = resumo.interrompidaPor;
    console.error(
      `\nO banco recusou a primeira consulta, em ${code}. A rodada parou aqui: ` +
        `${resumo.naoTentadas} atributo(s) não foram tentados, porque a causa abaixo ` +
        `vale para todos eles.\n`,
    );
    for (const linha of textoDaFalhaDoBanco(falha)) console.error(linha);

    /*
      Coluna ausente é o único caso em que dá para nomear o reparo exato, e é
      o caso que mais parece outra coisa: quem lê "não encontrado" pensa em
      dado faltando, não em migration. A migration sai do disco, pela mesma
      varredura que o `conferir-schema` usa.
    */
    if (falha.classe === "SCHEMA_ATRASADO" && falha.objetoAusente) {
      const origem = migrationQueRepoe({ tabela: "attribute", coluna: falha.objetoAusente });
      if (origem) {
        console.error(
          `\n  A coluna "${falha.objetoAusente}" é criada pela migration ${origem.tag}:\n` +
            `    ${origem.comando}`,
        );
      }
    }
    console.error("\nNada foi gravado por esta rodada além do que o resumo acima informa.");
    process.exitCode = 1;
  } else if (resumo.falhas.length > 0) {
    console.log(`  ${resumo.falhas.length} falha(s) de atributo:`);
    for (const f of resumo.falhas) console.log(`    ${f.code}: ${f.erro}`);
    process.exitCode = 1;
  } else {
    console.log("Concluído sem falhas.");
  }
} finally {
  await pool.end();
}
