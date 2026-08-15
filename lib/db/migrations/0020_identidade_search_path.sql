-- ---------------------------------------------------------------------------
-- A identidade canônica deixa de depender do `search_path` de quem chama.
-- ---------------------------------------------------------------------------
--
-- O que motivou esta migration
-- ----------------------------
-- Um deploy de produção parou com:
--
--     function freightcheck_snapshot_key(text, text, text, date, jsonb)
--     does not exist
--
-- no comando:
--
--     ALTER TABLE "snapshot" ADD COLUMN "canonical_snapshot_key" text
--     GENERATED ALWAYS AS (
--       freightcheck_snapshot_key(
--         source_system, dataset_family, canal, effective_date, canonical_scope)
--     ) STORED;
--
-- **Esse comando não está neste repositório.** A `0015` cria a mesma coluna com
-- os identificadores entre aspas (`"source_system"`, …), numa linha só, dentro
-- de um `DO $$` — e trezentas linhas *depois* de criar a função. A forma sem
-- aspas, quebrada em várias linhas e em caixa baixa, é exatamente o que
-- `pg_get_expr()` devolve ao ler a expressão de uma coluna gerada de um banco
-- vivo. Quer dizer: aquele DDL foi **derivado por introspecção do banco de
-- desenvolvimento** e aplicado em produção — a proposta de schema do Publishing,
-- que a `docs/MIGRATIONS.md` manda recusar. Ela copia a coluna gerada e não
-- copia as funções, porque o modelo de snapshot do drizzle não representa
-- função nenhuma. Em produção, que ainda não tinha rodado a `0015`, não havia o
-- que a coluna chama.
--
-- A causa raiz é essa, e ela se resolve recusando a proposta. O que esta
-- migration conserta é o **defeito que aquele acidente expôs**, e que continua
-- de pé mesmo quando tudo é aplicado pela fila versionada.
--
-- O defeito
-- ---------
-- As onze funções da identidade nasceram na `0015` sem `SET search_path`. Numa
-- função `LANGUAGE sql` de corpo textual, os nomes de dentro do corpo são
-- resolvidos **na primeira chamada de cada sessão**, com o `search_path` de
-- quem chamou — não com o de quem a criou. Medido:
--
--     SET search_path = '';
--     SELECT public.freightcheck_snapshot_key('FREIGHTEC','X','E','2026-08-01','[]');
--     ERROR:  function freightcheck_norm_canal(text) does not exist
--     CONTEXT:  SQL function "freightcheck_snapshot_key" during startup
--
-- E `freightcheck_snapshot_key` não é chamada só por quem quer: ela é a
-- expressão da coluna **gerada** `snapshot.canonical_snapshot_key`, avaliada em
-- todo `INSERT` e todo `UPDATE` da tabela; e `freightcheck_canonical_scope` é a
-- expressão do `CHECK snapshot_canonical_scope_ck`, avaliada nas mesmas horas.
-- Uma conexão cujo `search_path` não inclua `public` — um pooler que o
-- redefine, um papel de deploy com `search_path` próprio, um cliente que
-- qualifica as tabelas e zera o resto — não perde uma consulta: perde o caminho
-- de escrita inteiro de `snapshot`, com uma mensagem que fala de uma função
-- interna que ninguém chamou.
--
-- Aqui cada uma delas passa a carregar o próprio `search_path`. O corpo é o
-- mesmo, byte a byte; muda só o `SET`. `CREATE OR REPLACE` substitui no lugar,
-- de modo que o OID não muda — e a expressão gravada da coluna gerada, que
-- guarda o OID e não o nome, continua apontando para a mesma função. Nenhuma
-- linha é reescrita, nenhum índice é refeito.
--
-- Por que não bastou reescrever a `0015`
-- --------------------------------------
-- Migration já aplicada não roda de novo: o registro é por carimbo. Um banco de
-- desenvolvimento que já passou pela `0015` ficaria com as funções antigas para
-- sempre, e produção com as novas — que é a divergência que a
-- `docs/MIGRATIONS.md` existe para impedir. Esta migration vale para os dois:
-- onde as funções já estão pinadas ela confere e não faz nada; onde não estão,
-- ela pina. É o mesmo desenho da `0018` em relação à `0015`.
--
-- O trade-off, dito: uma função com `SET` não é mais *inlineável* pelo
-- planejador. Todas estas já eram avaliadas linha a linha (coluna gerada,
-- `CHECK`), e o backfill que as usa em massa roda uma vez; a correção vale o
-- preço.

