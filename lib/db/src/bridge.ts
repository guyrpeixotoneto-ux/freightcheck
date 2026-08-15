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
 * Depois do deploy, `runMigrations()` leva Production de `0000` a `0019` — a
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

/** Tabelas que o `down` remove. Todas têm de estar vazias — é pré-condição. */
const TABELAS_REMOVIDAS = ["ticket_change", "snapshot_merge", "import_decision"];

/** Colunas que o `down` remove de tabelas que ficam. */
const COLUNAS_REMOVIDAS: [string, string][] = [
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
];

const INDICES_REMOVIDOS = [
  "snapshot_canonical_live_uq",
  "snapshot_canonical_revision_uq",
  "snapshot_canonical_key_idx",
  "fact_inherited_idx",
  "ticket_vigencia_idx",
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

const CHECKS_REMOVIDOS: [string, string][] = [
  ["snapshot", "snapshot_canal_nao_vazio_ck"],
  ["snapshot", "snapshot_dataset_family_nao_vazio_ck"],
  ["snapshot", "snapshot_canonical_scope_ck"],
  ["snapshot", "snapshot_canonical_scope_nao_vazio_ck"],
  ["assistant_message", "assistant_message_feedback_ck"],
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
      ...INDICES_REMOVIDOS,
      ...VIEWS_REMOVIDAS,
    ]);
    for (const alvo of [...TABELAS_REMOVIDAS, "snapshot"]) {
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
    for (const t of TABELAS_REMOVIDAS) {
      if (await existeTabela(c, t)) await exec(`DROP TABLE "${t}" RESTRICT`);
    }
    // Depois da coluna gerada e das views, nada mais depende delas. `RESTRICT`
    // continua sendo quem decide: se algo depender, o bridge cai aqui.
    for (const f of FUNCOES_REMOVIDAS) {
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

    for (const t of TABELAS_REMOVIDAS) {
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
function planoUp(): { objeto: string; sql: string }[] {
  const p: { objeto: string; sql: string }[] = [];
  const add = (objeto: string, sql: string) => p.push({ objeto, sql });

  // 1. Desfaz o estado legado que o `down` recriou.
  for (const col of COLUNAS_LEGADAS_TICKET) {
    add(`ticket.${col.nome}`, `ALTER TABLE "ticket" DROP COLUMN IF EXISTS "${col.nome}" RESTRICT`);
  }
  for (const i of INDICES_LEGADOS) {
    add(`índice ${i.nome}`, `DROP INDEX IF EXISTS "${i.nome}" RESTRICT`);
  }

  // 2. Colunas, com a definição da migration proprietária.
  add("ticket.changed_parameter_count", levantar("0013_chamados_por_parametro", /ADD COLUMN IF NOT EXISTS "changed_parameter_count"/));
  add("ticket_import.parameter_columns", levantar("0013_chamados_por_parametro", /ADD COLUMN IF NOT EXISTS "parameter_columns"/));
  add("ticket.vigencia_label", levantar("0014_chamados_formato_real", /ADD COLUMN IF NOT EXISTS "vigencia_label"/));
  add("ticket.entity_description", levantar("0014_chamados_formato_real", /ADD COLUMN IF NOT EXISTS "entity_description"/));
  add("fact.inherited_from_snapshot_id", levantar("0017_fato_herdado", /ADD COLUMN IF NOT EXISTS "inherited_from_snapshot_id"/));

  // 3. Tabelas e o que vem com elas.
  add("ticket_change", levantar("0013_chamados_por_parametro", /CREATE TABLE IF NOT EXISTS "ticket_change"/));
  add("FKs de ticket_change", levantar("0013_chamados_por_parametro", /ticket_change_ticket_id_ticket_id_fk/));
  for (const i of [
    "ticket_change_grain_uq",
    "ticket_change_import_idx",
    "ticket_change_ticket_idx",
    "ticket_change_attribute_idx",
    "ticket_change_parameter_idx",
  ]) {
    add(`índice ${i}`, levantar("0013_chamados_por_parametro", new RegExp(`INDEX IF NOT EXISTS "${i}"`)));
  }
  add("ticket_change.change_kind", levantar("0014_chamados_formato_real", /ADD COLUMN IF NOT EXISTS "change_kind"/));
  add("índice ticket_change_kind_idx", levantar("0014_chamados_formato_real", /INDEX IF NOT EXISTS "ticket_change_kind_idx"/));
  add("índice ticket_vigencia_idx", levantar("0014_chamados_formato_real", /INDEX IF NOT EXISTS "ticket_vigencia_idx"/));
  add("índice fact_inherited_idx", levantar("0017_fato_herdado", /INDEX IF NOT EXISTS "fact_inherited_idx"/));
  add("snapshot_merge", levantar("0016_canonical_identity_enforcement", /CREATE TABLE IF NOT EXISTS "snapshot_merge"/));
  add("import_decision", levantar("0016_canonical_identity_enforcement", /CREATE TABLE IF NOT EXISTS "import_decision"/));
  for (const i of ["import_decision_run_idx", "import_decision_key_idx", "import_decision_sha_idx"]) {
    add(`índice ${i}`, levantar("0016_canonical_identity_enforcement", new RegExp(`INDEX IF NOT EXISTS "${i}"`)));
  }

  // 4. A identidade canônica. As funções vêm primeiro: a coluna gerada e as
  //    views as chamam, e `CREATE OR REPLACE FUNCTION` é idempotente.
  for (const f of FUNCOES_REMOVIDAS) {
    add(`função ${f}`, levantar("0015_canonical_identity", new RegExp(`CREATE OR REPLACE FUNCTION ${f}\\(`)));
  }
  add("snapshot.canonical_snapshot_key", levantar("0015_canonical_identity", /ADD COLUMN "canonical_snapshot_key" text/));
  add("índice snapshot_canonical_key_idx", levantar("0015_canonical_identity", /snapshot_canonical_key_idx/));
  add("índices únicos da identidade", levantar("0016_canonical_identity_enforcement", /snapshot_canonical_live_uq/));
  for (const v of VIEWS_REMOVIDAS) {
    // O `DROP` antes do `CREATE` é o que torna o `up` repetível: a `0015` tem
    // os dois como statements separados, e levantar só o `CREATE` faria a
    // segunda execução morrer em `relation already exists`.
    add(`view ${v}`, `DROP VIEW IF EXISTS "${v}" RESTRICT`);
    add(`view ${v}`, levantar("0015_canonical_identity", new RegExp(`CREATE VIEW "${v}"`)));
  }

  // A `0019` — presente só em bancos que chegaram até ela.
  for (const col of ["feedback", "feedback_note", "feedback_at"]) {
    add(`assistant_message.${col}`, levantar("0019_assistant_feedback", new RegExp(`ADD COLUMN IF NOT EXISTS "${col}"`)));
  }
  add("assistant_message_feedback_ck", levantar("0019_assistant_feedback", /DROP CONSTRAINT IF EXISTS "assistant_message_feedback_ck"/));
  add("assistant_message_feedback_ck", levantar("0019_assistant_feedback", /ADD CONSTRAINT\s+"assistant_message_feedback_ck"/));

  // 5. Obrigatoriedade e constraints.
  //    Os valores nunca saíram: o `down` só afrouxou o NOT NULL.
  for (const [t, col] of NULLABLE_TEMPORARIO) {
    add(`${t}.${col} NOT NULL`, `ALTER TABLE "${t}" ALTER COLUMN "${col}" SET NOT NULL`);
  }
  add("constraints da identidade", levantar("0018_identidade_forte", /snapshot_canonical_scope_nao_vazio_ck/));

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
    const plano = planoUp();
    rel.precondicoes.push({
      nome: "plano estrutural",
      ok: true,
      detalhe: `${plano.length} objetos, nenhum statement mexe em dados`,
    });

    await c.query("BEGIN");
    for (const passo of plano) {
      rel.ddl.push(`-- ${passo.objeto}`);
      await c.query(passo.sql);
    }

    /*
      As duas únicas escritas do `up`, e as duas só tocam linha cuja coluna
      **este script acabou de criar** — portanto toda ela `NULL`. Não é
      reaplicação do backfill da `0013`: é o valor canônico da coluna que o
      `down` removeu, devolvido junto com ela. Com `ticket` vazio, é no-op.
    */
    await c.query(
      `UPDATE "ticket" t SET "changed_parameter_count" =
         (SELECT count(*) FROM "ticket_change" tc WHERE tc."ticket_id" = t."id")
        WHERE t."changed_parameter_count" IS NULL`,
    );
    await c.query(
      `UPDATE "ticket_import" SET "parameter_columns" = '[]'::jsonb WHERE "parameter_columns" IS NULL`,
    );
    for (const [t, col, def] of [
      ["ticket", "changed_parameter_count", "0"],
      ["ticket_import", "parameter_columns", "'[]'::jsonb"],
    ] as const) {
      await c.query(`ALTER TABLE "${t}" ALTER COLUMN "${col}" SET DEFAULT ${def}`);
      await c.query(`ALTER TABLE "${t}" ALTER COLUMN "${col}" SET NOT NULL`);
    }

    await c.query("COMMIT");
    rel.verificacao.push({
      nome: "restauração aplicada",
      ok: true,
      detalhe: `${plano.length} objetos`,
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
