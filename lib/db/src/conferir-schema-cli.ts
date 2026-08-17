import { createDb } from "./index";
import {
  comandoQueRepoe,
  compararSchema,
  tabelasDeclaradas,
} from "./conferir-schema";

/**
 * Conferir o schema pela linha de comando.
 *
 * Arquivo separado pelo mesmo motivo de `migrate-cli.ts`: um módulo que só roda
 * quando alguém o executa, e um módulo que só é importado por quem quer a
 * função. O porquê inteiro está em `conferir-schema.ts`.
 *
 * **Por que ler, e não consertar por padrão.** Sem bandeira este comando não
 * escreve nada. Divergência de schema tem mais de uma causa — migration
 * registrada sem rodar, objeto derrubado por fora, banco apontado para o
 * ambiente errado — e as três pedem decisões diferentes de quem conhece o
 * banco. Mesma razão pela qual `--adotar-existentes` é bandeira no
 * `migrate-cli`, e não comportamento de partida.
 *
 *   pnpm --filter @workspace/db run conferir-schema
 *   pnpm --filter @workspace/db run conferir-schema -- --aplicar
 */
const url = process.env.DATABASE_URL;

if (!url) {
  console.error("DATABASE_URL must be set to compare the schema.");
  process.exit(1);
}

const aplicar = process.argv.includes("--aplicar");

async function main(): Promise<void> {
  const { pool } = createDb(url!);

  const { rows } = await pool.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name
       from information_schema.columns
      where table_schema = 'public'`,
  );

  const reais = new Map<string, Set<string>>();
  for (const linha of rows) {
    if (!reais.has(linha.table_name)) reais.set(linha.table_name, new Set());
    reais.get(linha.table_name)!.add(linha.column_name);
  }

  const divergencia = compararSchema(tabelasDeclaradas(), reais);
  const { tabelasAusentes, colunasAusentes } = divergencia;

  if (tabelasAusentes.length === 0 && colunasAusentes.length === 0) {
    console.log(
      `Schema em dia: as ${divergencia.tabelasDeclaradas} tabelas que este ` +
        `build declara estão neste banco, com todas as suas colunas.`,
    );
    await pool.end();
    return;
  }

  /*
    Tabela inteira ausente é outro estado, e sai separado: significa que uma
    migration não rodou de ponta a ponta, e repor coluna não é a conversa.
  */
  if (tabelasAusentes.length > 0) {
    console.error(
      `\nTabelas que este build declara e o banco não tem: ` +
        `${tabelasAusentes.join(", ")}.`,
    );
  }

  if (colunasAusentes.length > 0) {
    console.error(`\nColunas que faltam (${colunasAusentes.length}):`);
    for (const alvo of colunasAusentes) {
      console.error(
        `  ${alvo.tabela}.${alvo.coluna}` +
          (comandoQueRepoe(alvo) ? "" : "  — sem ADD COLUMN correspondente no disco"),
      );
    }
  }

  if (!aplicar) {
    console.error(
      `\nNada foi alterado. Para repor as colunas acima com o comando que a ` +
        `própria migration traz:\n\n  pnpm --filter @workspace/db run ` +
        `conferir-schema -- --aplicar\n`,
    );
    await pool.end();
    process.exit(1);
  }

  let repostas = 0;
  const semComando: string[] = [];
  for (const alvo of colunasAusentes) {
    const comando = comandoQueRepoe(alvo);
    if (!comando) {
      semComando.push(`${alvo.tabela}.${alvo.coluna}`);
      continue;
    }
    await pool.query(comando);
    console.log(`Reposta: ${alvo.tabela}.${alvo.coluna}`);
    repostas++;
  }

  console.log(`\n${repostas} coluna(s) reposta(s).`);
  if (semComando.length > 0) {
    console.error(
      `\nSem comando no disco, e por isso não tocadas: ${semComando.join(", ")}.` +
        ` Confira à mão de qual migration elas deveriam vir.`,
    );
  }
  if (tabelasAusentes.length > 0) {
    console.error(
      `\nAs tabelas ausentes continuam ausentes: repor tabela não é o que este ` +
        `comando faz.`,
    );
  }

  await pool.end();
  if (semComando.length > 0 || tabelasAusentes.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Falha ao conferir o schema:", err);
  process.exit(1);
});
