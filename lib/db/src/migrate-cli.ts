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
  .then(() => {
    console.log("Migrations applied.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
