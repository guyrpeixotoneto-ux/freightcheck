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
 *
 * O `down` lê **dois** bancos: `DATABASE_URL` é Development, que ele altera, e
 * `PRODUCTION_DATABASE_URL` é Production, que ele só lê. A segunda não tem
 * default: o `down` só sabe se aproxima ou afasta os dois lados olhando para o
 * de lá, e a versão que não olhava propôs desfazer a `0013` e a `0014` em
 * produção. O `up` mexe em Development e nada mais, e por isso não a pede.
 */
import { bridgeDown, bridgeUp, type BridgeReport } from "./bridge";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL must be set to run the bridge.");
  process.exit(1);
}

const modo = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
const producao = process.env.PRODUCTION_DATABASE_URL;

if (modo === "down" && !producao) {
  console.error(
    "PRODUCTION_DATABASE_URL must be set to run `bridge:down`.\n" +
      "\n" +
      "O `down` derruba de Development o que Production não tem e recria o que\n" +
      "ela tem. Sem ler o schema de lá não há como saber qual dos dois é o caso,\n" +
      "e o `down` cego é o que propôs remover changed_parameter_count,\n" +
      "vigencia_label e entity_description de produção em 16/08/2026.\n" +
      "\n" +
      "Se Production já está canônica, não é o `down` que você quer:\n" +
      "  pnpm --filter @workspace/db run bridge:up\n" +
      "Ver docs/MIGRATIONS.md.",
  );
  process.exit(1);
}

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
    ? bridgeDown(url, { dryRun, producao })
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
