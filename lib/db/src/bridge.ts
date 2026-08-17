/**
 * O bridge deploy — como publicar sem deixar o Publishing reescrever o schema.
 *
 * ---------------------------------------------------------------------------
 * O conflito
 * ---------------------------------------------------------------------------
 * Existem duas autoridades sobre o schema de Production, e elas rodam em
 * momentos diferentes do mesmo deploy:
 *
 * 1. **O Publishing do Replit**, na fase `Provision`, que introspecta os bancos
 *    de Development e de Production, calcula o diff e o aplica — antes de o
 *    servidor novo existir. É serviço da plataforma; nada neste repositório o
 *    desliga (renomear `drizzle.config.ts` não desliga: a doc do Replit é
 *    explícita sobre a introspecção direta dos dois bancos).
 * 2. **`runMigrations()`**, na partida do servidor, aplicando a fila versionada.
 *
 * A primeira sempre ganha a corrida, e ela não sabe nada do que sustenta este
 * schema: não cria as onze funções `freightcheck_*`, não cria as três views,
 * não faz backfill, não funde vigência duplicada, e não conhece a ordem
 * "coluna nullable → backfill → validação → NOT NULL". O deploy morria em
 *
 *     ALTER TABLE "snapshot" ADD COLUMN "canonical_snapshot_key" text
 *       GENERATED ALWAYS AS (freightcheck_snapshot_key(...)) STORED;
 *     ERROR: function freightcheck_snapshot_key(text, text, text, date, jsonb)
 *            does not exist
 *
 * e a única saída que a tela oferecia era copiar Development por cima de
 * Production.
 *
 * ---------------------------------------------------------------------------
 * A saída: não fazer o diff funcionar — fazer o diff ficar pequeno e inócuo
 * ---------------------------------------------------------------------------
 * `bridgeDown` deixa Development temporariamente compatível com Production
 * **exatamente nos pontos que geram DDL destrutivo ou impossível**. O que sobra
 * para o Publishing é medido, nominal e de uma classe só:
 *
 *     6 ADD COLUMN — nullable, sem default, sem generated, em tabela existente
 *
 * As seis pertencem à `0015`, que **confere o tipo de cada uma** e aborta
 * nomeando a diferença se alguma chegar errada. Nenhuma tabela, nenhum índice,
 * nenhuma constraint, nenhum DROP.
 *
 * Depois do deploy, `runMigrations()` leva Production de `0000` ao fim da fila — a
 * fila é reentrante, então atravessa o que o Publishing tiver criado —, e
 * `bridgeUp` devolve Development ao estado canônico.
 *
 * ---------------------------------------------------------------------------
 * Três regras que este módulo não quebra
 * ---------------------------------------------------------------------------
 * **Sem CASCADE.** Toda remoção é `RESTRICT`. Uma dependência que ninguém
 * previu tem de derrubar o bridge, não sumir junto com o objeto. As dependências
 * conhecidas são enumeradas antes e conferidas uma a uma.
 *
 * **Fail-closed e transacional.** Todas as pré-condições são verificadas antes
 * do primeiro DDL, e tudo roda numa transação só: ou o bridge inteiro entra, ou
 * nada entra.
 *
 * **O registro não é tocado.** `drizzle.__drizzle_migrations` é história de
 * migrations, não retrato de estrutura; uma sobreposição operacional temporária
 * não é evento dessa história. Por isso `bridgeUp` **não** é um segundo
 * executor de migrations: ele restaura uma lista nominal de objetos, cada um
 * com a definição exata que a migration proprietária lhe dá, e nenhuma
 * transformação de dados é reaplicada.
 */
import pg from "pg";
import { readMigrations, mexeEmDados } from "./migrate";
import {
  CRIAR_MARCADOR,
  LIMPAR_MARCADOR,
  MARCAR_DESCIDA,
} from "./bridge-marcador";

// ---------------------------------------------------------------------------
// O que o bridge move, nominalmente
// ---------------------------------------------------------------------------

/** As nove colunas que a `0013` remove de `ticket`, com o tipo original da `0012`. */
export const COLUNAS_LEGADAS_TICKET: { nome: string; ddl: string }[] = [
  { nome: "parameter_label", ddl: "text" },
  { nome: "attribute_code", ddl: "text" },
  { nome: "requested_value_raw", ddl: "text" },
  { nome: "requested_value_numeric", ddl: "numeric(18, 6)" },
  { nome: "applied_value_raw", ddl: "text" },
  { nome: "applied_value_numeric", ddl: "numeric(18, 6)" },
  { nome: "impact_amount", ddl: "numeric(18, 6)" },
  // Idêntica à de Production: a medição do primeiro desenho mostrou que
  // recriá-la nullable deixava um ALTER de comportamento no diff residual.
  { nome: "impact_confidence", ddl: "text NOT NULL DEFAULT 'NOT_CALCULABLE'" },
  { nome: "impact_reason", ddl: "text" },
];

/**
 * A allowlist: o que o Publishing ainda cria em Production depois do `down`.
 *
 * Todas nullable, sem default, sem generated, em tabela que já existe — e todas
 * conferidas por tipo pela `0015` (ver a seção 4 daquela migration).
 */
export const ALLOWLIST: { tabela: string; coluna: string; tipo: string }[] = [
  { tabela: "snapshot", coluna: "dataset_family", tipo: "text" },
  { tabela: "snapshot", coluna: "canal", tipo: "text" },
  { tabela: "snapshot", coluna: "canonical_scope", tipo: "jsonb" },
  { tabela: "snapshot", coluna: "canonical_payload_hash", tipo: "text" },
  { tabela: "staged_fact", coluna: "entity_key_raw", tipo: "text" },
  { tabela: "entity_identifier", coluna: "identifier_value_raw", tipo: "text" },
];

/**
 * Tabelas que o `down` remove. Todas têm de estar vazias — é pré-condição.
 *
 * `ticket_import_deletion` é da `0020`, e a pré-condição de vazia vale para ela
 * com um sentido a mais: é o registro das exclusões de envios de chamados, e
 * ele é append-only justamente para não se perder. Um bridge que a derrubasse
 * com linhas dentro apagaria em silêncio a única prova de que aqueles envios
 * existiram — então ele para e diz o que encontrou, que é o que este projeto
 * faz com descarte.
 *
 * `coverage_expectation`, da `0021`, está aqui pelo mesmo motivo e não entre as
 * derivadas abaixo: o que ela guarda é decisão humana — um curador que dispensou
 * uma ausência ou aceitou uma renomeação escreveu ali algo que nenhuma consulta
 * reconstrói. Se ela tiver linha, abortar é o desfecho certo, não um transtorno.
 */
