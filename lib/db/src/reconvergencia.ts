import pg from "pg";
import {
  objetosCriadosPor,
  readMigrations,
  type MigrationFile,
} from "./migrate";
import { bridgePendente } from "./bridge-marcador";
import {
  comandoQueRepoe,
  compararSchema,
  semComentarioDeAbertura,
  tabelasDeclaradas,
} from "./conferir-schema";

/**
 * Reconvergir o schema de um banco cujo registro está completo — na partida,
 * pela própria fila.
 *
 * ---------------------------------------------------------------------------
 * O buraco que isto fecha
 * ---------------------------------------------------------------------------
 * O Publishing do Replit compara Development com Production no `Provision` e
 * aplica o diff **antes** de o servidor novo existir. A política deste
 * repositório deixa Development atrás da fila de propósito (ver
 * `scripts/post-merge.sh`) — e todo deploy que dá certo termina com Production
 * à frente, porque `runMigrations()` roda na partida. No deploy seguinte, o
 * mesmo Provision encontra em Production o que Development não tem e propõe
 * **removê-lo de lá**: DDL destrutivo, fora da fila, documentado em
 * `bridge.ts` com a proposta real de 17/08/2026.
 *
 * Depois disso o banco fica no estado que nenhuma autoridade reconhece: o
 * registro diz que as 35 migrations rodaram — e rodaram —, mas objetos que
 * elas criaram não estão mais lá. `runMigrations()` não repõe nada, porque
 * decide pelo carimbo e os carimbos estão todos lá. As migrations de
 * reconciliação (`0024`, `0034`) também não: já constam aplicadas. Era o
 * ponto sem saída — a tela caía com 42703, o `/healthz` contava migrations e
 * respondia SAUDAVEL, e a única correção era humana.
 *
 * ---------------------------------------------------------------------------
 * O que isto faz — e o que se recusa a fazer
 * ---------------------------------------------------------------------------
 * Compara o schema real com o que o build declara (a mesma conferência do
 * `conferir-schema`) e repõe o que falta com DDL **levantado verbatim das
 * migrations** — nunca sintetizado, nunca escrito aqui. É a fila agindo, só
 * que na direção que ela estruturalmente não alcança: objetos de migrations
 * já registradas.
 *
 *   - tabela ausente   → o `CREATE TABLE` da migration que a criou;
 *   - coluna ausente   → o `ADD COLUMN` da última migration que a definiu
 *                        (`comandoQueRepoe`, com tipo, default e GENERATED
 *                        exatamente como a fila os escreve);
 *   - índice ausente   → o `CREATE [UNIQUE] INDEX IF NOT EXISTS` da fila;
 *   - constraint ausente → o `ADD CONSTRAINT` da fila, quando ele é um
 *                        comando inteiro.
 *
 * O que mora em `DO $$` não é levantado — a mesma recusa, pelo mesmo motivo,
 * de `comandoQueRepoe`: rodar um bloco fora do seu contexto faz mais do que
 * repor o objeto. A única exceção é estreita e nomeada: o bloco **reentrante
 * de trigger** que a própria fila escreve (`IF NOT EXISTS (pg_trigger…) THEN
 * CREATE TRIGGER … END IF` e nada além disso). Ele é, por construção, o
 * comando idempotente de reposição — um `DROP TABLE … CASCADE` do Provision
 * leva os triggers da tabela junto, e o `CREATE TABLE` reposto não os traz.
 * O que não se consegue repor sai em `semComando`, alto, e a conferência do
 * `/healthz` continua vermelha sobre ele: convergência que não se pode
 * garantir não vira verde.
 *
 * **Dado nenhum é tocado.** Só DDL aditivo. O conteúdo que o Provision
 * destruiu junto com uma coluna não volta por aqui nem por lugar nenhum — a
 * estrutura volta, o dado derivado é recomputável pelos caminhos do produto, e
 * o dado de decisão humana perdido é exatamente o motivo de a prevenção
 * (`publicar:conferir` antes de todo Publish) continuar valendo.
 *
 * ---------------------------------------------------------------------------
 * Quando rodar
 * ---------------------------------------------------------------------------
 * Dois chamadores, a mesma porta de entrada (`reconvergirSeCabivel`): a partida
 * de Production, depois de `runMigrations()`, sob a mesma política que decide
 * migrar (`deveMigrarNaPartida`); e o operador, por
 * `conferir-schema -- --aplicar`, que é o que resolve a tela de
 * SCHEMA_DIVERGENTE num ambiente onde a partida não reconverge — Development,
 * ou um Production que ainda roda um build sem este módulo. Não roda com
 * migrations pendentes: pendência explica ausência, e é a fila quem resolve.
 * O lock serializa instâncias de autoscale que sobem juntas, como no migrate.
 */

const RECONVERGENCIA_LOCK = 8_675_310;

