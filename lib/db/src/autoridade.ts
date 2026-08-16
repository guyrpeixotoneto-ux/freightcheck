import { AsyncLocalStorage } from "node:async_hooks";
import type pg from "pg";

/**
 * A autoridade de escrita — quem pode gravar no canônico, decidido em runtime.
 *
 * ---------------------------------------------------------------------------
 * Por que uma varredura de código não bastava
 * ---------------------------------------------------------------------------
 *
 * `fronteira-de-ingestao.test.ts` procura escritores no código-fonte e recusa
 * os que não estão declarados. É uma boa rede, e ela pegou o que precisava
 * pegar. Mas é textual: reconhece `\`.insert(factTable)\``, `\`INSERT INTO fact\``
 * e as duas formas indiretas que a própria prova de controle revelou — e não
 * segue uma escrita passada por três camadas de indireção, nem uma montada em
 * tempo de execução. Uma rede não é uma prisão, e a regra de duas portas é
 * importante demais para depender de alguém se lembrar dela **ou** de uma
 * expressão regular ser esperta o bastante.
 *
 * Este módulo fecha a diferença. Ele não olha para o código: olha para o
 * **statement**, no ponto por onde todo statement passa — o driver. Uma escrita
 * numa tabela do núcleo canônico só chega ao Postgres se, naquele instante,
 * existir uma autoridade declarada capaz de fazê-la. Não há como contorná-lo
 * por indireção, porque não é o chamador que ele examina: é o SQL.
 *
 * ---------------------------------------------------------------------------
 * As três autoridades, e por que não é uma só
 * ---------------------------------------------------------------------------
 *
 * `INGESTAO` — as duas portas. A importação de vigência cria fato, vigência,
 * entidade e escopo; a exclusão de importação desfaz o que ela fez. É a única
 * autoridade sobre o **núcleo canônico**.
 *
 * `CURADORIA` — o dicionário e a classificação. A distinção é do domínio e não
 * de conveniência: a importação **descobre** que existe uma coluna nova; a
 * curadoria decide **o que ela significa** e onde ela mora na árvore de
 * remuneração. Um fato não tem esse segundo dono — ninguém "decide" um fato
 * depois que ele foi lido —, e é por isso que a curadoria nunca alcança o
 * núcleo.
 *
 * `FIXTURE_DE_TESTE` — os fixtures sintéticos, que montam a camada canônica
 * direto para poder variar uma coisa de cada vez. Ela **não é concedida por
 * ambiente**: é uma propriedade da *conexão*, dada só por `createTestDatabase`
 * ao banco descartável que ele cria. Um processo de produção não tem como
 * obtê-la, porque nada lá chama aquela função — e amarrar a concessão a
 * `NODE_ENV` teria deixado a porta aberta para qualquer processo que exportasse
 * a variável errada.
 *
 * ---------------------------------------------------------------------------
 * O que ele deliberadamente não faz
 * ---------------------------------------------------------------------------
 *
 * **Não bloqueia leitura.** Nenhum `SELECT` passa por decisão nenhuma.
 *
 * **Não bloqueia DDL nem migration.** `runMigrations` e a ponte de deploy abrem
 * o próprio `pg.Pool`, fora de `createDb`, e continuam fora daqui. É correto:
 * uma migration é a autoridade que **muda a forma** do canônico, e submetê-la à
 * autoridade que protege o conteúdo seria inverter a hierarquia. O que as
 * protege é serem versionadas e revisadas, não este módulo.
 *
 * **Não substitui a garantia do banco.** A vigência ativa única, a
 * imutabilidade do RAW e a identidade canônica continuam sendo do Postgres, com
 * índice, trigger e coluna gerada. Este módulo protege *quem escreve*; aqueles
 * protegem *o que fica escrito*. São perguntas diferentes.
 */

export type Autoridade = "INGESTAO" | "CURADORIA" | "FIXTURE_DE_TESTE";

/**
 * O núcleo canônico: o fato e a identidade a que ele pertence.
 *
 * É o conjunto que precisa ser rastreável até a célula do arquivo de origem —
 * `módulo → fato → vigência → importação → arquivo → linha/célula` —, e é por
 * isso que ele não pode nascer fora de uma importação. Uma linha aqui sem
 * `raw_cell_id` atrás dela é um número sem lastro.
 */
export const NUCLEO_CANONICO: readonly string[] = [
  "fact",
  "snapshot",
  "snapshot_scope",
  "snapshot_attribute",
  "snapshot_entity_type",
  "snapshot_merge",
  "entity",
  "entity_identifier",
  "scope",
];

/** O dicionário e a classificação: descobertos pela importação, decididos pela curadoria. */
export const DICIONARIO_CANONICO: readonly string[] = [
  "attribute",
  "attribute_alias",
  "taxonomy_node",
];