const TABELAS_REMOVIDAS = [
  "ticket_change",
  "snapshot_merge",
  "import_decision",
  "ticket_import_deletion",
  "coverage_expectation",
];

/**
 * Tabelas **derivadas** que o `down` remove mesmo com linhas.
 *
 * A pré-condição de vazia existe para que o bridge nunca descarte dado que só
 * existe naquela tabela. `snapshot_entity_type` não é esse caso: cada linha
 * dela é o resultado de uma contagem sobre `fact`, e a consulta que a produz
 * está escrita na migration que a criou. Descartá-la não perde nada; exigi-la
 * vazia travaria todo deploy de um Development com dado, que é o normal.
 *
 * O `up` a reconstrói com **aquele mesmo statement**, levantado do disco — não
 * com uma cópia reescrita aqui, que poderia divergir sem ninguém ver.
 */
const TABELAS_DERIVADAS: { nome: string; migration: string; marca: RegExp }[] = [
  {
    nome: "snapshot_entity_type",
    migration: "0021_cobertura",
    marca: /INSERT INTO "snapshot_entity_type"/,
  },
];

/**
 * Colunas que o `down` remove de tabelas que ficam.
 *
 * Exportada porque é a lista que a reconciliação tem de cobrir. Depois que o
 * `down` roda, **só o `up` devolve estas colunas**: a fila de migrations não
 * consegue, porque o registro já dá por aplicadas as migrations que as criam. A
 * `0024_reconciliar_bridge` fecha esse buraco para as que dá para fechar, e
 * `reconciliacao-bridge.test.ts` exige que toda entrada daqui esteja de um dos
 * dois lados dessa fronteira — nunca esquecida no meio.
 */
export const COLUNAS_REMOVIDAS: [string, string][] = [
  ["snapshot", "canonical_snapshot_key"],
  ["ticket", "changed_parameter_count"],
  ["ticket", "vigencia_label"],
  ["ticket", "entity_description"],
  ["ticket_import", "parameter_columns"],
  ["fact", "inherited_from_snapshot_id"],
  // A `0019` não está aplicada no Development real (o registro para na `0018`),
  // mas o bridge não pode depender disso: num banco que já a tenha, estas três
  // e o CHECK que as acompanha entrariam no diff, e o CHECK é comportamento.
  ["assistant_message", "feedback"],
  ["assistant_message", "feedback_note"],
  ["assistant_message", "feedback_at"],
  // A `0022`, pelo mesmo motivo das três acima. As duas são nullable e sem
  // default — a forma exata da allowlist —, e ainda assim saem em vez de entrar
  // nela: a allowlist não é "onde coluna nova cabe", é a lista fechada que a
  // `0015` confere por tipo e aborta nomeando a diferença. Crescê-la afrouxaria
  // a conferência para ganhar dois `ADD COLUMN` que a fila cria de graça.
  ["attribute", "definition"],
  ["attribute_semantics", "definition"],
  // A `0023`, pelo mesmo motivo da `0022`: a direção econômica e a frase que a
  // explica são quatro colunas de texto nullable, exatamente a forma que a
  // allowlist aceita — e mesmo assim saem, porque a allowlist é uma lista
  // fechada conferida por tipo, e não um lugar onde coluna nova cabe.
  ["attribute", "economic_direction"],
  ["attribute", "economic_effect"],
  ["attribute_semantics", "economic_direction"],
  ["attribute_semantics", "economic_effect"],
];

/** Índices que o `down` remove. Exportada pelo motivo de `COLUNAS_REMOVIDAS`. */
export const INDICES_REMOVIDOS = [
  "snapshot_canonical_live_uq",
  "snapshot_canonical_revision_uq",
  "snapshot_canonical_key_idx",
  "fact_inherited_idx",
  "ticket_vigencia_idx",
  "fact_nao_aplicavel_idx",
];

/**
 * As três views da `0015`. Duas dependem da coluna gerada; a terceira não —
 * `freightcheck_fato_duplicado` olha só para `fact`.
 *
 * Ela sai mesmo assim, e o motivo é o critério, não a dependência: **não há
 * como provar que o Publishing ignora views.** Para funções há prova direta —
 * o deploy morreu chamando `freightcheck_snapshot_key`, o que significa que o
 * diff dele trazia a coluna gerada e não trazia a função. Para views não existe
 * evidência equivalente, e uma view que ele tentasse criar em Production
 * referenciaria colunas que só a fila cria. Na dúvida, o bridge remove.
 */
const VIEWS_REMOVIDAS = [
  "freightcheck_snapshot_ativo_duplicado",
  "freightcheck_identidade_vigencia",
  "freightcheck_fato_duplicado",
];

/**
 * As onze funções da identidade canônica, criadas pela `0015`.
 *
 * Production tem seis funções `freightcheck_*` — as da `0001` e da `0009` —, e
 * não tem nenhuma destas. Elas saem para que o estado pós-`down` seja
 * comparável a Production em **todas** as categorias, e não só nas que se
 * consegue argumentar. Depois da coluna gerada e das views, nada mais depende
 * delas: são posteriores a `freightcheck_correct_entity_type` e aos gatilhos de
 * imutabilidade, que portanto não as chamam.
 *
 * O `up` as recria antes de qualquer coisa que as use, levantando as definições
 * da própria `0015` — `CREATE OR REPLACE FUNCTION`, idempotente e sem dado.
 */
const FUNCOES_REMOVIDAS = [
  "freightcheck_sem_acento",
  "freightcheck_norm_documento",
  "freightcheck_norm_identificador",
  "freightcheck_norm_scope_code",
  "freightcheck_norm_canal",
  "freightcheck_canal_do_rotulo",
  "freightcheck_dataset_family",
  "freightcheck_canonical_scope",
  "freightcheck_serialize_scope",
  "freightcheck_iso_date",
  "freightcheck_snapshot_key",
];

/**
 * A função de gatilho da `0020`, que Production não tem.
 *
 * Sai pelo mesmo critério das onze acima — o estado pós-`down` precisa ser
 * comparável a Production em **todas** as categorias, e função é uma delas. O
 * gatilho que a chama já saiu junto com a tabela; a ordem no `down` garante
 * isso, e o `RESTRICT` continua sendo quem decide se algo mais dependia dela.
 */