export interface RelatorioDeReconvergencia {
  /** O que foi reposto, pelo comando que repôs. */
  aplicados: { alvo: string; comando: string }[];
  /** O que falta e não tem comando levantável — sai alto, nunca silencioso. */
  semComando: string[];
  /** Comandos que o banco recusou, com o SQLSTATE. Também nunca silencioso. */
  falhas: { alvo: string; code?: string }[];
}

export function reconvergiuLimpo(r: RelatorioDeReconvergencia): boolean {
  return r.semComando.length === 0 && r.falhas.length === 0;
}

/** O `CREATE TABLE` da migration que criou esta tabela — verbatim. */
export function comandoQueCriaTabela(
  tabela: string,
  migrations: MigrationFile[] = readMigrations(),
): string | undefined {
  const padrao = new RegExp(
    `^create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?"?${tabela}"?\\s*\\(`,
    "i",
  );
  for (let i = migrations.length - 1; i >= 0; i--) {
    for (const bruto of migrations[i]!.statements) {
      const comando = semComentarioDeAbertura(bruto);
      if (padrao.test(comando)) return comando.replace(/;\s*$/, "");
    }
  }
  return undefined;
}

const CREATE_INDEX =
  /^create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?\s+on\s+(?:only\s+)?"?([a-z_][a-z0-9_]*)"?/i;