-- ---------------------------------------------------------------------------
-- 1. As funções têm de estar aqui — esta migration não as cria do zero
-- ---------------------------------------------------------------------------
-- `CREATE OR REPLACE` criaria uma função nova, silenciosamente, num banco em
-- que a `0015` não tivesse rodado. Um banco assim não é um banco a consertar
-- daqui: é um banco cuja `0015` falhou ou foi adotada sem ter rodado, e a
-- resposta certa é dizer isso, não fabricar metade do que falta.
DO $$
DECLARE
  faltando text;
BEGIN
  SELECT string_agg(esperada.assinatura, E'\n  ' ORDER BY esperada.assinatura)
    INTO faltando
    FROM (VALUES
      ('freightcheck_sem_acento(text)'),
      ('freightcheck_norm_documento(text)'),
      ('freightcheck_norm_identificador(text)'),
      ('freightcheck_norm_scope_code(text, text)'),
      ('freightcheck_norm_canal(text)'),
      ('freightcheck_canal_do_rotulo(text)'),
      ('freightcheck_dataset_family(text)'),
      ('freightcheck_canonical_scope(jsonb)'),
      ('freightcheck_serialize_scope(jsonb)'),
      ('freightcheck_iso_date(date)'),
      ('freightcheck_snapshot_key(text, text, text, date, jsonb)')
    ) AS esperada(assinatura)
   WHERE to_regprocedure('public.' || esperada.assinatura) IS NULL;

  IF faltando IS NOT NULL THEN
    RAISE EXCEPTION
      E'Funções da identidade canônica ausentes em "public":\n  %\n\nEsta migration só endurece o que a 0015 criou; ela não cria a identidade do zero, porque um banco sem estas funções também não tem o backfill nem a fusão que vêm junto com elas. Confira o registro em drizzle.__drizzle_migrations e rode a fila versionada. Nada foi alterado.',
      faltando
      USING ERRCODE = 'data_exception';
  END IF;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. As mesmas onze funções, agora com o `search_path` pinado
-- ---------------------------------------------------------------------------
-- Os corpos são cópia literal da `0015`. Se um deles precisar mudar um dia, a
-- mudança é uma migration nova — e o teste `canonical-identity-sql.test.ts`
-- continua sendo quem prende SQL e TypeScript ao mesmo resultado.
--
-- `pg_catalog` vem escrito na frente de propósito: ele é procurado antes de
-- qualquer coisa mesmo quando não é nomeado, e nomeá-lo deixa a ordem visível
-- para quem lê em vez de implícita.

CREATE OR REPLACE FUNCTION freightcheck_sem_acento(v text)
RETURNS text AS $$
  SELECT translate(
    coalesce(v, ''),
    'áàâãäåÁÀÂÃÄÅéèêëÉÈÊËíìîïÍÌÎÏóòôõöÓÒÔÕÖúùûüÚÙÛÜçÇñÑýÿÝšŠžŽłŁđĐ',
    'aaaaaaAAAAAAeeeeEEEEiiiiIIIIooooo' || 'OOOOOuuuuUUUUcCnNyyYsSzZlLdD'
  );
$$ LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog, public;--> statement-breakpoint

CREATE OR REPLACE FUNCTION freightcheck_norm_documento(v text)
RETURNS text AS $$
  SELECT CASE
    WHEN d = '' THEN ''
    WHEN length(d) BETWEEN 12 AND 14 THEN lpad(d, 14, '0')
    WHEN length(d) BETWEEN 9 AND 11 THEN lpad(d, 11, '0')
    ELSE d
  END
  FROM (SELECT regexp_replace(coalesce(v, ''), '[^0-9]', '', 'g') AS d) s;
$$ LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public;--> statement-breakpoint

CREATE OR REPLACE FUNCTION freightcheck_norm_identificador(v text)
RETURNS text AS $$
  SELECT regexp_replace(upper(freightcheck_sem_acento(coalesce(v, ''))), '[^A-Z0-9]', '', 'g');
$$ LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public;--> statement-breakpoint

