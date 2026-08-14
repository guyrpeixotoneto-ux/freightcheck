import { runMigrations } from "./migrate";

/**
 * Aplicar as migrations pela linha de comando.
 *
 * Arquivo separado de propósito: enquanto isto vivia dentro de `migrate.ts`, o
 * bundle do api-server carregava junto um CLI que se achava executado
 * diretamente e derrubava o servidor. Um módulo que só é importado por quem
 * quer a função, e um módulo que só roda quando alguém o executa.
 */
const url = process.env.DATABASE_URL;

if (!url) {
  console.error("DATABASE_URL must be set to run migrations.");
  process.exit(1);
}

runMigrations(url)
  .then((report) => {
    /*
      O que entrou sai nomeado, e não como "Migrations applied.". Agora que cada
      migration é uma transação sua, "deu certo" e "deu certo até a 0007" são
      desfechos diferentes, e quem roda isto precisa distinguir os dois sem ir
      ao banco conferir.
    */
    if (report.applied.length > 0) {
      console.log(`Migrations aplicadas: ${report.applied.join(", ")}.`);
    } else if (!report.failure) {
      console.log(
        `Nada a aplicar: as ${report.alreadyApplied.length} migrations já estavam no banco.`,
      );
    }

    if (report.failure) {
      console.error(
        `\nParou em ${report.failure.tag}` +
          (report.failure.code ? ` (SQLSTATE ${report.failure.code})` : "") +
          `: ${report.failure.message}`,
      );
      if (report.pending.length > 1) {
        console.error(
          `Não foram tentadas: ${report.pending.slice(1).join(", ")}.`,
        );
      }
      process.exit(1);
    }

    process.exit(0);
  })
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
