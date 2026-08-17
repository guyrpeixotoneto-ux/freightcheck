/**
 * O bridge pela linha de comando.
 *
 * Arquivo separado pelo mesmo motivo de `migrate-cli.ts`: um módulo que só roda
 * quando alguém o executa, e um módulo que só é importado por quem quer a
 * função. O bundle do api-server carrega o segundo e não o primeiro.
 *
 *   pnpm --filter @workspace/db run publicar:conferir
 *   pnpm --filter @workspace/db run bridge:down -- --dry-run
 *   pnpm --filter @workspace/db run bridge:down
 *   pnpm --filter @workspace/db run bridge:up
 *
 * `DATABASE_URL` é sempre Development — é o banco em que o bridge escreve.
 * `PRODUCTION_DATABASE_URL` é Production, e é **somente leitura** nos três
 * modos: nada aqui escreve nela, nunca. Ela existe para uma pergunta só, a que
 * faltava — o que a proposta do Publishing faria com o banco de lá.
 */
import {
  bridgeDown,
  bridgeUp,
  conferirProposta,
  textoDaProposta,
  type BridgeReport,
} from "./bridge";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL must be set to run the bridge.");
  process.exit(1);
}

const modo = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
const daLinha = process.argv
  .find((a) => a.startsWith("--producao="))
  ?.slice("--producao=".length);
const producaoUrl = daLinha || process.env.PRODUCTION_DATABASE_URL || undefined;

function imprimir(rel: BridgeReport): void {
  if (rel.precondicoes.length > 0) {
    console.log("\nPré-condições:");
    for (const p of rel.precondicoes) {
      console.log(`  ${p.ok ? "✓" : "✗"} ${p.nome} — ${p.detalhe}`);
    }
  }
  for (const d of rel.dependencias) {
    const texto = d.dependentes.length === 0 ? "nenhuma inesperada" : d.dependentes.join(", ");
    console.log(`  · dependentes de ${d.objeto}: ${texto}`);
  }
  if (rel.ddl.length > 0) {
    console.log(`\nDDL (${rel.ddl.length}${rel.dryRun ? ", NÃO aplicado" : ""}):`);
    for (const s of rel.ddl) console.log(`  ${s}`);
  }
  if (rel.verificacao.length > 0) {
    console.log("\nVerificação do estado residual:");
    for (const v of rel.verificacao) {
      console.log(`  ${v.ok ? "✓" : "✗"} ${v.nome}${v.ok ? "" : ` — ${v.detalhe}`}`);
    }
  }
  for (const aviso of rel.avisos) console.log(`\n⚠ ${aviso}`);
}

/**
 * A conferência sozinha, sem descer nada.
 *
 * É o que se roda **antes de apertar Publish**, e é a única resposta observável
 * para "a proposta que aquela tela vai montar é segura?". Somente leitura dos
 * dois lados.
 */
async function conferir(producao: string): Promise<never> {
  const p = await conferirProposta(url!, producao);

  console.log(`\nO que o Publishing criaria em Production: ${p.criaria.length}`);
  for (const l of p.criaria) console.log(`  + ${l}`);

  console.log(`\nO que ele removeria de Production: ${p.removeria.length}`);
  for (const l of p.removeria) console.log(`  - ${l}`);

  if (p.removeria.length > 0) {
    console.error(`\n✗ ${textoDaProposta(p.removeria)}`);
    process.exit(1);
  }
  console.log(
    "\n✓ a proposta é só aditiva — nenhum objeto de Production seria removido." +
      "\n  Publicar recusando a proposta continua sendo o caminho: quem aplica a" +
      "\n  fila em Production é o servidor, na partida.",
  );
  process.exit(0);
}

if (modo === "conferir") {
  if (!producaoUrl) {
    console.error(
      "conferir compara Development com Production: defina PRODUCTION_DATABASE_URL " +
        "ou passe --producao=<url>. Production é lida, nunca escrita.",
    );
    process.exit(1);
  }
  await conferir(producaoUrl);
}

const acao =
  modo === "down"
    ? bridgeDown(url, { dryRun, ...(producaoUrl ? { producaoUrl } : {}) })
    : modo === "up"
      ? bridgeUp(url)
      : null;

if (!acao) {
  console.error("uso: bridge-cli (down|up|conferir) [--dry-run] [--producao=<url>]");
  process.exit(1);
}

acao
  .then((rel) => {
    imprimir(rel);
    if (rel.falha) {
      console.error(`\n✗ bridge abortou: ${rel.falha}`);
      console.error("Nada foi alterado — a transação inteira voltou atrás.");
      process.exit(1);
    }
    console.log(
      rel.dryRun
        ? "\n✓ dry-run: o bridge passaria. Nada foi aplicado."
        : `\n✓ bridge ${modo} aplicado.`,
    );
    process.exit(0);
  })
  .catch((err) => {
    console.error("bridge falhou:", err);
    process.exit(1);
  });
