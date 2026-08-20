import { readFileSync } from "node:fs";

import { createDb } from "@workspace/db";

import { diagnosticarPagamento } from "./diagnostico-pagamento";
import { lerConteudoDoDocumento } from "./persistencia";

/**
 * Por que este 03.08.20 não virou verba — linha a linha.
 *
 * ```
 * # da própria importação, sem arquivo nenhum no workspace:
 * PRODUCTION_DATABASE_URL='…' … ./src/explicar-pagamento-cli.ts --documento <uuid> --producao
 *
 * # ou de um arquivo em disco, quando ele existe:
 * pnpm --filter @workspace/fechamento exec tsx ./src/explicar-pagamento-cli.ts 03.08.20.txt
 * ```
 *
 * **A análise não mora aqui.** Ela é de `diagnostico-pagamento.ts`, pura e sob
 * teste, e a mesma que a tela mostra pela rota `/documentos/:id/diagnostico`.
 * Enquanto ela morava neste arquivo, a única forma de responder "importei e não
 * apareceu" era abrir um terminal com `DATABASE_URL` — e a resposta que quem
 * opera via na tela não podia ser conferida contra esta, porque não existia.
 * Este CLI é o que ele sempre foi menos a análise: uma forma de fazer a mesma
 * pergunta sobre um arquivo que ainda não entrou no sistema.
 */

/**
 * De onde vêm os bytes: do banco, pela importação, ou do disco.
 *
 * A primeira forma é a que fecha o ciclo — o arquivo guardado na importação
 * volta e é examinado sem que ninguém precise reenviá-lo. A segunda continua
 * existindo para o arquivo que ainda não entrou no sistema, e para os
 * documentos anteriores à `0047`, que não têm conteúdo guardado.
 */
async function obterConteudo(): Promise<{ bytes: Buffer; origem: string } | null> {
  const argumentos = process.argv.slice(2);
  const posicao = argumentos.indexOf("--documento");
  const documentoId = posicao >= 0 ? argumentos[posicao + 1] : undefined;

  if (!documentoId) {
    const caminho = argumentos.find((a) => !a.startsWith("--"));
    if (!caminho) {
      console.error(
        "uso: tsx ./src/explicar-pagamento-cli.ts <arquivo>\n" +
          "     tsx ./src/explicar-pagamento-cli.ts --documento <uuid> [--producao]",
      );
      return null;
    }
    return { bytes: readFileSync(caminho), origem: caminho };
  }

  const producao = argumentos.includes("--producao");
  const url = producao ? process.env.PRODUCTION_DATABASE_URL : process.env.DATABASE_URL;
  if (!url || url.trim() === "") {
    console.error(
      producao
        ? "PRODUCTION_DATABASE_URL não está definida (ou está vazia)."
        : "DATABASE_URL não está definida.",
    );
    return null;
  }
  const { db, pool } = createDb(url);
  try {
    const guardado = await lerConteudoDoDocumento(db, documentoId);
    if (!guardado) {
      console.error(
        `O documento ${documentoId} não tem conteúdo guardado.\n` +
          `Importações anteriores à migration 0047 não guardavam o arquivo — para essas,\n` +
          `passe o caminho do .txt, ou reenvie pelo app.`,
      );
      return null;
    }
    return {
      bytes: guardado.conteudo,
      origem: `${guardado.nomeDoArquivo} (importação ${documentoId.slice(0, 8)}, do banco)`,
    };
  } finally {
    await pool.end();
  }
}

async function principal(): Promise<void> {
  const obtido = await obterConteudo();
  if (!obtido) {
    process.exitCode = 1;
    return;
  }
  const { bytes: conteudo, origem: caminho } = obtido;
  const d = diagnosticarPagamento(conteudo);

  console.log(`arquivo: ${caminho}  (${conteudo.length} bytes)\n`);
  console.log(`  período declarado : ${d.cabecalho.periodo.inicio ?? "—"} a ${d.cabecalho.periodo.fim ?? "—"}`);
  console.log(`  unidade           : ${d.cabecalho.unidade ?? "— (não reconhecida)"}`);
  console.log(`  transportadora    : ${d.cabecalho.transportadora ?? "— (não reconhecida)"}`);
  console.log(`  verbas lidas      : ${d.lido.verbas}`);
  console.log(`  descontos lidos   : ${d.lido.descontos}`);
  console.log(`  totais lidos      : ${d.lido.totais}`);
  console.log(
    `  linhas_lidas      : ${d.lido.verbas + d.lido.descontos}  <- é este o número que o banco grava`,
  );
  console.log(`  linha de canal    : ${d.secoes.canal ? "encontrada" : "AUSENTE"}`);
  console.log(`  linha de bloco    : ${d.secoes.bloco ? "encontrada" : "AUSENTE"}`);
  console.log(`\n  ${d.causa}\n  ${d.resumo}`);

  if (d.lido.verbas === 0 && d.suspeitas.length > 0) {
    console.log(`\n=== ${d.suspeitas.length} linha(s) parecem verba e não foram aceitas ===`);
    for (const s of d.suspeitas.slice(0, 10)) {
      console.log(`\n  linha ${s.linha}: ${s.motivo}`);
      console.log(`    ${JSON.stringify(s.original.slice(0, 160))}`);
    }
    if (d.suspeitas.length > 10) console.log(`\n  … e mais ${d.suspeitas.length - 10}.`);
  }
}

await principal();
