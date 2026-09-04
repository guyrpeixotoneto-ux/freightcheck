/**
 * O cofre do bridge — as tabelas que descem cheias e voltam cheias.
 *
 * ---------------------------------------------------------------------------
 * O buraco que este módulo fecha
 * ---------------------------------------------------------------------------
 * `bridgeDown` derruba de `public` as tabelas que Production ainda não conhece,
 * e é isso que mantém a proposta do Publishing sem `CREATE TABLE`. Para as
 * tabelas de dado ele nunca precisou de mais nada: a pré-condição de tabela
 * vazia garante que não há o que perder, e um Development com linha dentro
 * trava o bridge — travar é o comportamento certo quando a alternativa é
 * descartar.
 *
 * Só que existe uma família em que "travar" não é saída nenhuma. As duas
 * tabelas dos **módulos universais** guardam a decisão da casa — o que a
 * instalação desligou para todo mundo — e o histórico append-only de quem
 * decidiu o quê. Com a pré-condição de vazia valendo sobre elas, o produto
 * ficava assim:
 *
 * · o primeiro módulo que alguém desligasse travava o `down` para sempre,
 *   porque o histórico **nunca** é apagado pela interface;
 * · a única saída oferecida era esvaziar as duas tabelas à mão, o que destrói
 *   exatamente a decisão que o bridge deveria atravessar sem tocar — e é a
 *   causa raiz de um menu inteiro voltar a aparecer para quem o desligou.
 *
 * A saída não é afrouxar o contrato de estrutura: é **guardar o conteúdo**. As
 * linhas saem de `public` junto com as tabelas e ficam no schema `drizzle` até
 * o `up` devolvê-las.
 *
 * ---------------------------------------------------------------------------
 * Três decisões
 * ---------------------------------------------------------------------------
 * **Mora no schema `drizzle`**, ao lado do marcador de bridge pendente e pela
 * mesma razão que o levou para lá (`bridge-marcador.ts`): `bridgeDown` só mexe
 * em `public`, e o Publishing só introspecta `public`. O cofre não corre risco
 * de ser removido pela própria operação que o criou, e não entra no diff.
 *
 * **Guarda com `SELECT *` e devolve por nome.** A cópia não enumera colunas —
 * o que existir na tabela entra no cofre, inclusive uma coluna que uma
 * migration futura acrescente. A devolução compara as duas listas de colunas e
 * **aborta** se elas não baterem, nomeando a diferença. É o oposto de uma lista
 * escrita à mão que concorda no dia em que é escrita e discorda em silêncio no
 * dia em que a tabela muda.
 *
 * **O `down` nunca descarta um cofre que já existe.** Ele guarda quando há o
 * que guardar — quer dizer, quando a tabela ainda está em `public` — e não faz
 * nada quando ela já saiu. Dois `down` seguidos sem `up` no meio são um bridge
 * pendente só, e o conteúdo que vale é o do primeiro, que é o único que existiu
 * em `public`.
 */

/** O que uma consulta precisa saber devolver para este módulo funcionar. */
type Consulta = (
  sql: string,
  valores?: unknown[],
) => Promise<{ rows: Record<string, unknown>[] }>;

/**
 * As tabelas que descem com o conteúdo guardado.
 *
 * A ordem é a da queda — filha antes de mãe —, e entre estas duas ela é
 * indiferente: nenhuma pendura na outra, e a chave das duas é o endereço do
 * módulo, texto, como nas duas tabelas de permissão.
 */
export const TABELAS_GUARDADAS: readonly string[] = [
  "modulo_universal_evento",
  "modulo_universal",
];

/** O nome do cofre de uma tabela — o mesmo nome, no schema de operação. */
const cofreDe = (tabela: string) => `${tabela}__guardado`;

async function existeEm(
  consultar: Consulta,
  schema: string,
  tabela: string,
): Promise<boolean> {
  const { rows } = await consultar(
    `SELECT to_regclass($1) IS NOT NULL AS existe`,
    [`${schema}.${tabela}`],
  );
  return rows[0]?.["existe"] === true;
}

