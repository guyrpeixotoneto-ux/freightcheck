-- ---------------------------------------------------------------------------
-- A identidade canônica de uma vigência.
-- ---------------------------------------------------------------------------
--
-- A identidade de negócio vinha sendo derivada da *forma* como o dado chegou:
-- do rótulo como estava escrito (`EMPURRADA_1_8_2026` e `EMPURRADA_01_8_2026`
-- são a mesma data e davam chaves diferentes), das abas que o arquivo por acaso
-- trazia (`CAVALO` contra `CARRETA+CAVALO`) e das células de escopo que por
-- acaso estavam preenchidas (um CNPJ em branco mudava o hash). Cada uma dessas
-- variações abria uma **segunda vigência ativa** para a mesma realidade, e as
-- duas passavam pelo filtro de leitura — contando em dobro.
--
-- Aqui a identidade passa a ser (sistema, família, canal, data, escopo), toda
-- ela normalizada, e passa a ser calculada **pelo banco**: `canonical_snapshot_
-- key` é uma coluna gerada. Nenhum caminho da aplicação escreve esse valor, e
-- portanto nenhum erro futuro no TypeScript consegue produzir duas identidades
-- para o mesmo negócio.
--
-- Esta migration **não** cria o índice único: ela mede. O índice entra em
-- `0013`, depois que os conflitos históricos tiverem sido resolvidos por fusão,
-- sem apagar nada. Separar as duas é o que permite rodar o diagnóstico num
-- banco real e ler o estrago antes de mexer nele.

-- ---------------------------------------------------------------------------
-- 1. Estados novos da máquina de importação
-- ---------------------------------------------------------------------------
-- Duplicata não é erro técnico, e "arquivo repetido" não é a mesma coisa que
-- "dado repetido". Os valores entram aqui e só podem ser *usados* depois do
-- commit desta migration — por isso nada nesta migration os referencia.
ALTER TYPE "import_run_status" ADD VALUE IF NOT EXISTS 'SKIPPED_DUPLICATE_DATA';--> statement-breakpoint
ALTER TYPE "import_run_status" ADD VALUE IF NOT EXISTS 'VALIDATION_ERROR';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. As normalizações, em SQL
-- ---------------------------------------------------------------------------
-- Espelham `lib/ingest/src/canonical-identity.ts` byte a byte; o teste
-- `canonical-identity-sql.test.ts` prende os dois lados ao mesmo resultado.
-- Todas IMMUTABLE, que é o que permite usá-las numa coluna gerada e num índice.

-- Sem `unaccent`: é extensão, e uma extensão que falte no servidor de produção
-- transformaria a identidade num erro de deploy. `translate` cobre Latin-1 e o
-- essencial de Latin Extended-A, que é o que aparece em nome de regional.
CREATE OR REPLACE FUNCTION freightcheck_sem_acento(v text)
RETURNS text AS $$
  SELECT translate(
    coalesce(v, ''),
    'áàâãäåÁÀÂÃÄÅéèêëÉÈÊËíìîïÍÌÎÏóòôõöÓÒÔÕÖúùûüÚÙÛÜçÇñÑýÿÝšŠžŽłŁđĐ',
    'aaaaaaAAAAAAeeeeEEEEiiiiIIIIooooo' || 'OOOOOuuuuUUUUcCnNyyYsSzZlLdD'
  );
$$ LANGUAGE sql IMMUTABLE STRICT;--> statement-breakpoint

-- CNPJ/CPF: só dígitos, com os zeros à esquerda de volta. O Excel entrega o
-- mesmo CNPJ ora mascarado, ora como número — e como número ele perde o zero da
-- frente. Os dois são a mesma empresa e não podem gerar escopos diferentes.
CREATE OR REPLACE FUNCTION freightcheck_norm_documento(v text)
RETURNS text AS $$
  SELECT CASE
    WHEN d = '' THEN ''
    WHEN length(d) BETWEEN 12 AND 14 THEN lpad(d, 14, '0')
    WHEN length(d) BETWEEN 9 AND 11 THEN lpad(d, 11, '0')
    ELSE d
  END
  FROM (SELECT regexp_replace(coalesce(v, ''), '[^0-9]', '', 'g') AS d) s;
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint

