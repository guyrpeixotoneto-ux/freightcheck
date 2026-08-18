import { createDb } from "./index";
import {
  comandoQueRepoe,
  compararSchema,
  tabelasDeclaradas,
} from "./conferir-schema";
import { reconvergirSeCabivel } from "./reconvergencia";
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
 * **`--aplicar` é a reconvergência, pela mão de quem opera.** O mesmo reparo da
 * partida de Production (`reconvergencia.ts`): tabela, coluna, índice,
 * constraint e trigger, com DDL levantado verbatim das migrations, atrás das
 * mesmas recusas — pendência é da fila, bridge é do `bridge:up`. Este comando
 * repunha só coluna, e a tela de SCHEMA_DIVERGENTE que o recomenda terminava
 * num beco: foi com `entity_expectation` inteira ausente, em 18/08/2026, que o
 * "as tabelas continuam ausentes" deixou de ser resposta.
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

/** O schema como o banco o descreve, no formato que `compararSchema` espera. */
async function lerReais(
  pool: ReturnType<typeof createDb>["pool"],
): Promise<Map<string, Set<string>>> {
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
  return reais;
}

async function main(): Promise<void> {
  const { db, pool } = createDb(url!);

  const divergencia = compararSchema(tabelasDeclaradas(), await lerReais(pool));
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
    Tabela inteira ausente é outro estado, e sai separado: some junto tudo o
    que morava nela, e quem lê precisa saber que a conversa é maior que coluna.
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
      `\nNada foi alterado. Para repor o que falta — tabela, coluna, índice, ` +
        `constraint e trigger — com o DDL que as próprias migrations trazem:` +
        `\n\n  pnpm --filter @workspace/db run conferir-schema -- --aplicar\n`,
    );
    // Mesmo com a forma quebrada, o conteúdo é conferido e relatado: quem vai
    // consertar precisa da lista inteira de uma vez, e não de uma rodada por
    // classe de defeito.
    await conferirConteudo(db, tabelasAusentes);
    await pool.end();
    process.exit(1);
  }

  const desfecho = await reconvergirSeCabivel(url!);

  if (!desfecho.rodou) {
    /*
      A recusa sai com o comando de quem resolve, porque quem chegou aqui veio
      de uma tela mandando consertar: devolver só o motivo seria trocar um beco
      por outro.
    */
    console.error(`\nNada foi alterado: ${desfecho.motivo}.`);
    if (desfecho.motivo.includes("fila")) {
      console.error(`\n  pnpm --filter @workspace/db run migrate\n`);
    } else if (desfecho.motivo.includes("bridge")) {
      console.error(`\n  pnpm --filter @workspace/db run bridge:up\n`);
    }
    await pool.end();
    process.exit(1);
  }

  const { aplicados, semComando, falhas } = desfecho.relatorio;
  for (const { alvo } of aplicados) console.log(`Reposto: ${alvo}`);
  console.log(`\n${aplicados.length} objeto(s) reposto(s).`);
  if (semComando.length > 0) {
    console.error(
      `\nSem comando levantável nas migrations, e por isso não tocados: ` +
        `${semComando.join(", ")}. Confira à mão de qual migration deveriam vir.`,
    );
  }
  if (falhas.length > 0) {
    console.error(
      `\nO banco recusou: ` +
        falhas
          .map((f) => `${f.alvo}${f.code ? ` (SQLSTATE ${f.code})` : ""}`)
          .join(", ") +
        `.`,
    );
  }

  /*
    Depois de repor, conferir de novo — e continuar não consertando conteúdo.
    Repor `attribute_semantics.definition` faz a linha versionada voltar a
    existir vazia enquanto a projeção continua com o texto: a divergência que
    aparece aqui é consequência direta do que este comando acabou de fazer, e
    quem a lê precisa saber disso na mesma passada.
  */
  const aindaAusentes = compararSchema(tabelasDeclaradas(), await lerReais(pool));
  const integro = await conferirConteudo(db, aindaAusentes.tabelasAusentes);

  await pool.end();
  if (
    semComando.length > 0 ||
    falhas.length > 0 ||
    aindaAusentes.tabelasAusentes.length > 0 ||
    aindaAusentes.colunasAusentes.length > 0 ||
    !integro
  ) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Falha ao conferir o schema:", err);
  process.exit(1);
});