async function colunasDe(
  consultar: Consulta,
  schema: string,
  tabela: string,
): Promise<string[]> {
  const { rows } = await consultar(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY column_name`,
    [schema, tabela],
  );
  return rows.map((r) => String(r["column_name"]));
}

/**
 * Guarda o conteúdo das tabelas antes de o `down` derrubá-las.
 *
 * Roda **dentro da transação do `down`**, como o marcador e pela mesma razão: um
 * `down` que aborta não deixa cofre, e um `down` que entra não tem como deixar
 * de deixá-lo. Devolve o que guardou, por tabela, para o relatório dizer.
 */
export async function guardarConteudo(
  consultar: Consulta,
): Promise<Array<{ tabela: string; linhas: number }>> {
  const guardado: Array<{ tabela: string; linhas: number }> = [];

  await consultar(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);

  for (const tabela of TABELAS_GUARDADAS) {
    /*
      Sem tabela em `public` não há o que guardar — e, o que importa mais, não
      há como saber que o cofre existente ficou velho. É o caso do segundo
      `down` sem `up` no meio: o cofre do primeiro é o que vale, e mexer nele
      aqui seria trocar o conteúdo real por uma cópia de uma tabela que não
      existe.
    */
    if (!(await existeEm(consultar, "public", tabela))) continue;

    const cofre = cofreDe(tabela);
    await consultar(`DROP TABLE IF EXISTS "drizzle"."${cofre}"`);
    await consultar(
      `CREATE TABLE "drizzle"."${cofre}" AS SELECT * FROM "public"."${tabela}"`,
    );
    const { rows } = await consultar(
      `SELECT count(*)::int AS n FROM "drizzle"."${cofre}"`,
    );
    guardado.push({ tabela, linhas: Number(rows[0]?.["n"] ?? 0) });
  }

  return guardado;
}

/**
 * Devolve o conteúdo às tabelas que o `up` acabou de recriar, e esvazia o cofre.
 *
 * Roda dentro da transação do `up`. Três recusas, e nenhuma delas é silenciosa:
 *
 * · **a tabela não voltou a `public`** — o cofre fica onde está e o `up` aborta.
 *   Perder a decisão da casa porque a estrutura não voltou seria trocar um
 *   problema visível por um invisível;
 * · **as colunas não batem** — aborta nomeando a diferença. Uma migration
 *   mexeu na tabela entre o `down` e o `up`, e adivinhar como encaixar é
 *   exatamente o que este módulo não faz;
 * · **a tabela voltou com linha dentro** — aborta. Não há como somar o que o
 *   cofre tem ao que apareceu ali sem inventar uma regra de precedência que
 *   ninguém escreveu.
 */
export async function devolverConteudo(
  consultar: Consulta,
): Promise<Array<{ tabela: string; linhas: number }>> {
  const devolvido: Array<{ tabela: string; linhas: number }> = [];

  for (const tabela of TABELAS_GUARDADAS) {
    const cofre = cofreDe(tabela);
    if (!(await existeEm(consultar, "drizzle", cofre))) continue;

    if (!(await existeEm(consultar, "public", tabela))) {
      throw new Error(
        `o cofre do bridge tem linhas de "${tabela}" e a tabela não voltou a public. ` +
          `O conteúdo continua guardado em drizzle."${cofre}" — rode a fila ` +
          `(runMigrations) e repita o bridge:up.`,
      );
    }

    const doCofre = await colunasDe(consultar, "drizzle", cofre);
    const daTabela = await colunasDe(consultar, "public", tabela);
    const soNoCofre = doCofre.filter((c) => !daTabela.includes(c));
    const soNaTabela = daTabela.filter((c) => !doCofre.includes(c));
    if (soNoCofre.length > 0 || soNaTabela.length > 0) {
      throw new Error(
        `"${tabela}" mudou de forma entre o down e o up e o cofre não sabe encaixar: ` +
          `${soNoCofre.length > 0 ? `só no cofre: ${soNoCofre.join(", ")}. ` : ""}` +
          `${soNaTabela.length > 0 ? `só na tabela: ${soNaTabela.join(", ")}. ` : ""}` +
          `O conteúdo continua guardado em drizzle."${cofre}".`,
      );
    }

    const { rows: ocupada } = await consultar(
      `SELECT count(*)::int AS n FROM "public"."${tabela}"`,
    );
    if (Number(ocupada[0]?.["n"] ?? 0) !== 0) {
      throw new Error(
        `"${tabela}" voltou de public com ${ocupada[0]?.["n"]} linha(s) e o cofre também tem ` +
          `conteúdo. Somar os dois exigiria uma regra de precedência que ninguém escreveu — ` +
          `o conteúdo do bridge continua guardado em drizzle."${cofre}".`,
      );
    }

    const colunas = doCofre.map((c) => `"${c}"`).join(", ");
    await consultar(
      `INSERT INTO "public"."${tabela}" (${colunas}) SELECT ${colunas} FROM "drizzle"."${cofre}"`,
    );
    const { rows } = await consultar(
      `SELECT count(*)::int AS n FROM "public"."${tabela}"`,
    );
    await consultar(`DROP TABLE "drizzle"."${cofre}"`);
    devolvido.push({ tabela, linhas: Number(rows[0]?.["n"] ?? 0) });
  }

  return devolvido;
}
