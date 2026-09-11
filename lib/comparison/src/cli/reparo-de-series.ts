/**
 * O reparo das séries indeterminadas, pela linha de comando.
 *
 * Existe por causa da pergunta que se faz **antes** de mexer em dado de
 * produção: quantos envios isto alcança, quais são, e em que cada um vira. Um
 * backfill que só se pode observar depois de rodar não é um backfill que alguém
 * aprova — é um que alguém descobre.
 *
 *   pnpm --filter @workspace/comparison exec tsx src/cli/reparo-de-series.ts
 *   pnpm --filter @workspace/comparison exec tsx src/cli/reparo-de-series.ts --aplicar
 *
 * Sem `--aplicar` ele **conta e não escreve**: nem a série, nem as comparações,
 * nem a linha do registro. É o padrão de propósito — num comando que mexe em
 * acervo, o default tem de ser o que não muda nada, e quem quer mudar digita.
 *
 * Com `--aplicar` ele faz exatamente o que a partida faz, pelo mesmo caminho:
 * mesma trava, mesmo registro, mesma transação por envio. Rodar aqui e depois
 * subir o servidor não repara duas vezes — a segunda passada encontra a linha
 * e sai.
 */
import { createDb } from "@workspace/db";
import {
  repararSeriesIndeterminadas,
  simularReparoDaSerie,
  type RelatorioDoReparo,
} from "../reparo-de-series";

const aplicar = process.argv.includes("--aplicar");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL ausente. Aponte-a para o banco que se quer contar ou reparar.",
  );
  process.exit(1);
}

/** O que cada envio vira, uma linha por envio — é isto que se lê antes de decidir. */
function imprimir(r: RelatorioDoReparo, aplicou: boolean): void {
  const titulo = aplicou ? "REPARO APLICADO" : "SIMULAÇÃO — nada foi escrito";
  console.log(`\n${titulo} · ${r.nome}\n`);

  if (!aplicou && r.encontrados === 0) {
    console.log("Nenhum envio com série indeterminada. Não há o que reparar.\n");
    return;
  }
  if (aplicou && !r.rodou) {
    console.log(
      "Este reparo já havia rodado neste banco — a linha de `reparo_de_dados` já\n" +
        "existia, e nada foi lido nem escrito.\n",
    );
    return;
  }

  for (const e of r.envios) {
    const destino = e.erro
      ? `FALHOU — ${e.erro}`
      : e.para === null
        ? "continua indeterminada (o arquivo não diz de onde veio)"
        : `"${e.para}" (${e.origem})`;
    console.log(`  ${e.filename}\n    ${e.ticketImportId}\n    → ${destino}\n`);
  }

  console.log(
    `encontrados: ${r.encontrados} · ` +
      `${aplicou ? "corrigidos" : "seriam corrigidos"}: ${r.corrigidos} · ` +
      `ignorados: ${r.ignorados} · falhas: ${r.falhas}\n`,
  );
  if (!aplicou) {
    console.log("Para aplicar: repita o comando com --aplicar.\n");
  }
}

const { db, pool } = createDb(url);
try {
  const relatorio = aplicar
    ? await repararSeriesIndeterminadas(db)
    : await simularReparoDaSerie(db);
  imprimir(relatorio, aplicar);
  /*
    Falha vira código de saída, e não só texto: quem roda isto num passo de
    deploy precisa que o passo reprove, e um `console.log` vermelho não reprova
    nada. `encontrados` e `ignorados` não são falha — o envio que continua
    indeterminado é a resposta certa para um arquivo que não diz de onde veio.
  */
  process.exit(relatorio.falhas > 0 ? 1 : 0);
} finally {
  await pool.end();
}