-- Placa e chassi: `ABC-1D23`, `abc1d23` e ` ABC 1D23 ` são o mesmo veículo.
CREATE OR REPLACE FUNCTION freightcheck_norm_identificador(v text)
RETURNS text AS $$
  SELECT regexp_replace(upper(freightcheck_sem_acento(coalesce(v, ''))), '[^A-Z0-9]', '', 'g');
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint

CREATE OR REPLACE FUNCTION freightcheck_norm_scope_code(scope_type text, v text)
RETURNS text AS $$
  SELECT CASE upper(btrim(coalesce(scope_type, '')))
    WHEN 'UNIDADE' THEN freightcheck_norm_documento(v)
    WHEN 'OPERADOR' THEN freightcheck_norm_documento(v)
    ELSE btrim(regexp_replace(upper(freightcheck_sem_acento(coalesce(v, ''))), '[^A-Z0-9]+', ' ', 'g'))
  END;
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint

CREATE OR REPLACE FUNCTION freightcheck_norm_canal(v text)
RETURNS text AS $$
  SELECT btrim(
    regexp_replace(upper(freightcheck_sem_acento(coalesce(v, ''))), '[^A-Z0-9]+', '_', 'g'),
    '_'
  );
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint

-- O canal declarado pelo rótulo, na mesma gramática de `vigencia.ts`. Um rótulo
-- que não case com o padrão vira ele próprio o canal — assim dois rótulos que o
-- parser não entende continuam distintos, em vez de colapsarem num canal vazio
-- compartilhado.
CREATE OR REPLACE FUNCTION freightcheck_canal_do_rotulo(label text)
RETURNS text AS $$
  SELECT freightcheck_norm_canal(
    coalesce(
      substring(btrim(coalesce(label, '')) from '^([A-Za-z][A-Za-z0-9_]*)_[0-9]{1,2}_[0-9]{1,2}_[0-9]{4}$'),
      btrim(coalesce(label, ''))
    )
  );
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint

-- A família do dataset: o contrato da importação, não o que veio no arquivo.
-- CAVALO e CARRETA são componentes da mesma família. O padrão é inclusivo de
-- propósito — um equipamento novo tem de entrar como componente da vigência que
-- já existe, e não abrir uma segunda identidade ativa para a mesma data.
CREATE OR REPLACE FUNCTION freightcheck_dataset_family(entity_type_set text)
RETURNS text AS $$
  SELECT 'REMUNERACAO_EQUIPAMENTO'::text;
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint

-- O escopo em forma canônica: normalizado, sem vazios, sem repetição, ordenado.
-- A ordem é `COLLATE "C"` (ordem de byte) porque é a única que o TypeScript
-- reproduz sem depender de locale.
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
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint

-- A serialização que entra no hash. Não é JSON de propósito: a forma textual do
-- `jsonb` é decisão do servidor (espaço depois da vírgula, ordem das chaves,
-- escape de unicode) e muda entre versões. Separadores de controle — chr(30)
-- entre tipo e código, chr(29) entre entradas — não têm nenhuma dessas
-- ambiguidades.
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
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint

-- YYYY-MM-DD sem depender de DateStyle: `to_char` e `::text` são STABLE, não
-- IMMUTABLE, e uma coluna gerada exige IMMUTABLE.
CREATE OR REPLACE FUNCTION freightcheck_iso_date(d date)
RETURNS text AS $$
  SELECT lpad(extract(year from d)::int::text, 4, '0') || '-'
      || lpad(extract(month from d)::int::text, 2, '0') || '-'
      || lpad(extract(day from d)::int::text, 2, '0');
$$ LANGUAGE sql IMMUTABLE STRICT;--> statement-breakpoint