const DROP_INDEX = /^drop\s+index\s+(?:if\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/i;

const ADD_CONSTRAINT =
  /^alter\s+table\s+(?:only\s+)?"?([a-z_][a-z0-9_]*)"?\s+add\s+constraint\s+"?([a-z_][a-z0-9_]*)"?/i;

const DROP_CONSTRAINT =
  /^alter\s+table\s+(?:only\s+)?"?([a-z_][a-z0-9_]*)"?\s+drop\s+constraint\s+(?:if\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/i;

/**
 * O que a fila deixa de pé ao final — não o que ela criou em algum momento.
 *
 * A diferença é o par `snapshot_business_key_*`: criados cedo, removidos pela
 * `0016` quando a identidade canônica os substituiu. Um levantador que só
 * lesse os `CREATE` os "reporia" num banco íntegro — reimpondo uma unicidade
 * que a fila aboliu de propósito, que é pior do que não repor nada. Por isso a
 * leitura é sequencial: um `DROP` posterior apaga o `CREATE` anterior, e o
 * mapa final é o estado que a fila declara.
 */
export function indicesDaFila(
  migrations: MigrationFile[] = readMigrations(),
): Map<string, { tabela: string; comando: string }> {
  const indices = new Map<string, { tabela: string; comando: string }>();
  for (const m of migrations) {
    for (const bruto of m.statements) {
      const comando = semComentarioDeAbertura(bruto);
      const criado = CREATE_INDEX.exec(comando);
      if (criado) {
        indices.set(criado[1]!, {
          tabela: criado[2]!,
          comando: comando.replace(/;\s*$/, ""),
        });
        continue;
      }
      const removido = DROP_INDEX.exec(comando);
      if (removido) indices.delete(removido[1]!);
    }
  }
  return indices;
}

/**
 * O bloco reentrante de constraint — a outra forma que a fila usa desde a
 * `0028`: `IF NOT EXISTS (pg_constraint…) THEN ALTER TABLE … ADD CONSTRAINT`.
 * Mesmo contrato do bloco de trigger: só casa a forma exata.
 */
const CONSTRAINT_REENTRANTE =
  /^do\s+\$[a-z_]*\$\s*begin\s+if\s+not\s+exists\s*\(\s*select\s+1\s+from\s+pg_constraint[\s\S]*?conname\s*=\s*'([a-z_][a-z0-9_]*)'[\s\S]*?\balter\s+table\s+"?([a-z_][a-z0-9_]*)"?\s+add\s+constraint[\s\S]*?end\s+if;\s*end\s+\$[a-z_]*\$;?$/i;

export interface ConstraintDaFila {
  tabela: string;
  comando: string;
  /**
   * A fila removeu e recriou esta constraint — a definição mudou no caminho.
   *
   * É o caso `coverage_expectation_origin_ck`: nasce no `CREATE TABLE` da
   * `0021` com uma lista e a `0032` a troca por outra. Um banco cuja tabela a
   * reconvergência acabou de repor volta com a definição **velha**, e a
   * conferência por nome não enxerga a diferença — por isso as substituídas
   * são reaplicadas quando a tabela delas foi tocada pelo reparo.
   */
  substituida: boolean;
}

/** Toda constraint que a fila deixa de pé, pelo mesmo critério sequencial. */
export function constraintsDaFila(
  migrations: MigrationFile[] = readMigrations(),
): Map<string, ConstraintDaFila> {
  const constraints = new Map<string, ConstraintDaFila>();
  const jaRemovidas = new Set<string>();
  for (const m of migrations) {
    for (const bruto of m.statements) {
      const comando = semComentarioDeAbertura(bruto);
      let adicionada: { nome: string; tabela: string } | null = null;
      const inteira = ADD_CONSTRAINT.exec(comando);
      if (inteira) {
        adicionada = { tabela: inteira[1]!, nome: inteira[2]! };
      } else {
        const reentrante = CONSTRAINT_REENTRANTE.exec(comando);
        if (reentrante)
          adicionada = { nome: reentrante[1]!, tabela: reentrante[2]! };
      }
      if (adicionada) {
        constraints.set(adicionada.nome, {
          tabela: adicionada.tabela,
          comando: comando.replace(/;\s*$/, ""),
          substituida: jaRemovidas.has(adicionada.nome),
        });
        continue;
      }
      const removida = DROP_CONSTRAINT.exec(comando);
      if (removida) {
        constraints.delete(removida[2]!);
        jaRemovidas.add(removida[2]!);
      }
    }
  }
  return constraints;
}

/**
 * Os nomes de constraint em que estas migrations mexem — criam, removem ou
 * reescrevem.
 *
 * `constraintsDaFila` responde o que **fica de pé no fim**, e é a pergunta da
 * reconvergência. Esta responde outra: *quais regras este pedaço da fila
 * mudaria se rodasse?* — e a diferença é o que separa "o banco recusou porque
 * o valor está errado" de "o banco recusou porque aplica a regra de antes".
 *
 * Quem pergunta é a classificação de erro do servidor (ver `faltaSchema` e
 * `regraDeMigrationPendente`, em `artifacts/api-server`), com as migrations
 * **pendentes** neste banco: uma `23514` sobre uma constraint que uma delas
 * reescreve não é defeito do pedido, é a fila que ainda não chegou aqui.
 *
 * As três formas reconhecidas são as mesmas de `constraintsDaFila`, e de
 * propósito: duas leituras do mesmo SQL que divergissem na forma que
 * reconhecem produziriam duas respostas sobre a mesma migration.
 */
export function constraintsTocadasPor(migrations: MigrationFile[]): Set<string> {
  const nomes = new Set<string>();
  for (const m of migrations) {
    for (const bruto of m.statements) {
      const comando = semComentarioDeAbertura(bruto);
      const inteira = ADD_CONSTRAINT.exec(comando);
      if (inteira) {
        nomes.add(inteira[2]!);
        continue;
      }
      const reentrante = CONSTRAINT_REENTRANTE.exec(comando);
      if (reentrante) {
        nomes.add(reentrante[1]!);
        continue;
      }
      const removida = DROP_CONSTRAINT.exec(comando);
      if (removida) nomes.add(removida[2]!);
    }
  }
  return nomes;
}

/**
 * O bloco reentrante de trigger, como a fila o escreve desde a `0001`.
 *
 * Reconhece só a forma exata — um `DO` cuja substância é a guarda de
 * `pg_trigger` seguida do `CREATE TRIGGER` — e extrai o nome e a tabela para a
 * conferência de existência. Qualquer `DO` que faça mais do que isso não casa,
 * e é assim que a exceção não vira porta.
 */
const TRIGGER_REENTRANTE =
  /^do\s+\$[a-z_]*\$\s*begin\s+if\s+not\s+exists\s*\(\s*select\s+1\s+from\s+pg_trigger[\s\S]*?\bcreate\s+trigger\s+"?([a-z_][a-z0-9_]*)"?[\s\S]*?\bon\s+"?([a-z_][a-z0-9_]*)"?[\s\S]*?end\s+if;\s*end\s+\$[a-z_]*\$;?$/i;

/** Todo trigger que a fila cria pelo bloco reentrante dela. */
export function triggersDaFila(
  migrations: MigrationFile[] = readMigrations(),
): Map<string, { tabela: string; comando: string }> {
  const triggers = new Map<string, { tabela: string; comando: string }>();
  for (const m of migrations) {
    for (const bruto of m.statements) {
      const comando = semComentarioDeAbertura(bruto);
      const achado = TRIGGER_REENTRANTE.exec(comando);
      if (achado) {
        triggers.set(achado[1]!, { tabela: achado[2]!, comando });
      }
    }
  }
  return triggers;
}

const SET_NOT_NULL =
  /^alter\s+table\s+(?:only\s+)?"?([a-z_][a-z0-9_]*)"?\s+alter\s+column\s+"?([a-z_][a-z0-9_]*)"?\s+set\s+not\s+null/i;

/**
 * As colunas que a fila torna obrigatórias **depois** de criar.
 *
 * `ADD COLUMN` nulável, backfill, `SET NOT NULL` é o único jeito de acrescentar
 * uma coluna obrigatória a uma tabela com dado dentro, e a fila usa esse
 * caminho desde a `0059`. Quem repõe pelo `ADD COLUMN` sozinho — que é o que
 * este módulo faz — devolve a coluna **nulável**, e um banco reconvergido
 * ficava com a estrutura quase certa: a coluna de volta, a obrigatoriedade
 * não. "Quase" aqui é o bastante para o `estruturaDe` acusar diferença, e é o
 * bastante para o Publishing seguinte propor a mudança de novo.
 *
 * O comando é levantado verbatim da migration, como todo o resto deste módulo.
 */
export function naoNulosDaFila(
  migrations: MigrationFile[] = readMigrations(),
): Map<string, string> {
  const obrigatorias = new Map<string, string>();
  for (const m of migrations) {
    for (const bruto of m.statements) {
      const comando = semComentarioDeAbertura(bruto);
      const achado = SET_NOT_NULL.exec(comando);
      if (achado) {
        obrigatorias.set(
          `${achado[1]}.${achado[2]}`,
          comando.replace(/;\s*$/, ""),
        );
      }
    }
  }
  return obrigatorias;
}

/**
 * O preenchimento declarado de uma coluna **derivada** que voltou vazia.
 *
 * A regra deste módulo é estrutura, e ela continua valendo: conteúdo que o
 * Provision destruiu não volta, porque decisão humana não é recuperável por
 * ninguém. Uma coluna derivada é o caso em que a regra não se aplica — o valor
 * dela não foi escrito por gente, é uma leitura de dado que continua no banco,
 * e é por isso que a própria fila sabe recalculá-la.
 *
 * A lista é **nominal**, e é o ponto: cada entrada é alguém dizendo, por
 * escrito, que aquele comando reconstrói a coluna a partir do que sobrou, e
 * que rodá-lo de novo num banco íntegro não faz nada. Uma varredura que
 * decidisse isso sozinha acabaria rodando o `DELETE FROM "justificativa"` da
 * `0059` — que é a resposta certa para uma migration de mudança de grão e a
 * errada para um reparo, porque apagaria a frase que alguém escreveu.
 *
 * Sem entrada aqui, uma coluna obrigatória que volte vazia numa tabela com
 * linhas simplesmente falha no `SET NOT NULL` e aparece em `falhas`. É o
 * desfecho certo: a coluna está de volta, a garantia não, e quem opera fica
 * sabendo em vez de descobrir depois.
 */
const PREENCHIMENTOS: { coluna: string; migration: string; marcas: RegExp[] }[] = [
  {
    /*
      A origem do fato, da `0061`: a materialização da cadeia
      `raw_cell → raw_row → raw_sheet → import_run`, que continua inteira no
      banco. O `UPDATE` é o da `0063` — a reconciliação —, com o gatilho de
      imutabilidade saindo de cena e voltando em torno dele, exatamente como lá:
      o que se escreve é uma coluna derivada, e nenhum valor de fato é tocado.
      `WHERE origin_import_run_id IS NULL` faz dele um não-evento onde a coluna
      já está preenchida.
    */
    coluna: "fact.origin_import_run_id",
    migration: "0063_reconciliar_progresso_e_origem",
    marcas: [
      /DISABLE TRIGGER "fact_immutable"/,
      /UPDATE "fact" f/,
      /ENABLE TRIGGER "fact_immutable"/,
    ],
  },
];

/** Os comandos de um preenchimento, levantados da migration que o declara. */
function comandosDoPreenchimento(
  coluna: string,
  migrations: MigrationFile[],
): { alvo: string; comando: string }[] {
  const declarado = PREENCHIMENTOS.find((p) => p.coluna === coluna);
  if (!declarado) return [];
  const m = migrations.find((x) => x.tag === declarado.migration);
  if (!m) return [];
  const passos: { alvo: string; comando: string }[] = [];
  for (const marca of declarado.marcas) {
    const achados = m.statements
      .map(semComentarioDeAbertura)
      .filter((s) => marca.test(s));
    // Casar mais de um — ou nenhum — significa que a migration mudou de forma
    // debaixo desta lista. Repor pela metade seria pior que não repor.
    if (achados.length !== 1) return [];
    passos.push({
      alvo: `preenchimento de ${coluna}`,
      comando: achados[0]!.replace(/;\s*$/, ""),
    });
  }
  return passos;
}

const CREATE_VIEW =
  /^create\s+(?:or\s+replace\s+)?view\s+"?([a-z_][a-z0-9_]*)"?\s+as\b/i;

const DROP_VIEW = /^drop\s+view\s+(?:if\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/i;

/**
 * As views que a fila deixa de pé ao final, na ordem em que ela as cria.
 *
 * Views não estavam neste módulo, e a ausência tinha explicação: as três da
 * `0015` são de diagnóstico, e um banco sem elas continua servindo o produto.
 * A `0061` mudou isso — `fato_visivel` é por onde passa **toda** leitura de
 * fato, em setenta e tantas consultas de treze pacotes. Um Provision
 * destrutivo derruba as três em cascata junto com a coluna que elas leem, e um
 * banco com o schema completo e sem elas é um banco de pé com o produto morto.
 *
 * A leitura é sequencial e o último `CREATE` reposiciona a view no fim, como
 * em {@link indicesDaFila}: um `DROP` posterior a apaga, e a ordem final é a
 * ordem em que a fila as criou — que é, por construção, uma ordem em que cada
 * uma encontra de pé aquilo que lê.
 */
export function viewsDaFila(
  migrations: MigrationFile[] = readMigrations(),
): Map<string, string> {
  const views = new Map<string, string>();
  for (const m of migrations) {
    for (const bruto of m.statements) {
      const comando = semComentarioDeAbertura(bruto);
      const criada = CREATE_VIEW.exec(comando);
      if (criada) {
        // Recriada mais tarde vai para o fim: quem depende dela foi escrito
        // depois, e repor na posição antiga inverteria a dependência.
        views.delete(criada[1]!);
        views.set(criada[1]!, comando.replace(/;\s*$/, ""));
        continue;
      }
      const removida = DROP_VIEW.exec(comando);
      // `DROP VIEW` seguido de `CREATE VIEW` no mesmo par é o jeito de a fila
      // redefinir uma view; só apaga do mapa o `DROP` que não tem `CREATE`
      // depois — e isso é o que a ordem sequencial resolve sozinha.
      if (removida) views.delete(removida[1]!);
    }
  }
  return views;
}

type Executor = Pick<pg.Pool, "query">;

async function colunasReais(c: Executor): Promise<Map<string, Set<string>>> {
  const { rows } = await c.query<{ table_name: string; column_name: string }>(
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

async function nomesDe(c: Executor, consulta: string): Promise<Set<string>> {
  const { rows } = await c.query<{ nome: string }>(consulta);
  return new Set(rows.map((r) => r.nome));
}

function codigoDe(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? String((err as { code: unknown }).code)
    : undefined;
}

/**
 * O que estas migrations ainda vão criar — a ausência que **não** é estrago.
 *
 * A comparação de schema é contra o `schema.ts`, que descreve o fim da fila.
 * Num banco em dia isso basta: tudo o que ele declara devia estar lá. Num
 * banco com pendência, não: a tabela que a próxima migration cria falta por
 * uma razão legítima, e repô-la aqui seria a reconvergência fazendo o trabalho
 * da fila — com o DDL final, sem os passos de dado que a migration leva junto.
 *
 * Por isso o reparo pergunta primeiro de quem é a ausência. O que as pendentes
 * criam é silêncio, não `semComando`: `semComando` significa "falta e não sei
 * repor", e aqui não falta — ainda não chegou a hora.
 */
function objetosDe(migrations: MigrationFile[]): {
  tabelas: Set<string>;
  colunas: Set<string>;
} {
  const tabelas = new Set<string>();
  const colunas = new Set<string>();
  for (const m of migrations) {
    const criados = objetosCriadosPor(m.statements);
    for (const tabela of criados.tabelas) tabelas.add(tabela);
    for (const { tabela, coluna } of criados.colunas) {
      colunas.add(`${tabela}.${coluna}`);
    }
  }
  return { tabelas, colunas };
}

/**
 * A reconvergência em si. Idempotente: num banco íntegro não aplica nada, e a
 * segunda passada num banco reparado devolve o relatório vazio.
 */
export async function reconvergirSchema(
  connectionString: string,
  migrations: MigrationFile[] = readMigrations(),
  /**
   * As migrations que ainda não rodaram neste banco.
   *
   * Vazio no chamador de sempre — a partida depois da fila, onde nada está
   * pendente por definição. Preenchido pelo reparo que destrava a fila, onde
   * há pendência e ela precisa ser distinguida do estrago.
   */
  pendentes: MigrationFile[] = [],
): Promise<RelatorioDeReconvergencia> {
  const daFilaQueFalta = objetosDe(pendentes);
  const pool = new pg.Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  const relatorio: RelatorioDeReconvergencia = {
    aplicados: [],
    semComando: [],
    falhas: [],
  };

  const aplicar = async (alvo: string, comando: string): Promise<void> => {
    try {
      await client.query(comando);
      relatorio.aplicados.push({ alvo, comando });
    } catch (err) {
      relatorio.falhas.push({
        alvo,
        ...(codigoDe(err) ? { code: codigoDe(err)! } : {}),
      });
    }
  };

  try {
    await client.query("SELECT pg_advisory_lock($1)", [RECONVERGENCIA_LOCK]);

    const declaradas = tabelasDeclaradas();

    // 1. Tabelas inteiras primeiro: as colunas acrescentadas depois da criação
    //    entram na passada seguinte, e os índices e FKs delas nas de baixo.
    const antes = compararSchema(declaradas, await colunasReais(client));
    for (const tabela of antes.tabelasAusentes) {
      if (daFilaQueFalta.tabelas.has(tabela)) continue;
      const comando = comandoQueCriaTabela(tabela, migrations);
      if (!comando) {
        relatorio.semComando.push(`${tabela} (tabela inteira)`);
        continue;
      }
      await aplicar(`tabela ${tabela}`, comando);
    }

    // 2. Colunas, contra o estado que a passada 1 deixou.
    const depois = compararSchema(declaradas, await colunasReais(client));
    for (const coluna of depois.colunasAusentes) {
      if (daFilaQueFalta.tabelas.has(coluna.tabela)) continue;
      if (daFilaQueFalta.colunas.has(`${coluna.tabela}.${coluna.coluna}`)) {
        continue;
      }
      const comando = comandoQueRepoe(coluna, migrations);
      if (!comando) {
        relatorio.semComando.push(`${coluna.tabela}.${coluna.coluna}`);
        continue;
      }
      await aplicar(`coluna ${coluna.tabela}.${coluna.coluna}`, comando);
    }

    /*
      2b. A obrigatoriedade das colunas que a passada 2 repôs.

      `comandoQueRepoe` levanta o `ADD COLUMN` da migration, e desde a `0059`
      isso não é a coluna inteira: uma coluna obrigatória acrescentada a tabela
      com dado nasce nulável e só vira `NOT NULL` alguns comandos depois, com
      um backfill no meio. Repor só o primeiro deixa a coluna de volta e a
      garantia fora, e o `SET NOT NULL` da própria fila é o que fecha isso.

      Só nas colunas que este reparo acabou de repor: uma coluna que já estava
      lá não é assunto da reconvergência, e reafirmar obrigatoriedade sobre
      dado que ninguém tocou seria mexer onde não houve estrago. Quando a
      coluna volta vazia numa tabela com linhas, o `SET NOT NULL` é recusado
      pelo banco e entra em `falhas` — alto, como todo resto que este módulo
      não consegue: é a mesma honestidade do conteúdo que não volta.
    */
    const obrigatorias = naoNulosDaFila(migrations);
    const repostasAgora = relatorio.aplicados
      .map((a) => /^coluna (\S+)$/.exec(a.alvo)?.[1])
      .filter((c): c is string => c !== undefined);
    for (const chave of repostasAgora) {
      const comando = obrigatorias.get(chave);
      if (!comando) continue;
      // O preenchimento declarado, quando existe, vem antes: `SET NOT NULL`
      // sobre coluna derivada que voltou vazia é recusado pelo banco, e a
      // coluna existe justamente porque a cadeia que a produz continua lá.
      for (const passo of comandosDoPreenchimento(chave, migrations)) {
        await aplicar(passo.alvo, passo.comando);
      }
      await aplicar(`obrigatoriedade de ${chave}`, comando);
    }

    /*
      3. Índices. O `DROP COLUMN` do Provision leva junto, em cascata, todo
      índice que a citava — repor a coluna não os traz de volta, e um índice
      único ausente não é lentidão: é o `ON CONFLICT` da importação morrendo
      com 42P10 e dupla de vigência deixando de ser recusada. Só entram os que
      a fila cria por comando inteiro, só os que faltam, e só em tabela que
      existe.
    */
    const indicesReais = await nomesDe(
      client,
      `select indexname as nome from pg_indexes where schemaname = 'public'`,
    );
    const tabelasReais = new Set((await colunasReais(client)).keys());
    for (const [nome, { tabela, comando }] of indicesDaFila(migrations)) {
      if (indicesReais.has(nome) || !tabelasReais.has(tabela)) continue;
      await aplicar(`índice ${nome}`, comando);
    }

    /*
      4. Constraints. A existência é conferida pelo nome — e o nome mente num
      caso: a constraint que a fila **substituiu** (drop + add com definição
      nova) volta com a definição velha quando o `CREATE TABLE` reposto é o da
      migration original. Por isso as substituídas são reaplicadas — só nas
      tabelas que este reparo tocou, para que num boot íntegro nada se mexa.
    */
    const tabelasTocadas = new Set(
      relatorio.aplicados
        .map(
          (a) =>
            /^tabela (\S+)$/.exec(a.alvo)?.[1] ??
            /^coluna (\S+)\./.exec(a.alvo)?.[1],
        )
        .filter((t): t is string => t !== undefined),
    );
    const constraintsReais = await nomesDe(
      client,
      `select conname as nome from pg_constraint
        where connamespace = 'public'::regnamespace`,
    );
    for (const [nome, { tabela, comando, substituida }] of constraintsDaFila(
      migrations,
    )) {
      if (!tabelasReais.has(tabela)) continue;
      if (!constraintsReais.has(nome)) {
        await aplicar(`constraint ${nome}`, comando);
        continue;
      }
      if (substituida && tabelasTocadas.has(tabela)) {
        await aplicar(
          `constraint ${nome} (definição da fila reaplicada)`,
          `ALTER TABLE "${tabela}" DROP CONSTRAINT IF EXISTS "${nome}"; ${comando}`,
        );
      }
    }

    /*
      5. Triggers, pelo bloco reentrante da própria fila. Um `DROP TABLE …
      CASCADE` leva os triggers junto, e sem este passo uma tabela
      imutável-por-design voltaria gravável em silêncio.
    */
    const triggersReais = await nomesDe(
      client,
      `select t.tgname as nome from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
       where not t.tgisinternal and c.relnamespace = 'public'::regnamespace`,
    );
    for (const [nome, { tabela, comando }] of triggersDaFila(migrations)) {
      if (triggersReais.has(nome) || !tabelasReais.has(tabela)) continue;
      await aplicar(`trigger ${nome}`, comando);
    }

    /*
      6. Views, por último — elas leem o que os cinco passos acima repuseram.

      Um `DROP COLUMN … CASCADE` do Provision leva junto toda view que citava a
      coluna, e repor a coluna não as traz de volta. Enquanto as views deste
      esquema eram só as três de diagnóstico da `0015`, a ausência era um
      incômodo; desde a `0061` não é: `fato_visivel` é o caminho de toda
      leitura de fato, e sem ela o banco fica com o schema completo e o produto
      morto — que é o modo de falha mais confuso possível, porque `/healthz`
      não teria do que reclamar.

      Na ordem da fila, e só as que faltam: recriar uma view que está de pé
      trocaria a definição por outra igual sem motivo, e num boot íntegro este
      passo não aplica nada.
    */
    const viewsReais = await nomesDe(
      client,
      `select table_name as nome from information_schema.views
        where table_schema = 'public'`,
    );
    for (const [nome, comando] of viewsDaFila(migrations)) {
      if (viewsReais.has(nome)) continue;
      await aplicar(`view ${nome}`, comando);
    }

    return relatorio;
  } finally {
    await client
      .query("SELECT pg_advisory_unlock($1)", [RECONVERGENCIA_LOCK])
      .catch(() => {
        /* Se a conexão já caiu, o lock morre com ela. Nada a fazer. */
      });
    client.release();
    await pool.end();
  }
}

/** O desfecho: reconvergiu, ou recusou — e o motivo nomeia quem resolve. */
export type DesfechoDaReconvergencia =
  | { rodou: true; relatorio: RelatorioDeReconvergencia }
  | { rodou: false; motivo: string };

/**
 * A reconvergência atrás das suas recusas — a única porta de entrada.
 *
 * As recusas são política, e política tem um dono só: esta função. A partida do
 * servidor e o `conferir-schema -- --aplicar` chamam-na igualmente, e por isso
 * não têm como discordar sobre quando reconvergir é cabível. Cada recusa nomeia
 * quem resolve:
 *
 *   - **schema inexistente**: banco novo — a fila resolve, do zero;
 *   - **pendências** (registro ausente ou incompleto): com migration pendente,
 *     a ausência é explicada e a fila é quem resolve — reconvergir aqui criaria
 *     objeto fora de ordem;
 *   - **bridge pendente**: o banco declara um estado intencional no meio de um
 *     deploy assistido, e repor o que o `down` tirou é papel do `up`.
 *
 * Abre a própria conexão pela URL — e não por um pool de processo — para que a
 * pergunta e o reparo caiam garantidamente no mesmo banco, inclusive nos testes
 * que exercitam vários.
 */
export async function reconvergirSeCabivel(
  connectionString: string,
  migrations: MigrationFile[] = readMigrations(),
): Promise<DesfechoDaReconvergencia> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    const schema = await pool.query<{ migrated: boolean }>(
      `select to_regclass('public.import_run') is not null as migrated`,
    );
    if (!schema.rows[0]?.migrated) {
      return { rodou: false, motivo: "schema ainda não existe — a fila resolve" };
    }

    const temRegistro = await pool.query<{ existe: boolean }>(
      `select to_regclass('drizzle.__drizzle_migrations') is not null as existe`,
    );
    if (!temRegistro.rows[0]?.existe) {
      /* Schema sem registro: aos olhos deste build está tudo pendente — e é a
         fila (ou a adoção, decisão humana) quem resolve, nunca o reparo. */
      return {
        rodou: false,
        motivo: `${migrations.length} migration(s) pendente(s) — a fila resolve`,
      };
    }

    const { rows } = await pool.query<{ created_at: string }>(
      `select created_at from drizzle.__drizzle_migrations`,
    );
    const aplicadas = new Set(rows.map((linha) => Number(linha.created_at)));
    const pendentes = migrations.filter((m) => !aplicadas.has(m.when));
    if (pendentes.length > 0) {
      return {
        rodou: false,
        motivo: `${pendentes.length} migration(s) pendente(s) — a fila resolve`,
      };
    }

    const bridge = await bridgePendente(async (texto) => {
      const r = await pool.query<Record<string, unknown>>(texto);
      return { rows: r.rows };
    });
    if (bridge.pendente) {
      return { rodou: false, motivo: "bridge pendente — o bridge:up resolve" };
    }
  } catch (err) {
    return {
      rodou: false,
      motivo: `banco inalcançável (${err instanceof Error ? err.message : String(err)})`,
    };
  } finally {
    await pool.end();
  }

  return { rodou: true, relatorio: await reconvergirSchema(connectionString, migrations) };
}

/**
 * O reparo que destrava a fila — a recusa acima, virada onde ela é falsa.
 *
 * ---------------------------------------------------------------------------
 * O impasse que isto desfaz
 * ---------------------------------------------------------------------------
 * `runMigrations()` decide por carimbo: migration registrada não roda de novo,
 * e por isso a fila não repõe nada. `reconvergirSeCabivel` repõe, mas se
 * recusa quando há pendência — "pendência explica ausência, e é a fila quem
 * resolve". As duas regras estão certas, e existe um estado em que as duas
 * juntas não deixam ninguém agir: **a pendência é causada pela ausência de um
 * objeto de migration já registrada**.
 *
 * Foi onde Production parou em 21/08/2026. O Provision do Publishing tinha
 * levado `remuneracao_unidade` — tabela da `0048`, registrada como aplicada —
 * e a `0049` morreu no `ALTER TABLE "remuneracao_unidade" ADD COLUMN IF NOT
 * EXISTS "unidade_id"` com 42P01: o `IF NOT EXISTS` guarda a coluna, nunca a
 * tabela. A fila não repunha (carimbo lá), a reconvergência não rodava
 * (pendência), e o estado era estável — cada partida repetia idêntico.
 *
 * Aqui a pendência **não** explica a ausência, e é por isso que esta porta
 * existe separada em vez de a outra afrouxar: o que se repõe é só o que as
 * migrations **registradas** criam, com o DDL levantado delas próprias. O que
 * só as pendentes sabem criar continua sendo trabalho da fila, e some do
 * relatório em vez de virar `semComando`.
 *
 * Não é um caminho para o deploy normal: quem chega aqui já falhou uma vez, e
 * quem chama é `migrarComReparo` (`./fila`), depois de a fila ter parado.
 */
export async function reconvergirRegistradas(
  connectionString: string,
  migrations: MigrationFile[] = readMigrations(),
): Promise<DesfechoDaReconvergencia> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  let registradas: MigrationFile[] = [];
  let pendentes: MigrationFile[] = [];

  try {
    const temRegistro = await pool.query<{ existe: boolean }>(
      `select to_regclass('drizzle.__drizzle_migrations') is not null as existe`,
    );
    if (!temRegistro.rows[0]?.existe) {
      return { rodou: false, motivo: "registro ausente — a fila resolve" };
    }

    const { rows } = await pool.query<{ created_at: string }>(
      `select created_at from drizzle.__drizzle_migrations`,
    );
    const aplicadas = new Set(rows.map((linha) => Number(linha.created_at)));
    registradas = migrations.filter((m) => aplicadas.has(m.when));
    pendentes = migrations.filter((m) => !aplicadas.has(m.when));

    if (registradas.length === 0) {
      /* Registro vazio: nada foi declarado aplicado, então nada foi arrancado
         de debaixo da fila. É banco novo, ou é registro perdido — e o segundo
         é decisão humana (`--adotar-existentes`), nunca reparo automático. */
      return { rodou: false, motivo: "nada registrado — a fila cria do zero" };
    }
    if (pendentes.length === 0) {
      /* Sem pendência não há impasse: a porta de sempre já cobre este banco. */
      return {
        rodou: false,
        motivo: "nada pendente — a reconvergência da partida resolve",
      };
    }

    const bridge = await bridgePendente(async (texto) => {
      const r = await pool.query<Record<string, unknown>>(texto);
      return { rows: r.rows };
    });
    if (bridge.pendente) {
      return { rodou: false, motivo: "bridge pendente — o bridge:up resolve" };
    }
  } catch (err) {
    return {
      rodou: false,
      motivo: `banco inalcançável (${err instanceof Error ? err.message : String(err)})`,
    };
  } finally {
    await pool.end();
  }

  return {
    rodou: true,
    relatorio: await reconvergirSchema(
      connectionString,
      registradas,
      pendentes,
    ),
  };
}
