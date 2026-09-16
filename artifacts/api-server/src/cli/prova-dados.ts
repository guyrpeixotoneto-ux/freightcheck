import { db } from "@workspace/db";
import { computeMissingChangeSets } from "@workspace/comparison";

/**
 * As comparações que faltam — o passo que `dev:seed` não dá.
 *
 * `dev:seed` importa as vigências e cura a semântica, e para aí. Nenhuma
 * comparação é calculada, e isso é coerente com o produto: no uso real quem
 * calcula é a tela de Comparar vigências, ou a rota que a atende, no momento em
 * que alguém pede.
 *
 * O efeito num banco de desenvolvimento, porém, é enganoso. As telas de
 * **intervalo** — Linha do Tempo, Evolução por Placa, Evolução anual do FINAME
 * — leem `change_set` e nada mais: sem eles, cada vigência importada vira uma
 * lacuna nomeada e o total sai zero. A tela está certa (ela diz que não há
 * comparação calculada, em vez de contar zero), mas quem abriu para conferir
 * uma mudança lê como defeito — e foi exatamente o que aconteceu na primeira
 * conferência visual da Evolução anual.
 *
 * Daí este CLI. Ele não é do produto e não tem regra própria: chama
 * `computeMissingChangeSets`, que é a mesma função que a rota chama, com a
 * mesma régua. Idempotente — o que já existe é contado como `existing` e não é
 * recalculado.
 *
 * Uso:
 *
 *   DATABASE_URL=... npx tsx src/cli/prova-dados.ts
 *
 * Normalmente não se chama à mão: `node scripts/prova-local.mjs subir` já o faz
 * no passo certo.
 */
async function main(): Promise<void> {
  const resumo = await computeMissingChangeSets(db, "prova-local");
  console.log(
    `comparações: ${resumo.computed} calculadas · ${resumo.existing} já existiam · ${resumo.series} série(s)`,
  );
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : String(erro));
  process.exit(1);
});