-- A chave canônica. chr(31) entre componentes, que não pode ocorrer em nenhum
-- deles depois de normalizados.
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
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. As colunas de identidade
-- ---------------------------------------------------------------------------
ALTER TABLE "snapshot" ADD COLUMN IF NOT EXISTS "dataset_family" text;--> statement-breakpoint
ALTER TABLE "snapshot" ADD COLUMN IF NOT EXISTS "canal" text;--> statement-breakpoint
ALTER TABLE "snapshot" ADD COLUMN IF NOT EXISTS "canonical_scope" jsonb;--> statement-breakpoint
-- Hash do conteúdo já normalizado. Serve para reconhecer "o arquivo é outro,
-- mas o dado é o mesmo" e não abrir revisão vazia. É nullable porque as
-- vigências históricas não o têm: quando falta, a comparação é feita contra os
-- fatos do próprio snapshot, que é a verdade de origem.
ALTER TABLE "snapshot" ADD COLUMN IF NOT EXISTS "canonical_payload_hash" text;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Backfill
-- ---------------------------------------------------------------------------
-- O gatilho de imutabilidade recusa qualquer UPDATE num snapshot CLOSED, o que
-- é exatamente o que se quer no dia a dia. Aqui ele sai por uma migration
-- explícita e versionada — o único lugar em que isso é legítimo — e volta logo
-- depois, dentro da mesma transação.
ALTER TABLE "snapshot" DISABLE TRIGGER "snapshot_immutable";--> statement-breakpoint

UPDATE "snapshot" s SET
  "dataset_family" = freightcheck_dataset_family(s."entity_type_set"),
  "canal" = freightcheck_canal_do_rotulo(s."source_label"),
  "canonical_scope" = freightcheck_canonical_scope(
    coalesce(
      (SELECT jsonb_agg(jsonb_build_object('scopeType', sc."scope_type", 'code', sc."code"))
         FROM "snapshot_scope" ss
         JOIN "scope" sc ON sc."id" = ss."scope_id"
        WHERE ss."snapshot_id" = s."id"),
      '[]'::jsonb
    )
  );--> statement-breakpoint

ALTER TABLE "snapshot" ENABLE TRIGGER "snapshot_immutable";--> statement-breakpoint

ALTER TABLE "snapshot" ALTER COLUMN "dataset_family" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshot" ALTER COLUMN "canal" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshot" ALTER COLUMN "canonical_scope" SET NOT NULL;--> statement-breakpoint

-- O escopo guardado tem de estar em forma canônica. Sem isto, um erro no
-- TypeScript poderia gravar um escopo fora de ordem ou com CNPJ mascarado e
-- produzir uma chave diferente para o mesmo negócio. Com isto, o banco recusa a
-- linha — falha alta, e não duplicata silenciosa.
ALTER TABLE "snapshot"
  ADD CONSTRAINT "snapshot_canonical_scope_ck"
  CHECK ("canonical_scope" = freightcheck_canonical_scope("canonical_scope"));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. A chave, calculada pelo banco
-- ---------------------------------------------------------------------------
-- Coluna **gerada**: a aplicação não a escreve e não pode escrevê-la. É o que
-- transforma "o TypeScript calcula certo" em "é impossível calcular errado".
ALTER TABLE "snapshot"
  ADD COLUMN "canonical_snapshot_key" text
  GENERATED ALWAYS AS (
    freightcheck_snapshot_key("source_system", "dataset_family", "canal", "effective_date", "canonical_scope")
  ) STORED;--> statement-breakpoint

CREATE INDEX "snapshot_canonical_key_idx" ON "snapshot" USING btree ("canonical_snapshot_key");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. A placa como ela veio, ao lado da placa normalizada
-- ---------------------------------------------------------------------------
-- Normalizar a identidade não é apagar a evidência: o valor original fica.
ALTER TABLE "staged_fact" ADD COLUMN IF NOT EXISTS "entity_key_raw" text;--> statement-breakpoint
UPDATE "staged_fact" SET "entity_key_raw" = "entity_key" WHERE "entity_key_raw" IS NULL;--> statement-breakpoint

ALTER TABLE "entity_identifier" ADD COLUMN IF NOT EXISTS "identifier_value_raw" text;--> statement-breakpoint
UPDATE "entity_identifier" SET "identifier_value_raw" = "identifier_value" WHERE "identifier_value_raw" IS NULL;--> statement-breakpoint