const PERMISSOES = new Map<string, ReadonlySet<Autoridade>>([
  ...NUCLEO_CANONICO.map(
    (t) => [t, new Set<Autoridade>(["INGESTAO", "FIXTURE_DE_TESTE"])] as const,
  ),
  ...DICIONARIO_CANONICO.map(
    (t) =>
      [t, new Set<Autoridade>(["INGESTAO", "CURADORIA", "FIXTURE_DE_TESTE"])] as const,
  ),
]);

/** As autoridades que podem escrever numa tabela; vazio = tabela não protegida. */
export function autoridadesDe(tabela: string): ReadonlySet<Autoridade> | undefined {
  return PERMISSOES.get(tabela.toLowerCase());
}

/**
 * A recusa. Nomeada porque ela é uma afirmação sobre a arquitetura, e quem a
 * receber precisa entender que não errou o dado — errou o caminho.
 */
export class EscritaNaoAutorizada extends Error {
  constructor(
    readonly tabela: string,
    readonly autoridade: Autoridade | undefined,
    readonly sql: string,
  ) {
    const permitidas = [...(autoridadesDe(tabela) ?? [])].join(" ou ");
    super(
      `Escrita em "${tabela}" sem autoridade. ` +
        (autoridade
          ? `A autoridade em vigor é ${autoridade}, e esta tabela só aceita ${permitidas}.`
          : `Nenhuma autoridade está em vigor; esta tabela só aceita ${permitidas}.`) +
        ` Dado canônico entra pelas portas de Importações e de Chamados, e por` +
        ` mais lugar nenhum — ver docs/AUDITORIA-COMPLEMENTO-BASELINE.md, Parte A.`,
    );
    this.name = "EscritaNaoAutorizada";
  }
}

/**
 * A recusa dentro do que a embrulhou.
 *
 * O drizzle não deixa um erro subir cru: ele o envolve num `DrizzleQueryError`
 * cuja `message` é a consulta inteira, e põe o original em `cause`. Quem
 * escrevesse `err instanceof EscritaNaoAutorizada` no `catch` nunca a
 * reconheceria — é o mesmo defeito que `erroDoPostgres` já resolve neste
 * pacote para o SQLSTATE, e pela mesma razão ele é resolvido aqui.
 *
 * A cadeia é percorrida com limite: `cause` é campo livre, e um ciclo nele não
 * pode virar laço infinito dentro de um `catch`.
 */