CREATE OR REPLACE FUNCTION freightcheck_norm_scope_code(scope_type text, v text)
RETURNS text AS $$
  SELECT CASE upper(btrim(coalesce(scope_type, '')))
    WHEN 'UNIDADE' THEN freightcheck_norm_documento(v)
    WHEN 'OPERADOR' THEN freightcheck_norm_documento(v)
    ELSE btrim(regexp_replace(upper(freightcheck_sem_acento(coalesce(v, ''))), '[^A-Z0-9]+', ' ', 'g'))
  END;
$$ LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public;--> statement-breakpoint

CREATE OR REPLACE FUNCTION freightcheck_norm_canal(v text)
RETURNS text AS $$
  SELECT btrim(
    regexp_replace(upper(freightcheck_sem_acento(coalesce(v, ''))), '[^A-Z0-9]+', '_', 'g'),
    '_'
  );
$$ LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public;--> statement-breakpoint

CREATE OR REPLACE FUNCTION freightcheck_canal_do_rotulo(label text)
RETURNS text AS $$
  SELECT freightcheck_norm_canal(
    coalesce(
      substring(btrim(coalesce(label, '')) from '^([A-Za-z][A-Za-z0-9_]*)_[0-9]{1,2}_[0-9]{1,2}_[0-9]{4}$'),
      btrim(coalesce(label, ''))
    )
  );
$$ LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public;--> statement-breakpoint

CREATE OR REPLACE FUNCTION freightcheck_dataset_family(entity_type_set text)
RETURNS text AS $$
  SELECT 'REMUNERACAO_EQUIPAMENTO'::text;
$$ LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public;--> statement-breakpoint

CREATE OR REPLACE FUNCTION freightcheck_canonical_scope(scope jsonb)
RETURNS jsonb AS $$
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object('scopeType', t, 'code', c)
      ORDER BY t COLLATE "C", c COLLATE "C"
    ),
    '[]'::jsonb
  )
  FROM (
    SELECT DISTINCT
      upper(btrim(e ->> 'scopeType')) AS t,
      freightcheck_norm_scope_code(e ->> 'scopeType', e ->> 'code') AS c
    FROM jsonb_array_elements(coalesce(scope, '[]'::jsonb)) e
  ) s
  WHERE t <> '' AND c <> '';
$$ LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public;--> statement-breakpoint

CREATE OR REPLACE FUNCTION freightcheck_serialize_scope(scope jsonb)
RETURNS text AS $$
  SELECT coalesce(
    string_agg(
      (e ->> 'scopeType') || chr(30) || (e ->> 'code'),
      chr(29) ORDER BY (e ->> 'scopeType') COLLATE "C", (e ->> 'code') COLLATE "C"
    ),
    ''
  )
  FROM jsonb_array_elements(coalesce(scope, '[]'::jsonb)) e;
$$ LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public;--> statement-breakpoint

CREATE OR REPLACE FUNCTION freightcheck_iso_date(d date)
RETURNS text AS $$
  SELECT lpad(extract(year from d)::int::text, 4, '0') || '-'
      || lpad(extract(month from d)::int::text, 2, '0') || '-'
      || lpad(extract(day from d)::int::text, 2, '0');
$$ LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog, public;--> statement-breakpoint

CREATE OR REPLACE FUNCTION freightcheck_snapshot_key(
  source_system text,
  dataset_family text,
  canal text,
  effective_date date,
  canonical_scope jsonb
)
RETURNS text AS $$
  SELECT encode(
    sha256(convert_to(
      upper(btrim(coalesce(source_system, ''))) || chr(31) ||
      upper(btrim(coalesce(dataset_family, ''))) || chr(31) ||
      freightcheck_norm_canal(canal) || chr(31) ||
      freightcheck_iso_date(effective_date) || chr(31) ||
      freightcheck_serialize_scope(canonical_scope),
      'UTF8'
    )),
    'hex'
  );
$$ LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. A prova de que nada mudou de valor
-- ---------------------------------------------------------------------------
-- Substituir o corpo de uma função de que uma coluna gerada depende é a
-- operação com maior potencial de estrago desta migration: o Postgres **não**
-- recalcula a coluna nem revalida o `CHECK` depois de um `CREATE OR REPLACE`.
-- Se a substituição tivesse mudado o resultado de alguma linha, o banco ficaria
-- com um valor gravado que a expressão de hoje não produz — e ninguém saberia
-- até a próxima escrita.
--
-- Por isso a conferência é linha a linha, contra o valor **gravado**: recalcula
-- a chave de cada vigência com as funções novas e compara com o que está lá. Um
-- único desencontro aborta a migration inteira, e a transação leva junto a
-- substituição das onze funções — o banco volta ao que era.
--
-- Custo: uma varredura de `snapshot`, que é uma tabela de vigências (dezenas a
-- milhares de linhas), não de fatos.
DO $$
DECLARE
  divergentes text;
  quantas     integer;