const FUNCOES_REMOVIDAS_CHAMADOS = [
  "freightcheck_ticket_import_deletion_is_immutable",
];

const CHECKS_REMOVIDOS: [string, string][] = [
  ["snapshot", "snapshot_canal_nao_vazio_ck"],
  ["snapshot", "snapshot_dataset_family_nao_vazio_ck"],
  ["snapshot", "snapshot_canonical_scope_ck"],
  ["snapshot", "snapshot_canonical_scope_nao_vazio_ck"],
  ["assistant_message", "assistant_message_feedback_ck"],
  // A `0023` — as duas travas da coerência semântica. São comportamento, e não
  // forma: um Development que as tenha recusaria uma linha que o Publishing
  // aceita, então o `down` as derruba e o `up` as repõe.
  ["attribute", "attribute_semantica_coerente"],
  ["attribute_semantics", "attribute_semantics_semantica_coerente"],
];

const NULLABLE_TEMPORARIO: [string, string][] = [
  ["snapshot", "dataset_family"],
  ["snapshot", "canal"],
  ["snapshot", "canonical_scope"],
];

const INDICES_LEGADOS: { nome: string; ddl: string }[] = [
  {
    nome: "snapshot_business_key_uq",
    ddl: `CREATE UNIQUE INDEX IF NOT EXISTS "snapshot_business_key_uq" ON "snapshot"
            USING btree ("source_system","source_label","scope_hash","entity_type_set","revision")`,
  },
  {
    nome: "snapshot_business_key_live_uq",
    ddl: `CREATE UNIQUE INDEX IF NOT EXISTS "snapshot_business_key_live_uq" ON "snapshot"
            USING btree ("source_system","source_label","scope_hash","entity_type_set")
            WHERE "status" <> 'SUPERSEDED'`,
  },
  {
    nome: "ticket_attribute_idx",
    ddl: `CREATE INDEX IF NOT EXISTS "ticket_attribute_idx" ON "ticket" USING btree ("attribute_code")`,
  },
];

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------

export interface BridgeReport {
  /** Pré-condições conferidas, na ordem, com o que cada uma mediu. */
  precondicoes: { nome: string; ok: boolean; detalhe: string }[];
  /** Objetos dependentes encontrados, por objeto que seria removido. */
  dependencias: { objeto: string; dependentes: string[] }[];
  /** DDL executado, em ordem. Em `dryRun`, o que teria sido executado. */
  ddl: string[];
  /** A conferência do estado residual, depois dos DDLs. */
  verificacao: { nome: string; ok: boolean; detalhe: string }[];
  dryRun: boolean;
  /** Preenchido quando o bridge abortou. Nada foi aplicado. */
  falha?: string;
}

class BridgeAbortou extends Error {}

// ---------------------------------------------------------------------------
// Leitura de estrutura
// ---------------------------------------------------------------------------

async function existeTabela(c: pg.PoolClient, nome: string): Promise<boolean> {
  const { rows } = await c.query<{ e: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS e`,
    [`public."${nome}"`],
  );
  return rows[0]!.e;
}

async function existeColuna(
  c: pg.PoolClient,
  tabela: string,
  coluna: string,
): Promise<boolean> {
  const { rows } = await c.query<{ e: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema='public' AND table_name=$1 AND column_name=$2) AS e`,
    [tabela, coluna],
  );
  return rows[0]!.e;
}

/**
 * A estrutura comparável de um banco — o que o critério final do `up` compara.
 *
 * Views e funções entram porque são exatamente o que um diff de schema não
 * modela, e portanto o que se perderia sem ninguém notar.
 */
export async function estruturaDe(
  c: pg.PoolClient | pg.Pool,
): Promise<string[]> {
  const { rows } = await c.query<{ linha: string }>(`
    SELECT linha FROM (
      SELECT 'COL  '||table_name||'.'||column_name||' '||data_type||' null='||is_nullable
             ||' gen='||coalesce((SELECT a.attgenerated::text FROM pg_attribute a
                  JOIN pg_class k ON k.oid=a.attrelid AND k.relnamespace='public'::regnamespace
                 WHERE k.relname=c.table_name AND a.attname=c.column_name),'')
             ||' def='||coalesce(column_default,'-') AS linha
        FROM information_schema.columns c
       WHERE table_schema='public'
      UNION ALL SELECT 'IDX  '||indexdef FROM pg_indexes WHERE schemaname='public'
      UNION ALL SELECT 'CON  '||conname||' '||pg_get_constraintdef(oid)
        FROM pg_constraint WHERE connamespace='public'::regnamespace
      UNION ALL SELECT 'TRG  '||t.tgname||' on '||k.relname
        FROM pg_trigger t JOIN pg_class k ON k.oid=t.tgrelid WHERE NOT t.tgisinternal
      UNION ALL SELECT 'FN   '||p.proname||'('||pg_get_function_arguments(p.oid)||')'
        FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'freightcheck%'
      UNION ALL SELECT 'VIEW '||viewname||' '||md5(definition) FROM pg_views WHERE schemaname='public'
      UNION ALL SELECT 'ENUM '||t.typname||' '||e.enumlabel
        FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
    ) s ORDER BY linha`);
  return rows.map((r) => r.linha);
}

// ---------------------------------------------------------------------------
// Dependências — a alternativa ao CASCADE
// ---------------------------------------------------------------------------

/**
 * O que depende deste objeto, tirando o que o bridge já vai remover.
 *
 * `DROP ... CASCADE` resolveria isso sozinho, e é justamente por isso que não é
 * usado: ele remove em silêncio o que ninguém previu. Aqui a dependência
 * inesperada aparece nominalmente e derruba o bridge.
 */
async function dependentesInesperados(
  c: pg.PoolClient,
  relname: string,
  previstos: Set<string>,
): Promise<string[]> {
  const { rows } = await c.query<{ nome: string; tipo: string }>(
    `SELECT DISTINCT dep.relname AS nome,
            CASE dep.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'matview'
                             WHEN 'i' THEN 'índice' ELSE dep.relkind::text END AS tipo
       FROM pg_depend d
       JOIN pg_class alvo ON alvo.oid = d.refobjid
       JOIN pg_rewrite r  ON r.oid = d.objid
       JOIN pg_class dep  ON dep.oid = r.ev_class
      WHERE alvo.relname = $1
        AND alvo.relnamespace = 'public'::regnamespace
        AND dep.relname <> $1
      UNION
     SELECT c2.relname, 'FK ' || con.conname
       FROM pg_constraint con
       JOIN pg_class c2 ON c2.oid = con.conrelid
      WHERE con.confrelid = to_regclass($2)
        AND con.conrelid <> con.confrelid`,
    [relname, `public."${relname}"`],
  );
  return rows
    .filter((r) => !previstos.has(r.nome))
    .map((r) => `${r.tipo} ${r.nome}`);
}

