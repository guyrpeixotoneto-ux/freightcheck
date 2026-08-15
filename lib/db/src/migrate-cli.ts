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

/**
 * `--adotar-existentes` — a saída para o registro de migrations perdido.
 *
 * Um banco que tem o schema e não tem o registro trava a fila na 0000: ela
 * esbarra num tipo que já existe, para ali, e nenhuma migration nova entra
 * nunca mais. Com esta bandeira, toda migration cujos objetos já estão no
 * banco é registrada sem rodar, e a fila segue para as que faltam de verdade.
 *
 * É bandeira, e não comportamento padrão, porque a evidência que a sustenta —
 * o schema estar como a migration o deixaria — não prova que um backfill
 * rodou. Declarar isso é ato de quem conhece o banco; a partida do servidor
 * não pode decidir por ninguém. As adotadas que mexem em dados saem nomeadas
 * no fim, para conferência à mão.
 */
const adoptExisting = process.argv.includes("--adotar-existentes");

runMigrations(url, undefined, { adoptExisting })
  .then((report) => {
    /*
      O que entrou sai nomeado, e não como "Migrations applied.". Agora que cada
      migration é uma transação sua, "deu certo" e "deu certo até a 0007" são
      desfechos diferentes, e quem roda isto precisa distinguir os dois sem ir
      ao banco conferir.
    */
    if (report.adopted.length > 0) {
      console.log(
        `Adotadas sem rodar (o banco já as tinha): ${report.adopted.join(", ")}.`,
      );
      if (report.adoptedWithData.length > 0) {
        console.warn(
          `\nAtenção: ${report.adoptedWithData.join(", ")} também mexem em dados, ` +
            `e o schema não diz se essa parte rodou. Confira à mão o efeito delas.`,
        );
      }
    }

    if (report.applied.length > 0) {
      console.log(`Migrations aplicadas: ${report.applied.join(", ")}.`);
    } else if (!report.failure && report.adopted.length === 0) {
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
      /*
        A dica só aparece quando ela é plausível: a fila parou na primeira
        migration de todas e o registro estava vazio. É a assinatura do
        registro perdido — e, fora dela, sugerir adoção mandaria alguém adotar
        um banco que está genuinamente incompleto.
      */
      if (
        report.alreadyApplied.length === 0 &&
        report.adopted.length === 0 &&
        report.failure.tag === report.pending[0] &&
        report.pending[0]?.startsWith("0000")
      ) {
        console.error(
          `\nO registro de migrations está vazio e o banco já tem objetos desta ` +
            `migration. É o caso do registro perdido: o schema existe, o registro ` +
            `dele é que sumiu. Se este banco de fato já teve estas migrations, ` +
            `rode de novo com --adotar-existentes.`,
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
