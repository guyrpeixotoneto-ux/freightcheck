/**
 * O bridge pela linha de comando.
 *
 * Arquivo separado pelo mesmo motivo de `migrate-cli.ts`: um módulo que só roda
 * quando alguém o executa, e um módulo que só é importado por quem quer a
 * função. O bundle do api-server carrega o segundo e não o primeiro.
 *
 *   pnpm --filter @workspace/db run bridge:down -- --dry-run
 *   pnpm --filter @workspace/db run bridge:down
 *   pnpm --filter @workspace/db run bridge:up
 */
import { bridgeDown, bridgeUp, type BridgeReport } from "./bridge";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL must be set to run the bridge.");
  process.exit(1);
}

const modo = process.argv[2];
const dryRun = process.argv.includes("--dry-run");

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
}

const acao =
  modo === "down"
    ? bridgeDown(url, { dryRun })
    : modo === "up"
      ? bridgeUp(url)
      : null;

if (!acao) {
  console.error("uso: bridge-cli (down|up) [--dry-run]");
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
