import { createDb } from "./index";
import {
  comandoQueRepoe,
  compararSchema,
  tabelasDeclaradas,
} from "./conferir-schema";
import {
  avaliarIntegridadeSemantica,
  relatarIntegridadeSemantica,
} from "./integridade-semantica";

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
 * **Duas perguntas, não uma.** Depois da forma vem o conteúdo: as invariantes
 * de `integridade-semantica.ts` — todo atributo com versão aplicável, e a
 * projeção concordando com a versão em vigor. Um banco pode ter todas as
 * tabelas e todas as colunas e ainda assim somar dinheiro por uma semântica
 * que nenhuma tela mostra. `--aplicar` **não** as toca, e não existe bandeira
 * que as toque: escolher entre duas verdades é decisão de quem conhece o dado.
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

/**
 * A segunda pergunta, feita em toda passada — inclusive quando a forma está em
 * dia, que é justamente o caso em que ninguém suspeitaria.
 *
 * Só depende de as duas tabelas existirem. Faltando qualquer uma, dizer
 * "integridade em dia" seria mentir sobre o que não foi conferido, e é isso que
 * a mensagem evita.
 */
async function conferirConteudo(
  db: ReturnType<typeof createDb>["db"],
  tabelasAusentes: string[],
): Promise<boolean> {
  const faltando = ["attribute", "attribute_semantics"].filter((t) =>
    tabelasAusentes.includes(t),
  );
  if (faltando.length > 0) {
    console.error(
      `\nIntegridade da semântica: não conferida — ${faltando.join(" e ")} não ` +
        `existe(m) neste banco.`,
    );
    return false;
  }

  const laudo = await avaliarIntegridadeSemantica(db);
  const ok = laudo.estado === "OK";
  for (const linha of relatarIntegridadeSemantica(laudo)) {
    (ok ? console.log : console.error)(linha);
  }
  return ok;
}

async function main(): Promise<void> {
  const { db, pool } = createDb(url!);

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
    // A forma estar em dia é metade da resposta, e é a metade que engana: foi
    // com 23 de 23 migrations registradas e nenhuma coluna faltando que a
    // tabela versionada passou o produto inteiro vazia.
    const integro = await conferirConteudo(db, tabelasAusentes);
    await pool.end();
    if (!integro) process.exit(1);
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
    // Mesmo com a forma quebrada, o conteúdo é conferido e relatado: quem vai
    // consertar precisa da lista inteira de uma vez, e não de uma rodada por
    // classe de defeito.
    await conferirConteudo(db, tabelasAusentes);
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

  /*
    Depois de repor coluna, conferir de novo — e continuar não consertando.
    Repor `attribute_semantics.definition` faz a linha versionada voltar a
    existir vazia enquanto a projeção continua com o texto: a divergência que
    aparece aqui é consequência direta do que este comando acabou de fazer, e
    quem a lê precisa saber disso na mesma passada.
  */
  const integro = await conferirConteudo(db, tabelasAusentes);

  await pool.end();
  if (semComando.length > 0 || tabelasAusentes.length > 0 || !integro) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Falha ao conferir o schema:", err);
  process.exit(1);
});