export function escritaNaoAutorizada(err: unknown): EscritaNaoAutorizada | undefined {
  let atual: unknown = err;
  for (let nivel = 0; nivel < 5; nivel++) {
    if (atual instanceof EscritaNaoAutorizada) return atual;
    if (typeof atual !== "object" || atual === null) return undefined;
    atual = (atual as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * O contexto corrente.
 *
 * `AsyncLocalStorage` e não uma variável de módulo: a promoção é uma transação
 * com dezenas de `await` dentro, e há mais de uma requisição em voo ao mesmo
 * tempo. Uma variável global daria a autoridade da importação a quem estivesse
 * passando por perto — que é precisamente a falha que este módulo existe para
 * não ter.
 */
const contexto = new AsyncLocalStorage<Autoridade>();

/** A autoridade em vigor neste ponto da execução, se houver. */
export function autoridadeAtual(): Autoridade | undefined {
  return contexto.getStore();
}

/**
 * Executar sob uma autoridade.
 *
 * O escopo é o da função: tudo o que ela `await`ar herda a autoridade, e nada
 * fora dela a tem. Declarar autoridade é, portanto, um ato local e visível no
 * ponto em que a operação começa — e não uma permissão que fica ligada.
 */
export function comoAutoridade<T>(
  autoridade: Autoridade,
  operacao: () => Promise<T>,
): Promise<T> {
  return contexto.run(autoridade, operacao);
}

// ---------------------------------------------------------------------------
// A leitura do statement
// ---------------------------------------------------------------------------

/**
 * O statement é de escrita?
 *
 * A pergunta vem antes de procurar tabela, e é ela que evita o falso positivo
 * clássico: `SELECT … FOR UPDATE` contém a palavra `UPDATE` e não escreve nada.
 * Um statement só pode escrever se **começa** por `INSERT`, `UPDATE`, `DELETE`
 * ou `WITH` — este último porque uma CTE pode conter escrita.
 */
const COMECA_ESCREVENDO =
  /^\s*(?:(?:--[^\n]*\n)|(?:\/\*[\s\S]*?\*\/)|\s)*(with|insert|update|delete)\b/i;

/** As tabelas que um statement de escrita toca. */
const ALVOS =
  /\b(?:insert\s+into|delete\s+from|update)\s+(?:only\s+)?"?([a-z_][a-z0-9_$]*)"?/gi;

/**
 * As tabelas protegidas que este SQL escreve.
 *
 * Devolve vazio para leitura, para DDL e para escrita em tabela não protegida —
 * `import_run`, `raw_cell`, `change`, `ticket`, `coverage_expectation` e as
 * demais seguem livres, porque nenhuma delas é o grão nem a identidade dele.
 */
export function tabelasProtegidasEscritas(sql: string): string[] {
  if (!COMECA_ESCREVENDO.test(sql)) return [];
  const encontradas = new Set<string>();
  ALVOS.lastIndex = 0;
  for (let m = ALVOS.exec(sql); m !== null; m = ALVOS.exec(sql)) {
    const tabela = m[1].toLowerCase();
    if (PERMISSOES.has(tabela)) encontradas.add(tabela);
  }
  return [...encontradas];
}

/**
 * Conferir um statement contra a autoridade em vigor. Lança, ou não faz nada.
 *
 * `autoridadeDaConexao` é a concessão presa à conexão — o banco descartável de
 * teste. Ela entra como piso: o que a chamada declarar por cima continua
 * valendo.
 */
export function conferirEscrita(
  sql: string,
  autoridadeDaConexao?: Autoridade,
): void {
  const tabelas = tabelasProtegidasEscritas(sql);
  if (tabelas.length === 0) return;

  const emVigor = autoridadeAtual() ?? autoridadeDaConexao;
  for (const tabela of tabelas) {
    const permitidas = autoridadesDe(tabela)!;
    if (emVigor === undefined || !permitidas.has(emVigor)) {
      throw new EscritaNaoAutorizada(tabela, emVigor, sql);
    }
  }
}

// ---------------------------------------------------------------------------
// O ponto de estrangulamento: o driver
// ---------------------------------------------------------------------------

/** O texto de um `query()`, nas três formas que o `pg` aceita. */
function textoDoQuery(argumento: unknown): string | null {
  if (typeof argumento === "string") return argumento;
  if (typeof argumento === "object" && argumento !== null) {
    const texto = (argumento as { text?: unknown }).text;
    if (typeof texto === "string") return texto;
  }
  return null;
}

type ComQuery = { query: (...args: unknown[]) => unknown };

/**
 * O mesmo objeto, com `query` conferido.
 *
 * Um Proxy e não uma subclasse: o `pg` devolve instâncias que não são nossas —
 * o `PoolClient` sai de dentro do pool —, e envolvê-las é a única forma de
 * cobrir também a transação, que é por onde a promoção escreve **tudo**.
 * Guardar só o `Pool` teria deixado passar exatamente o caminho que mais
 * importa.
 *
 * Os demais membros saem ligados ao alvo (`bind`), porque um método de pool
 * obtido por Proxy e chamado com `this` no Proxy escreve no lugar errado — é o
 * defeito que `encerrarPoolDoProcesso` já documenta neste pacote.
 */
function protegerObjetoComQuery<T extends object>(
  alvo: T,
  autoridadeDaConexao: Autoridade | undefined,
  aoConectar?: (cliente: object) => object,
): T {
  return new Proxy(alvo, {
    get(destino, prop, receptor) {
      if (prop === "query") {
        const original = (destino as unknown as ComQuery).query;
        return (...args: unknown[]) => {
          const texto = textoDoQuery(args[0]);
          if (texto !== null) conferirEscrita(texto, autoridadeDaConexao);
          return original.apply(destino, args);
        };
      }
      if (prop === "connect" && aoConectar) {
        const original = Reflect.get(destino, prop, destino) as (
          ...args: unknown[]
        ) => unknown;
        return (...args: unknown[]) => {
          const resultado = original.apply(destino, args);
          // `connect()` sem callback devolve Promise; com callback, não.
          return resultado instanceof Promise
            ? resultado.then((cliente) => aoConectar(cliente as object))
            : resultado;
        };
      }
      const valor = Reflect.get(destino, prop, receptor);
      return typeof valor === "function" ? valor.bind(destino) : valor;
    },
  });
}

/**
 * O pool, protegido — e com ele toda conexão que sair dele.
 *
 * É o único ponto por onde um statement chega ao Postgres neste processo, o que
 * torna a proteção independente de como ele foi escrito: drizzle, SQL cru,
 * helper genérico ou string montada em tempo de execução chegam todos aqui.
 */
export function protegerPool(
  pool: pg.Pool,
  autoridadeDaConexao?: Autoridade,
): pg.Pool {
  return protegerObjetoComQuery(pool, autoridadeDaConexao, (cliente) =>
    protegerObjetoComQuery(cliente, autoridadeDaConexao),
  );
}