BEGIN
  WITH conferencia AS (
    SELECT s."id", s."source_label",
           s."canonical_snapshot_key" AS gravada,
           freightcheck_snapshot_key(
             s."source_system", s."dataset_family", s."canal",
             s."effective_date", s."canonical_scope") AS recalculada
      FROM "snapshot" s
  ),
  diferentes AS (
    SELECT * FROM conferencia WHERE gravada IS DISTINCT FROM recalculada
  )
  SELECT
    (SELECT count(*) FROM diferentes),
    (SELECT string_agg(
              format('id=%s rótulo=%L gravada=%s recalculada=%s',
                     "id", "source_label", gravada, recalculada),
              E'\n  ' ORDER BY "source_label", "id")
       FROM (SELECT * FROM diferentes ORDER BY "source_label", "id" LIMIT 20) x)
    INTO quantas, divergentes;

  IF quantas > 0 THEN
    RAISE EXCEPTION
      E'Pinar o search_path mudou a identidade de % vigência(s):\n  %\n\nOs corpos das funções eram para ser cópia literal da 0015. Se a chave mudou, eles não são — e trocá-los mudaria a identidade de dados já gravados sem que ninguém tenha decidido isso. Nada foi alterado.',
      quantas, divergentes
      USING ERRCODE = 'data_exception';
  END IF;
END $$;--> statement-breakpoint

-- O mesmo para o `CHECK` da forma canônica do escopo, que também chama uma
-- destas funções e também não é revalidado sozinho.
DO $$
DECLARE
  fora text;
BEGIN
  SELECT string_agg(format('id=%s rótulo=%L', s."id", s."source_label"), E'\n  '
                    ORDER BY s."source_label", s."id")
    INTO fora
    FROM "snapshot" s
   WHERE s."canonical_scope" IS DISTINCT FROM freightcheck_canonical_scope(s."canonical_scope");

  IF fora IS NOT NULL THEN
    RAISE EXCEPTION
      E'O escopo canônico de vigências já gravadas deixou de satisfazer snapshot_canonical_scope_ck depois da substituição:\n  %\n\nNada foi alterado.',
      fora
      USING ERRCODE = 'data_exception';
  END IF;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. A prova de que o `search_path` deixou de importar
-- ---------------------------------------------------------------------------
-- A conferência acima roda com o `search_path` da migration, que é o normal e
-- por isso não prova nada sobre o defeito. Esta roda com ele zerado, que é o
-- caso que quebrava: se alguma das onze ficou sem `SET`, a chamada abaixo falha
-- aqui — dentro da transação, com a substituição ainda desfeita — em vez de
-- falhar meses depois, no `INSERT` de um cliente com o `search_path` de outro
-- jeito.
DO $$
DECLARE
  conferida text;
BEGIN
  PERFORM set_config('search_path', '', true);
  SELECT public.freightcheck_snapshot_key(
           'FREIGHTEC', 'REMUNERACAO_EQUIPAMENTO', 'EMPURRADA', DATE '2026-08-01',
           '[{"scopeType": "UNIDADE", "code": "12345678000199"}]'::jsonb)
    INTO conferida;
  PERFORM set_config('search_path', 'pg_catalog, public', true);

  IF conferida IS NULL OR conferida !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION
      'A identidade canônica não se calcula com search_path vazio; alguma das funções ficou sem SET search_path. Nada foi alterado.'
      USING ERRCODE = 'data_exception';
  END IF;
END $$;--> statement-breakpoint

COMMENT ON FUNCTION freightcheck_snapshot_key(text, text, text, date, jsonb) IS
  'A identidade canônica de uma vigência: sistema, família, canal, data e escopo, normalizados e reduzidos a um SHA-256. É a expressão da coluna gerada snapshot.canonical_snapshot_key — avaliada em todo INSERT — e por isso carrega search_path próprio (0020). Ver 0015_canonical_identity.sql.';
