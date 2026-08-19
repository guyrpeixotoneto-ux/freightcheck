/**
 * Backup e restauração pela linha de comando.
 *
 *   DATABASE_URL=… BACKUP_DIR=… pnpm --filter @workspace/db run backup
 *   pnpm --filter @workspace/db run backup:listar
 *   DATABASE_URL=<banco NOVO e VAZIO> pnpm --filter @workspace/db run backup:restaurar -- <arquivo>
 *
 * A restauração exige um banco vazio de propósito — ver `restaurarBackup`.
 */
import { fazerBackup, listarBackups, restaurarBackup } from "./backup";

const comando = process.argv[2];

function exigir(nome: string): string {
  const valor = process.env[nome];
  if (!valor) {
    console.error(`${nome} é obrigatória para este comando.`);
    process.exit(2);
  }
  return valor;
}

async function main(): Promise<void> {
  if (comando === "backup") {
    const resultado = await fazerBackup({
      databaseUrl: exigir("DATABASE_URL"),
      dir: exigir("BACKUP_DIR"),
    });
    console.log(
      `Backup completo: ${resultado.arquivo} (${(resultado.bytes / 1024).toFixed(0)} KiB ` +
        `em ${(resultado.duracaoMs / 1000).toFixed(1)}s; ${resultado.podados} antigo(s) podado(s)).`,
    );
    return;
  }

  if (comando === "listar") {
    const backups = listarBackups(exigir("BACKUP_DIR"));
    if (backups.length === 0) {
      console.log("Nenhum backup no diretório.");
      return;
    }
    for (const b of backups) {
      console.log(`${b.mtime.toISOString()}  ${(b.bytes / 1024).toFixed(0).padStart(8)} KiB  ${b.arquivo}`);
    }
    return;
  }

  if (comando === "restaurar") {
    const arquivo = process.argv[3];
    if (!arquivo) {
      console.error("Uso: … run backup:restaurar -- <arquivo .dump>");
      process.exit(2);
    }
    await restaurarBackup({ databaseUrl: exigir("DATABASE_URL"), arquivo });
    console.log(`Restaurado ${arquivo} em ${process.env["DATABASE_URL"]?.replace(/:[^:@/]+@/, ":***@")}.`);
    return;
  }

  console.error("Comandos: backup | listar | restaurar <arquivo>");
  process.exit(2);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