-- Normalizar identificadores já gravados pode fundir duas linhas que hoje
-- convivem (`ABC-1D23` e `ABC1D23` como identificadores correntes distintos).
-- Se isso acontecer, são duas entidades que sempre foram a mesma e a fusão é
-- uma decisão de negócio — não uma migration. Aqui a migration **para**, e diz
-- o que encontrou.
DO $$
DECLARE
  conflito text;
BEGIN
  SELECT string_agg(DISTINCT format('%s=%s', identifier_type, chave), '; ')
    INTO conflito
    FROM (
      SELECT identifier_type,
             freightcheck_norm_identificador(identifier_value) AS chave,
             count(DISTINCT entity_id) AS entidades
        FROM entity_identifier
       WHERE is_current
       GROUP BY 1, 2
      HAVING count(DISTINCT entity_id) > 1
    ) c;
  IF conflito IS NOT NULL THEN
    RAISE EXCEPTION
      'Normalizar identificadores fundiria entidades hoje distintas (%). Resolva a identidade dessas entidades antes de aplicar esta migration; nada foi alterado.',
      conflito
      USING ERRCODE = 'data_exception';
  END IF;
END $$;--> statement-breakpoint

UPDATE "entity_identifier"
   SET "identifier_value" = freightcheck_norm_identificador("identifier_value")
 WHERE "identifier_value" <> freightcheck_norm_identificador("identifier_value");--> statement-breakpoint

UPDATE "staged_fact"
   SET "entity_key" = freightcheck_norm_identificador("entity_key")
 WHERE "entity_key" <> freightcheck_norm_identificador("entity_key");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 7. O diagnóstico
-- ---------------------------------------------------------------------------
-- "Existe mais de uma vigência ativa para a mesma identidade?" — a pergunta que
-- o produto precisa saber responder a qualquer momento, e a mesma que o teste
-- de invariante faz. Zero linhas é a resposta correta.
CREATE OR REPLACE VIEW "freightcheck_snapshot_ativo_duplicado" AS
SELECT
  s."canonical_snapshot_key",
  s."dataset_family",
  s."canal",
  s."effective_date",
  s."canonical_scope",
  count(*)                                  AS ativos,
  array_agg(s."id"       ORDER BY s."revision", s."created_at") AS snapshot_ids,
  array_agg(s."revision" ORDER BY s."revision", s."created_at") AS revisoes,
  array_agg(s."source_label" ORDER BY s."revision", s."created_at") AS rotulos,
  array_agg(s."entity_type_set" ORDER BY s."revision", s."created_at") AS conjuntos_de_tipos
FROM "snapshot" s
WHERE s."status" <> 'SUPERSEDED'
GROUP BY 1, 2, 3, 4, 5
HAVING count(*) > 1;--> statement-breakpoint

-- "Existe o mesmo fato duas vezes dentro de uma vigência?" — protegido por
-- `fact_grain_uq` desde a fundação; a view existe para que a prova seja uma
-- consulta e não uma leitura de DDL.
CREATE OR REPLACE VIEW "freightcheck_fato_duplicado" AS
SELECT
  f."snapshot_id",
  f."entity_id",
  f."attribute_id",
  count(*) AS ocorrencias
FROM "fact" f
GROUP BY 1, 2, 3
HAVING count(*) > 1;--> statement-breakpoint

-- O retrato completo de uma vigência ativa, para a auditoria: o que a
-- identifica, de onde veio e quanto carrega.
CREATE OR REPLACE VIEW "freightcheck_identidade_vigencia" AS
SELECT
  s."id"                     AS snapshot_id,
  s."canonical_snapshot_key",
  s."dataset_family",
  s."canal",
  s."effective_date",
  s."canonical_scope",
  s."entity_type_set",
  s."revision",
  s."status",
  s."supersedes_snapshot_id",
  s."canonical_payload_hash",
  s."source_label",
  s."import_run_id",
  s."source_file_id",
  sf."filename",
  sf."content_sha256",
  s."entity_count",
  s."fact_count",
  s."created_at"
FROM "snapshot" s
JOIN "source_file" sf ON sf."id" = s."source_file_id";