// ---------------------------------------------------------------------------
// bridge-down
// ---------------------------------------------------------------------------

export interface DownOptions {
  dryRun?: boolean;
}

export async function bridgeDown(
  connectionString: string,
  options: DownOptions = {},
): Promise<BridgeReport> {
  const dryRun = options.dryRun === true;
  const pool = new pg.Pool({ connectionString });
  const c = await pool.connect();
  const rel: BridgeReport = {
    precondicoes: [],
    dependencias: [],
    ddl: [],
    verificacao: [],
    dryRun,
  };

  const exec = async (sql: string) => {
    rel.ddl.push(sql.trim().replace(/\s+/g, " "));
    await c.query(sql);
  };

  try {
    await c.query("BEGIN");

    // -----------------------------------------------------------------------
    // 1. Pré-condições — todas antes do primeiro DDL
    // -----------------------------------------------------------------------
    const exigir = (nome: string, ok: boolean, detalhe: string) => {
      rel.precondicoes.push({ nome, ok, detalhe });
      if (!ok) throw new BridgeAbortou(`pré-condição falhou — ${nome}: ${detalhe}`);
    };

    for (const t of TABELAS_REMOVIDAS) {
      if (!(await existeTabela(c, t))) {
        rel.precondicoes.push({
          nome: `${t} vazia`,
          ok: true,
          detalhe: "tabela não existe",
        });
        continue;
      }
      const { rows } = await c.query<{ n: string }>(`SELECT count(*) AS n FROM "${t}"`);
      exigir(
        `${t} vazia`,
        Number(rows[0]!.n) === 0,
        `${rows[0]!.n} linha(s) — o bridge remove esta tabela e não copia dado`,
      );
    }

    if (await existeColuna(c, "fact", "inherited_from_snapshot_id")) {
      const { rows } = await c.query<{ n: string }>(
        `SELECT count(*) AS n FROM "fact" WHERE "inherited_from_snapshot_id" IS NOT NULL`,
      );
      exigir("nenhum fato herdado", Number(rows[0]!.n) === 0, `${rows[0]!.n} fato(s) herdado(s)`);
    }

    if (await existeTabela(c, "ticket")) {
      const { rows } = await c.query<{ n: string }>(`SELECT count(*) AS n FROM "ticket"`);
      exigir("ticket sem linhas", Number(rows[0]!.n) === 0, `${rows[0]!.n} chamado(s)`);
    }

    if (await existeColuna(c, "assistant_message", "feedback")) {
      const { rows } = await c.query<{ n: string }>(
        `SELECT count(*) AS n FROM "assistant_message"
          WHERE "feedback" IS NOT NULL OR "feedback_note" IS NOT NULL OR "feedback_at" IS NOT NULL`,
      );
      exigir(
        "nenhum feedback registrado",
        Number(rows[0]!.n) === 0,
        `${rows[0]!.n} mensagem(ns) com feedback — o bridge remove estas colunas`,
      );
    }

    if (await existeColuna(c, "ticket_import", "parameter_columns")) {
      const { rows } = await c.query<{ n: string }>(
        `SELECT count(*) AS n FROM "ticket_import"
          WHERE "parameter_columns" IS NOT NULL AND "parameter_columns" <> '[]'::jsonb`,
      );
      exigir(
        "parameter_columns sem conteúdo",
        Number(rows[0]!.n) === 0,
        `${rows[0]!.n} envio(s) com colunas de parâmetro registradas`,
      );
    }

    /*
      Não se derruba o que não se sabe levantar. Construir o plano do `up` aqui
      — antes do primeiro DDL — prova que cada objeto removido tem, no
      repositório, a definição exata que o restaura, e que nenhuma delas mexe em
      dados. Se uma migration for editada de um jeito que quebre esse
      levantamento, o `down` para aqui em vez de deixar Development pela metade.

      Também é o que substitui a antiga exigência de "a função tal existe no
      banco": agora que o `down` remove as funções da identidade, exigir a
      presença delas quebraria a repetibilidade dele.
    */
    let objetosDoUp = 0;
    try {
      objetosDoUp = planoUp().length;
    } catch (err) {
      throw new BridgeAbortou(
        `o plano de restauração não pôde ser construído: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    rel.precondicoes.push({
      nome: "plano de restauração construível",
      ok: true,
      detalhe: `${objetosDoUp} objetos, nenhum statement mexe em dados`,
    });

    // -----------------------------------------------------------------------
    // 2. Dependências — nada de CASCADE
    // -----------------------------------------------------------------------
    const previstos = new Set<string>([
      ...TABELAS_REMOVIDAS,
      ...TABELAS_DERIVADAS.map((t) => t.nome),
      ...INDICES_REMOVIDOS,
      ...VIEWS_REMOVIDAS,
    ]);
    for (const alvo of [
      ...TABELAS_REMOVIDAS,
      ...TABELAS_DERIVADAS.map((t) => t.nome),
      "snapshot",
    ]) {
      if (!(await existeTabela(c, alvo))) continue;
      const dependentes =
        alvo === "snapshot"
          ? (await dependentesInesperados(c, alvo, previstos)).filter((d) =>
              // De `snapshot` só interessa quem depende da coluna gerada; as
              // duas views são previstas, o resto tem de aparecer.
              VIEWS_REMOVIDAS.every((v) => !d.endsWith(v)),
            )
          : await dependentesInesperados(c, alvo, previstos);
      rel.dependencias.push({ objeto: alvo, dependentes });
      if (alvo !== "snapshot" && dependentes.length > 0) {
        throw new BridgeAbortou(
          `dependência inesperada em ${alvo}: ${dependentes.join(", ")}. ` +
            `O bridge não usa CASCADE — confira o que apareceu e decida à mão.`,
        );
      }
    }

    // -----------------------------------------------------------------------
    // 3. DDL — sem CASCADE em nenhum ponto
    // -----------------------------------------------------------------------
    for (const v of VIEWS_REMOVIDAS) await exec(`DROP VIEW IF EXISTS "${v}" RESTRICT`);
    for (const i of INDICES_REMOVIDOS) await exec(`DROP INDEX IF EXISTS "${i}" RESTRICT`);
    for (const [t, cc] of CHECKS_REMOVIDOS) {
      await exec(`ALTER TABLE "${t}" DROP CONSTRAINT IF EXISTS "${cc}" RESTRICT`);
    }
    for (const [t, col] of NULLABLE_TEMPORARIO) {
      if (await existeColuna(c, t, col)) {
        await exec(`ALTER TABLE "${t}" ALTER COLUMN "${col}" DROP NOT NULL`);
      }
    }
    for (const [t, col] of COLUNAS_REMOVIDAS) {
      if (await existeColuna(c, t, col)) {
        await exec(`ALTER TABLE "${t}" DROP COLUMN "${col}" RESTRICT`);
      }
    }
    for (const t of [...TABELAS_REMOVIDAS, ...TABELAS_DERIVADAS.map((d) => d.nome)]) {
      if (await existeTabela(c, t)) await exec(`DROP TABLE "${t}" RESTRICT`);
    }
    // Depois da coluna gerada e das views, nada mais depende delas. `RESTRICT`
    // continua sendo quem decide: se algo depender, o bridge cai aqui.
    for (const f of [...FUNCOES_REMOVIDAS, ...FUNCOES_REMOVIDAS_CHAMADOS]) {
      const { rows } = await c.query<{ assinatura: string }>(
        `SELECT p.oid::regprocedure::text AS assinatura FROM pg_proc p
          WHERE p.pronamespace='public'::regnamespace AND p.proname=$1`,
        [f],
      );
      for (const r of rows) await exec(`DROP FUNCTION ${r.assinatura} RESTRICT`);
    }
    for (const col of COLUNAS_LEGADAS_TICKET) {
      await exec(
        `ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "${col.nome}" ${col.ddl}`,
      );
    }
    for (const i of INDICES_LEGADOS) await exec(i.ddl);

    // -----------------------------------------------------------------------
    // 4. Verificação do estado residual — só então o script confirma sucesso
    // -----------------------------------------------------------------------
    const conferir = (nome: string, ok: boolean, detalhe: string) => {
      rel.verificacao.push({ nome, ok, detalhe });
      if (!ok) throw new BridgeAbortou(`verificação falhou — ${nome}: ${detalhe}`);
    };

    for (const a of ALLOWLIST) {
      const { rows } = await c.query<{ t: string; n: string; d: string | null }>(
        `SELECT data_type AS t, is_nullable AS n, column_default AS d
           FROM information_schema.columns
          WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
        [a.tabela, a.coluna],
      );
      const r = rows[0];
      conferir(
        `allowlist ${a.tabela}.${a.coluna}`,
        !!r && r.t === a.tipo && r.n === "YES" && r.d === null,
        r ? `${r.t} null=${r.n} default=${r.d ?? "-"}` : "ausente",
      );
    }

    for (const t of [...TABELAS_REMOVIDAS, ...TABELAS_DERIVADAS.map((d) => d.nome)]) {
      conferir(`${t} removida`, !(await existeTabela(c, t)), "ainda existe");
    }
    for (const [t, col] of COLUNAS_REMOVIDAS) {
      conferir(`${t}.${col} removida`, !(await existeColuna(c, t, col)), "ainda existe");
    }
    for (const col of COLUNAS_LEGADAS_TICKET) {
      conferir(
        `ticket.${col.nome} restaurada`,
        await existeColuna(c, "ticket", col.nome),
        "ausente",
      );
    }
    const { rows: idx } = await c.query<{ nome: string }>(
      `SELECT indexname AS nome FROM pg_indexes WHERE schemaname='public'`,
    );
    const nomes = new Set(idx.map((r) => r.nome));
    for (const i of INDICES_REMOVIDOS) {
      conferir(`índice ${i} removido`, !nomes.has(i), "ainda existe");
    }
    for (const i of INDICES_LEGADOS) {
      conferir(`índice ${i.nome} restaurado`, nomes.has(i.nome), "ausente");
    }
    const { rows: gerada } = await c.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_attribute a
         JOIN pg_class k ON k.oid=a.attrelid AND k.relnamespace='public'::regnamespace
        WHERE a.attgenerated <> '' AND NOT a.attisdropped`,
    );
    conferir(
      "nenhuma coluna gerada no schema",
      Number(gerada[0]!.n) === 0,
      `${gerada[0]!.n} coluna(s) gerada(s) — o Publishing tentaria recriá-la`,
    );
    const { rows: views } = await c.query<{ nome: string }>(
      `SELECT viewname AS nome FROM pg_views WHERE schemaname='public'`,
    );
    conferir(
      "nenhuma view do schema canônico",
      views.length === 0,
      `sobrou: ${views.map((v) => v.nome).join(", ")}`,
    );
    const { rows: fns } = await c.query<{ nome: string }>(
      `SELECT proname AS nome FROM pg_proc
        WHERE pronamespace='public'::regnamespace AND proname = ANY($1)`,
      [FUNCOES_REMOVIDAS],
    );
    conferir(
      "nenhuma função da identidade",
      fns.length === 0,
      `sobrou: ${fns.map((f) => f.nome).join(", ")}`,
    );

    /*
      O marcador entra **com** o bridge, e não depois dele.

      O `down` inteiro é uma transação — ou entra tudo, ou nada. O marcador vai
      junto: um `down` que aborta não deixa marcador, e um `down` que entra não
      tem como deixar de deixá-lo. Escrevê-lo depois do `COMMIT` criaria uma
      segunda verdade sobre o mesmo fato, capaz de discordar da primeira
      exatamente na janela em que alguém precisaria dela.

      Em `dryRun` ele é escrito e desfeito junto com o resto, que é o que faz o
      ensaio ensaiar também esta parte.
    */
    for (const comando of CRIAR_MARCADOR) await c.query(comando);
    await c.query(MARCAR_DESCIDA, [JSON.stringify(rel.ddl)]);

    if (dryRun) await c.query("ROLLBACK");
    else await c.query("COMMIT");
    return rel;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    rel.falha = err instanceof Error ? err.message : String(err);
    return rel;
  } finally {
    c.release();
    await pool.end();
  }
}

// ---------------------------------------------------------------------------
// bridge-up
// ---------------------------------------------------------------------------

/**
 * Um statement estrutural levantado de uma migration, pelo nome do objeto.
 *
 * Reaproveitar o texto da migration é o que garante que a definição restaurada
 * é **a mesma** — um índice parcial reescrito à mão aqui divergiria em silêncio,
 * que é exatamente o defeito que `CREATE INDEX IF NOT EXISTS` não pega.
 *
 * Cada statement levantado passa por `mexeEmDados`: se carregar `INSERT`,
 * `UPDATE` ou `DELETE` fora de corpo de função, o `up` aborta em vez de
 * reaplicar transformação de dado que não é dele.
 */
function levantar(tag: string, marca: RegExp): string {
  const m = readMigrations().find((x) => x.tag === tag);
  if (!m) throw new BridgeAbortou(`migration ${tag} não encontrada`);
  const achados = m.statements.filter((s) => marca.test(s));
  if (achados.length !== 1) {
    throw new BridgeAbortou(
      `esperava 1 statement casando ${marca} em ${tag}, achei ${achados.length}`,
    );
  }
  const sql = achados[0]!;
  if (mexeEmDados([sql])) {
    throw new BridgeAbortou(
      `o statement de ${tag} casado por ${marca} mexe em dados; o bridge-up só restaura estrutura`,
    );
  }
  return sql;
}

/**
 * O plano de restauração, nominal e ordenado.
 *
 * Não é "reexecutar a 0013 até a 0018": é uma lista de objetos, cada um com a
 * definição que a sua migration proprietária lhe dá. Nenhum backfill, nenhuma
 * fusão, nenhuma validação de dado histórico é reaplicada.
 */
export interface PassoUp {
  objeto: string;
  sql: string;
  /** A migration dona do objeto. O `up` só o restaura se ela estiver registrada. */
  migration: string;
  /**
   * O passo repovoa uma tabela derivada, e por isso escreve linhas.
   *
   * É a única exceção à regra "o `up` só restaura estrutura", e ela é estreita
   * de propósito: vale apenas para as tabelas de `TABELAS_DERIVADAS`, cujo
   * conteúdo inteiro é uma consulta sobre o canônico, e o statement é levantado
   * da migration proprietária em vez de reescrito aqui. Marcar em vez de
   * esconder é o que permite ao relatório dizer quantos passos escrevem.
   */
  reconstroiDados?: true;
}

/**
 * O statement que repovoa uma tabela derivada, levantado do disco.
 *
 * Gêmeo de `levantar`, com a condição invertida: aqui o statement **tem** de
 * mexer em dados, senão não é reconstrução e a lista está errada. A conferência
 * existe para que trocar o `INSERT` da migration por outra coisa quebre este
 * caminho em vez de deixar a tabela silenciosamente vazia depois do `up`.
 */
function reconstruir(tag: string, marca: RegExp): string {
  const m = readMigrations().find((x) => x.tag === tag);
  if (!m) throw new BridgeAbortou(`migration ${tag} não encontrada`);
  const achados = m.statements.filter((s) => marca.test(s));
  if (achados.length !== 1) {
    throw new BridgeAbortou(
      `esperava 1 statement casando ${marca} em ${tag}, achei ${achados.length}`,
    );
  }
  const sql = achados[0]!;
  if (!mexeEmDados([sql])) {
    throw new BridgeAbortou(
      `o statement de ${tag} casado por ${marca} não repovoa nada; uma tabela derivada sem reconstrução ficaria vazia depois do up`,
    );
  }
  return sql;
}

function planoUp(): PassoUp[] {
  const p: PassoUp[] = [];
  const add = (migration: string, objeto: string, sql: string) =>
    p.push({ objeto, sql, migration });

  const M13 = "0013_chamados_por_parametro";
  const M14 = "0014_chamados_formato_real";
  const M15 = "0015_canonical_identity";
  const M16 = "0016_canonical_identity_enforcement";
  const M17 = "0017_fato_herdado";
  const M18 = "0018_identidade_forte";
  const M19 = "0019_assistant_feedback";
  const M20 = "0020_chamados_exclusao";

  // 1. Desfaz o estado legado que o `down` recriou. Quem o desfaz é a `0013`.
  for (const col of COLUNAS_LEGADAS_TICKET) {
    add(M13, `ticket.${col.nome}`, `ALTER TABLE "ticket" DROP COLUMN IF EXISTS "${col.nome}" RESTRICT`);
  }
  add(M13, "índice ticket_attribute_idx", `DROP INDEX IF EXISTS "ticket_attribute_idx" RESTRICT`);
  for (const i of ["snapshot_business_key_uq", "snapshot_business_key_live_uq"]) {
    add(M16, `índice ${i}`, `DROP INDEX IF EXISTS "${i}" RESTRICT`);
  }

  // 2. Colunas, com a definição da migration proprietária.
  add(M13, "ticket.changed_parameter_count", levantar(M13, /ADD COLUMN IF NOT EXISTS "changed_parameter_count"/));
  add(M13, "ticket_import.parameter_columns", levantar(M13, /ADD COLUMN IF NOT EXISTS "parameter_columns"/));
  add(M14, "ticket.vigencia_label", levantar(M14, /ADD COLUMN IF NOT EXISTS "vigencia_label"/));
  add(M14, "ticket.entity_description", levantar(M14, /ADD COLUMN IF NOT EXISTS "entity_description"/));
  add(M17, "fact.inherited_from_snapshot_id", levantar(M17, /ADD COLUMN IF NOT EXISTS "inherited_from_snapshot_id"/));

  // 3. Tabelas e o que vem com elas.
  add(M13, "ticket_change", levantar(M13, /CREATE TABLE IF NOT EXISTS "ticket_change"/));
  add(M13, "FKs de ticket_change", levantar(M13, /ticket_change_ticket_id_ticket_id_fk/));
  for (const i of [
    "ticket_change_grain_uq",
    "ticket_change_import_idx",
    "ticket_change_ticket_idx",
    "ticket_change_attribute_idx",
    "ticket_change_parameter_idx",
  ]) {
    add(M13, `índice ${i}`, levantar(M13, new RegExp(`INDEX IF NOT EXISTS "${i}"`)));
  }
  add(M14, "ticket_change.change_kind", levantar(M14, /ADD COLUMN IF NOT EXISTS "change_kind"/));
  add(M14, "índice ticket_change_kind_idx", levantar(M14, /INDEX IF NOT EXISTS "ticket_change_kind_idx"/));
  add(M14, "índice ticket_vigencia_idx", levantar(M14, /INDEX IF NOT EXISTS "ticket_vigencia_idx"/));
  add(M17, "índice fact_inherited_idx", levantar(M17, /INDEX IF NOT EXISTS "fact_inherited_idx"/));
  add(M16, "snapshot_merge", levantar(M16, /CREATE TABLE IF NOT EXISTS "snapshot_merge"/));
  add(M16, "import_decision", levantar(M16, /CREATE TABLE IF NOT EXISTS "import_decision"/));
  for (const i of ["import_decision_run_idx", "import_decision_key_idx", "import_decision_sha_idx"]) {
    add(M16, `índice ${i}`, levantar(M16, new RegExp(`INDEX IF NOT EXISTS "${i}"`)));
  }

  // 4. A identidade canônica. As funções vêm primeiro: a coluna gerada e as
  //    views as chamam, e `CREATE OR REPLACE FUNCTION` é idempotente.
  for (const f of FUNCOES_REMOVIDAS) {
    add(M15, `função ${f}`, levantar(M15, new RegExp(`CREATE OR REPLACE FUNCTION ${f}\\(`)));
  }
  add(M15, "snapshot.canonical_snapshot_key", levantar(M15, /ADD COLUMN "canonical_snapshot_key" text/));
  add(M15, "índice snapshot_canonical_key_idx", levantar(M15, /snapshot_canonical_key_idx/));
  add(M16, "índices únicos da identidade", levantar(M16, /snapshot_canonical_live_uq/));
  for (const v of VIEWS_REMOVIDAS) {
    // O `DROP` antes do `CREATE` é o que torna o `up` repetível: a `0015` tem
    // os dois como statements separados, e levantar só o `CREATE` faria a
    // segunda execução morrer em `relation already exists`.
    add(M15, `view ${v}`, `DROP VIEW IF EXISTS "${v}" RESTRICT`);
    add(M15, `view ${v}`, levantar(M15, new RegExp(`CREATE VIEW "${v}"`)));
  }

  // A `0020` — a função antes do gatilho que a chama, e a tabela antes dos dois.
  add(
    M20,
    "função freightcheck_ticket_import_deletion_is_immutable",
    levantar(M20, /CREATE OR REPLACE FUNCTION freightcheck_ticket_import_deletion_is_immutable\(/),
  );
  add(M20, "ticket_import_deletion", levantar(M20, /CREATE TABLE IF NOT EXISTS "ticket_import_deletion"/));
  for (const i of [
    "ticket_import_deletion_deleted_at_idx",
    "ticket_import_deletion_sha256_idx",
  ]) {
    add(M20, `índice ${i}`, levantar(M20, new RegExp(`INDEX IF NOT EXISTS "${i}"`)));
  }
  add(
    M20,
    "gatilho ticket_import_deletion_immutable",
    levantar(M20, /CREATE TRIGGER ticket_import_deletion_immutable/),
  );

  // A `0019` — presente só em bancos que chegaram até ela.
  for (const col of ["feedback", "feedback_note", "feedback_at"]) {
    add(M19, `assistant_message.${col}`, levantar(M19, new RegExp(`ADD COLUMN IF NOT EXISTS "${col}"`)));
  }
  add(M19, "assistant_message_feedback_ck", levantar(M19, /DROP CONSTRAINT IF EXISTS "assistant_message_feedback_ck"/));
  add(M19, "assistant_message_feedback_ck", levantar(M19, /ADD CONSTRAINT\s+"assistant_message_feedback_ck"/));

  // A `0021` — as duas tabelas da cobertura. `snapshot_entity_type` volta
  // estrutura primeiro e conteúdo depois, com o próprio backfill da migration:
  // é a única escrita de linha do plano, e ela é marcada como tal.
  const M21 = "0021_cobertura";
  add(M21, "coverage_expectation", levantar(M21, /CREATE TABLE IF NOT EXISTS "coverage_expectation"/));
  for (const i of ["coverage_expectation_lookup_idx", "coverage_expectation_attribute_idx"]) {
    add(M21, `índice ${i}`, levantar(M21, new RegExp(`INDEX IF NOT EXISTS "${i}"`)));
  }
  add(M21, "índice fact_nao_aplicavel_idx", levantar(M21, /INDEX IF NOT EXISTS "fact_nao_aplicavel_idx"/));
  add(M21, "snapshot_entity_type", levantar(M21, /CREATE TABLE IF NOT EXISTS "snapshot_entity_type"/));
  add(M21, "FK de snapshot_entity_type", levantar(M21, /snapshot_entity_type_snapshot_id_snapshot_id_fk/));
  for (const i of ["snapshot_entity_type_uq", "snapshot_entity_type_type_idx"]) {
    add(M21, `índice ${i}`, levantar(M21, new RegExp(`INDEX IF NOT EXISTS "${i}"`)));
  }
  p.push({
    migration: M21,
    objeto: "snapshot_entity_type (reconstrução)",
    sql: reconstruir(M21, /INSERT INTO "snapshot_entity_type"/),
    reconstroiDados: true,
  });

  // A `0022` — o significado escrito pelo curador. Duas colunas de texto e nada
  // mais: sem índice, sem constraint, sem backfill. A tabela é nomeada dentro
  // da marca porque as duas linhas são idênticas fora dela, e `levantar` exige
  // casar exatamente um statement.
  const M22 = "0022_significado";
  for (const t of ["attribute", "attribute_semantics"]) {
    add(
      M22,
      `${t}.definition`,
      levantar(M22, new RegExp(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "definition"`)),
    );
  }

  // A `0023` — a coerência entre unidade, tipo e agregação. A normalização vem
  // junto e antes: a constraint não anexa sobre a linha que a viola, e o export
  // real tem duas (os dois `prazoPagamento`, tipo UNKNOWN com média proposta).
  const M23 = "0023_semantica_coerente";
  // A normalização vem primeiro e é escrita de linha, como o backfill da 0021:
  // a constraint não anexa sobre a linha que a viola, e o `up` precisa da mesma
  // ordem que a migration teve.
  p.push({
    migration: M23,
    objeto: "agregações impossíveis, normalizadas antes da trava",
    sql: reconstruir(M23, /UPDATE "attribute"/),
    reconstroiDados: true,
  });
  for (const t of ["attribute", "attribute_semantics"]) {
    const nome = t === "attribute" ? "attribute_semantica_coerente" : "attribute_semantics_semantica_coerente";
    add(M23, `${nome} (drop)`, levantar(M23, new RegExp(`ALTER TABLE "${t}" DROP CONSTRAINT IF EXISTS "${nome}"`)));
    add(M23, nome, levantar(M23, new RegExp(`ALTER TABLE "${t}" ADD CONSTRAINT "${nome}"`)));
  }


  // A `0026` — a leitura econômica. Mesma forma da `0022`: quatro colunas de
  // texto, sem índice, sem constraint, sem backfill. A tabela **e** a coluna
  // entram na marca porque as quatro linhas só diferem nesses dois pontos, e
  // `levantar` exige casar exatamente um statement.
  //
  // Ela já foi renumerada duas vezes, e as duas pela mesma causa: nasceu `0023`
  // e a `main` avançou com `0023_semantica_coerente`; virou `0025` e a `main`
  // avançou com `0025_semantica_inicial`. Um branch longo colide com o próximo
  // número livre toda vez que a fila anda.
  //
  // Da segunda vez o `_journal.json` ficou impecável e este literal continuou
  // apontando para o número velho: `levantar` procura a migration pelo nome,
  // não a encontra, e o plano de restauração inteiro falha — onze casos do
  // `bridge` de uma vez, com uma mensagem que não diz "renumeração". A fila
  // conhece os índices; ela não conhece quem escreveu o nome numa string.
  const M26 = "0026_direcao_economica";
  for (const t of ["attribute", "attribute_semantics"]) {
    for (const col of ["economic_direction", "economic_effect"]) {
      add(
        M26,
        `${t}.${col}`,
        levantar(M26, new RegExp(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "${col}"`)),
      );
    }
  }

  // 5. Obrigatoriedade e constraints.
  //    Os valores nunca saíram: o `down` só afrouxou o NOT NULL.
  for (const [t, col] of NULLABLE_TEMPORARIO) {
    add(M15, `${t}.${col} NOT NULL`, `ALTER TABLE "${t}" ALTER COLUMN "${col}" SET NOT NULL`);
  }
  add(M18, "constraints da identidade", levantar(M18, /snapshot_canonical_scope_nao_vazio_ck/));

  return p;
}

export async function bridgeUp(connectionString: string): Promise<BridgeReport> {
  const pool = new pg.Pool({ connectionString });
  const c = await pool.connect();
  const rel: BridgeReport = {
    precondicoes: [],
    dependencias: [],
    ddl: [],
    verificacao: [],
    dryRun: false,
  };

  try {
    /*
      O `up` restaura **o que o `down` removeu**, e nada além disso.

      A diferença não é acadêmica. Development real tem dezenove carimbos, o
      último da `0018`: a `0019` está no disco e não no banco. Um `up` que
      aplicasse o plano inteiro criaria as colunas de feedback e o CHECK dela, e
      Development terminaria com schema de `0019` e registro de `0018` — um
      estado que nenhuma das duas autoridades reconhece, e exatamente o tipo de
      divergência que este trabalho existe para fechar.

      Por isso cada passo carrega a migration que o possui, e só entra se ela
      estiver registrada. O que ficou de fora não se perde: é a fila que o
      aplica, por `runMigrations()`, que é quem tem autoridade para isso — e aí
      schema e registro avançam juntos.
    */
    const { rows: carimbos } = await c.query<{ created_at: string }>(
      `SELECT created_at FROM "drizzle"."__drizzle_migrations"`,
    );
    const aplicadas = new Set(carimbos.map((r) => Number(r.created_at)));
    const registrada = new Map(
      readMigrations().map((m) => [m.tag, aplicadas.has(m.when)]),
    );

    const plano = planoUp();
    const aFazer = plano.filter((p) => registrada.get(p.migration) === true);
    const adiadas = [
      ...new Set(plano.filter((p) => !aFazer.includes(p)).map((p) => p.migration)),
    ];

    const reconstroem = aFazer.filter((p) => p.reconstroiDados).length;
    rel.precondicoes.push({
      nome: "plano estrutural",
      ok: true,
      detalhe:
        `${aFazer.length} de ${plano.length} objetos, ` +
        (reconstroem === 0
          ? "nenhum statement mexe em dados"
          : `${reconstroem} repovoa(m) tabela derivada e nenhum outro mexe em dados`),
    });
    if (adiadas.length > 0) {
      rel.precondicoes.push({
        nome: "adiado para a fila",
        ok: true,
        detalhe: `${adiadas.join(", ")} não está registrada — quem a aplica é runMigrations()`,
      });
    }

    await c.query("BEGIN");
    for (const passo of aFazer) {
      rel.ddl.push(`-- ${passo.objeto}`);
      await c.query(passo.sql);
    }

    /*
      As duas únicas escritas do `up`, e as duas só tocam linha cuja coluna
      **este script acabou de criar** — portanto toda ela `NULL`. Não é
      reaplicação do backfill da `0013`: é o valor canônico da coluna que o
      `down` removeu, devolvido junto com ela. Com `ticket` vazio, é no-op.
    */
    if (await existeColuna(c, "ticket", "changed_parameter_count")) {
      await c.query(
        `UPDATE "ticket" t SET "changed_parameter_count" =
           (SELECT count(*) FROM "ticket_change" tc WHERE tc."ticket_id" = t."id")
          WHERE t."changed_parameter_count" IS NULL`,
      );
      await c.query(`ALTER TABLE "ticket" ALTER COLUMN "changed_parameter_count" SET DEFAULT 0`);
      await c.query(`ALTER TABLE "ticket" ALTER COLUMN "changed_parameter_count" SET NOT NULL`);
    }
    if (await existeColuna(c, "ticket_import", "parameter_columns")) {
      await c.query(
        `UPDATE "ticket_import" SET "parameter_columns" = '[]'::jsonb WHERE "parameter_columns" IS NULL`,
      );
      await c.query(`ALTER TABLE "ticket_import" ALTER COLUMN "parameter_columns" SET DEFAULT '[]'::jsonb`);
      await c.query(`ALTER TABLE "ticket_import" ALTER COLUMN "parameter_columns" SET NOT NULL`);
    }

    /*
      O `up` concluiu: não há mais bridge pendente. Some junto com a restauração
      e pela mesma razão do `down` — se o `up` abortar, o marcador continua lá,
      que é a resposta certa para um bridge que ainda não terminou.
    */
    await c.query(LIMPAR_MARCADOR);

    await c.query("COMMIT");
    rel.verificacao.push({
      nome: "restauração aplicada",
      ok: true,
      detalhe: `${aFazer.length} objetos restaurados${
        adiadas.length > 0 ? `, ${adiadas.length} migration(s) adiada(s) para a fila` : ""
      }`,
    });
    return rel;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    rel.falha = err instanceof Error ? err.message : String(err);
    return rel;
  } finally {
    c.release();
    await pool.end();
  }
}
