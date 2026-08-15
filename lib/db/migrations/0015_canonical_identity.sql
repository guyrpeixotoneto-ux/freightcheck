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
-- `0016`, depois que os conflitos históricos tiverem sido resolvidos por fusão,
-- sem apagar nada. Separar as duas é o que permite rodar o diagnóstico num
-- banco real e ler o estrago antes de mexer nele.
--
-- ---------------------------------------------------------------------------
-- Reentrância: por que esta migration confere antes de criar
-- ---------------------------------------------------------------------------
--
-- O Publishing do Replit propõe um diff de schema derivado do `schema.ts` e
-- oferece aplicá-lo. Esse diff contém as três colunas desta migration como
-- `NOT NULL` sem backfill, a coluna gerada e os índices — e **nada** do que
-- sustenta esses objetos: as funções, a conversão dos dados históricos, a
-- fusão da `0016`. Se alguém aceitar aquela proposta, o banco fica num estado
-- que não é nem o de antes nem o de depois.
--
-- Esta migration passa a atravessar esse estado. Cada objeto que ela cria é
-- primeiro procurado; se já existir com a definição esperada, ela o **adota** e
-- segue; se existir com definição diferente, ela **aborta** dizendo qual objeto
-- e qual a diferença. Nada é derrubado, sobrescrito ou "consertado" sozinho: um
-- schema que não se reconhece é decisão de quem opera, não de uma migration.

-- ---------------------------------------------------------------------------
-- 1. Estados novos da máquina de importação
-- ---------------------------------------------------------------------------
-- Duplicata não é erro técnico, e "arquivo repetido" não é a mesma coisa que
-- "dado repetido". Os valores entram aqui e só podem ser *usados* depois do
-- commit desta migration — por isso nada nesta migration os referencia.
ALTER TYPE "import_run_status" ADD VALUE IF NOT EXISTS 'SKIPPED_DUPLICATE_DATA';--> statement-breakpoint
ALTER TYPE "import_run_status" ADD VALUE IF NOT EXISTS 'VALIDATION_ERROR';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Conferência de compatibilidade das funções
-- ---------------------------------------------------------------------------
-- `CREATE OR REPLACE FUNCTION` só substitui quando a assinatura bate. Uma
-- função homônima com outros parâmetros vira **sobrecarga** — e aí
-- `freightcheck_snapshot_key(...)` passa a ser ambíguo, o que quebra a coluna
-- gerada muito longe daqui. Uma que só mude o nome de um parâmetro faz o
-- `CREATE OR REPLACE` falhar com uma mensagem que não diz o que fazer.
--
-- A conferência é feita antes de criar qualquer coisa, e nomeia o que achou.
DO $$
DECLARE
  conflito text;
BEGIN
  SELECT string_agg(
           format('%s(%s) RETURNS %s',
                  p.proname,
                  pg_get_function_arguments(p.oid),
                  pg_get_function_result(p.oid)),
           E'\n  ' ORDER BY p.proname)
    INTO conflito
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = ANY (ARRAY[
       'freightcheck_sem_acento', 'freightcheck_norm_documento',
       'freightcheck_norm_identificador', 'freightcheck_norm_scope_code',
       'freightcheck_norm_canal', 'freightcheck_canal_do_rotulo',
       'freightcheck_dataset_family', 'freightcheck_canonical_scope',
       'freightcheck_serialize_scope', 'freightcheck_iso_date',
       'freightcheck_snapshot_key'
     ])
     AND (p.proname || '(' || pg_get_function_arguments(p.oid) || ') RETURNS ' || pg_get_function_result(p.oid))
         <> ALL (ARRAY[
       'freightcheck_sem_acento(v text) RETURNS text',
       'freightcheck_norm_documento(v text) RETURNS text',
       'freightcheck_norm_identificador(v text) RETURNS text',
       'freightcheck_norm_scope_code(scope_type text, v text) RETURNS text',
       'freightcheck_norm_canal(v text) RETURNS text',
       'freightcheck_canal_do_rotulo(label text) RETURNS text',
       'freightcheck_dataset_family(entity_type_set text) RETURNS text',
       'freightcheck_canonical_scope(scope jsonb) RETURNS jsonb',
       'freightcheck_serialize_scope(scope jsonb) RETURNS text',
       'freightcheck_iso_date(d date) RETURNS text',
       'freightcheck_snapshot_key(source_system text, dataset_family text, canal text, effective_date date, canonical_scope jsonb) RETURNS text'
     ]);

  IF conflito IS NOT NULL THEN
    RAISE EXCEPTION
      E'Já existem funções da identidade canônica com assinatura diferente da esperada:\n  %\n\nElas não podem ser substituídas por esta migration — substituir mudaria o significado da identidade sem que ninguém tenha decidido isso. Confira de onde vieram (o SQL automático do Publishing é a origem provável), remova-as ou alinhe-as, e rode de novo. Nada foi alterado.',
      conflito
      USING ERRCODE = 'data_exception';
  END IF;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. As normalizações, em SQL
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
-- 4. As colunas de identidade
-- ---------------------------------------------------------------------------
-- Conferência antes da criação: uma coluna homônima com outro tipo — `varchar`
-- no lugar de `text`, `json` no lugar de `jsonb` — passaria despercebida pelo
-- `IF NOT EXISTS` e só apareceria muito depois, no `CHECK` ou no índice.
DO $$
DECLARE
  achado text;
BEGIN
  SELECT string_agg(format('%s.%s é %s, esperado %s', t.tabela, t.coluna, c.data_type, t.tipo), E'\n  ')
    INTO achado
    FROM (VALUES
      ('snapshot', 'dataset_family', 'text'),
      ('snapshot', 'canal', 'text'),
      ('snapshot', 'canonical_scope', 'jsonb'),
      ('snapshot', 'canonical_payload_hash', 'text'),
      ('staged_fact', 'entity_key_raw', 'text'),
      ('entity_identifier', 'identifier_value_raw', 'text')
    ) AS t(tabela, coluna, tipo)
    JOIN information_schema.columns c
      ON c.table_schema = 'public'
     AND c.table_name = t.tabela
     AND c.column_name = t.coluna
   WHERE c.data_type <> t.tipo;

  IF achado IS NOT NULL THEN
    RAISE EXCEPTION
      E'Colunas da identidade canônica já existem com outro tipo:\n  %\n\nEsta migration não converte tipo de coluna que já tem dado — converter é decisão de quem opera. Confira de onde vieram e alinhe-as ou remova-as. Nada foi alterado.',
      achado
      USING ERRCODE = 'data_exception';
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "snapshot" ADD COLUMN IF NOT EXISTS "dataset_family" text;--> statement-breakpoint
ALTER TABLE "snapshot" ADD COLUMN IF NOT EXISTS "canal" text;--> statement-breakpoint
ALTER TABLE "snapshot" ADD COLUMN IF NOT EXISTS "canonical_scope" jsonb;--> statement-breakpoint
-- Hash do conteúdo já normalizado. Serve para reconhecer "o arquivo é outro,
-- mas o dado é o mesmo" e não abrir revisão vazia. É nullable porque as
-- vigências históricas não o têm: quando falta, a comparação é feita contra os
-- fatos do próprio snapshot, que é a verdade de origem.
ALTER TABLE "snapshot" ADD COLUMN IF NOT EXISTS "canonical_payload_hash" text;--> statement-breakpoint

-- As três colunas de identidade nascem nullable **de propósito** e só ficam
-- obrigatórias depois do backfill e da validação, adiante. Se uma delas já
-- chegar aqui `NOT NULL` — porque o SQL automático a criou assim numa tabela
-- vazia —, a obrigatoriedade é largada agora e reposta no fim, pelo mesmo
-- caminho de sempre. Sem isto, o backfill de um banco que tenha ficado no meio
-- do caminho não teria como escrever a primeira linha.
DO $$
DECLARE
  coluna text;
BEGIN
  FOREACH coluna IN ARRAY ARRAY['dataset_family', 'canal', 'canonical_scope'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'snapshot'
         AND column_name = coluna AND is_nullable = 'NO'
    ) THEN
      EXECUTE format('ALTER TABLE "snapshot" ALTER COLUMN %I DROP NOT NULL', coluna);
      RAISE NOTICE 'A coluna snapshot.% já estava NOT NULL; a obrigatoriedade volta no fim desta migration, depois do backfill e da validação.', coluna;
    END IF;
  END LOOP;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Backfill
-- ---------------------------------------------------------------------------
-- O gatilho de imutabilidade recusa qualquer UPDATE num snapshot CLOSED, o que
-- é exatamente o que se quer no dia a dia. Aqui ele sai por uma migration
-- explícita e versionada — o único lugar em que isso é legítimo — e volta logo
-- depois.
--
-- O `EXCEPTION` existe para o caso em que o backfill falha: o gatilho volta
-- antes de o erro subir. Numa transação isso é redundante (o `DISABLE TRIGGER`
-- também é transacional e o `ROLLBACK` o desfaz), e é de propósito: a garantia
-- não pode depender de quem chama esta migration ter aberto transação.
--
-- O recálculo é de **todas** as linhas, e não só das que estão nulas. Um valor
-- artificial que alguém tenha posto ali para satisfazer um `NOT NULL` — o
-- default falso que o SQL automático sugere — é justamente o que não pode
-- sobreviver: identidade se deriva da origem (`source_label`, `snapshot_scope`)
-- toda vez, ou não é identidade.
DO $$
DECLARE
  tinha_gatilho boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
     WHERE NOT t.tgisinternal AND t.tgname = 'snapshot_immutable' AND c.relname = 'snapshot'
  ) INTO tinha_gatilho;

  IF tinha_gatilho THEN
    ALTER TABLE "snapshot" DISABLE TRIGGER "snapshot_immutable";
  END IF;

  BEGIN
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
      );
  EXCEPTION WHEN OTHERS THEN
    IF tinha_gatilho THEN
      ALTER TABLE "snapshot" ENABLE TRIGGER "snapshot_immutable";
    END IF;
    RAISE;
  END;

  IF tinha_gatilho THEN
    ALTER TABLE "snapshot" ENABLE TRIGGER "snapshot_immutable";
  END IF;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. A validação do backfill, antes de tornar as colunas obrigatórias
-- ---------------------------------------------------------------------------
-- `SET NOT NULL` não é validação: ele deixa passar `''` e `[]`, que satisfazem
-- a obrigatoriedade e destroem a identidade — duas vigências com canal vazio na
-- mesma data são a mesma chave, e a `0016` as fundiria em silêncio, achando que
-- são a mesma realidade.
--
-- Aqui a migration para e **nomeia as linhas**: id, rótulo e motivo. Nenhuma
-- delas é convertida em valor padrão para caber na regra — uma identidade que o
-- histórico não sustenta é decisão de negócio, não de migration.
DO $$
DECLARE
  problemas text;
  quantas   integer;
BEGIN
  WITH todas AS (
    SELECT s."id", s."source_label",
      CASE
        WHEN s."dataset_family" IS NULL THEN 'dataset_family nulo'
        WHEN btrim(s."dataset_family") = '' THEN 'dataset_family vazio ou só espaço'
        WHEN s."canal" IS NULL THEN 'canal nulo'
        WHEN btrim(s."canal") = '' THEN 'canal vazio — o rótulo não produz canal nenhum depois de normalizado'
        WHEN s."canonical_scope" IS NULL THEN 'canonical_scope nulo'
        WHEN jsonb_typeof(s."canonical_scope") <> 'array' THEN 'canonical_scope não é um array JSON'
        WHEN s."canonical_scope" <> freightcheck_canonical_scope(s."canonical_scope") THEN 'canonical_scope fora da forma canônica'
        WHEN jsonb_array_length(s."canonical_scope") = 0 THEN 'sem escopo — a vigência não diz de quem é a remuneração, e duas unidades diferentes teriam a mesma identidade'
      END AS motivo
      FROM "snapshot" s
  ),
  invalidas AS (SELECT * FROM todas WHERE motivo IS NOT NULL)
  SELECT
    (SELECT count(*) FROM invalidas),
    (SELECT string_agg(
              format('id=%s rótulo=%L motivo=%s', "id", "source_label", motivo),
              E'\n  ' ORDER BY "source_label", "id")
       FROM (SELECT * FROM invalidas ORDER BY "source_label", "id" LIMIT 50) x)
    INTO quantas, problemas;

  IF quantas > 0 THEN
    RAISE EXCEPTION
      E'O backfill da identidade canônica não fecha para % vigência(s):\n  %\n\nNenhuma delas foi alterada e nada foi apagado. Corrija a origem — o rótulo (`source_label`) e o escopo (`snapshot_scope`) são de onde a identidade se deriva — e rode de novo.',
      quantas, problemas
      USING ERRCODE = 'data_exception';
  END IF;
END $$;--> statement-breakpoint

-- O escopo obrigatório do pipeline (`REQUIRED_SCOPE_TYPES`, hoje `UNIDADE`)
-- passou a valer na promoção *a partir* desta migration. Exigi-lo das vigências
-- que entraram antes seria aplicar retroativamente uma regra que o schema nunca
-- impôs — e travaria um deploy por dado histórico legítimo. Elas saem
-- nomeadas, para quem opera decidir, e a migration segue.
DO $$
DECLARE
  sem_unidade text;
BEGIN
  SELECT string_agg(format('id=%s rótulo=%L', s."id", s."source_label"), E'\n  ' ORDER BY s."source_label")
    INTO sem_unidade
    FROM "snapshot" s
   WHERE NOT EXISTS (
     SELECT 1 FROM jsonb_array_elements(s."canonical_scope") e
      WHERE e ->> 'scopeType' = 'UNIDADE'
   );
  IF sem_unidade IS NOT NULL THEN
    RAISE WARNING
      E'Vigências históricas sem UNIDADE no escopo canônico:\n  %\n\nElas têm escopo (senão a migration teria parado antes) e continuam íntegras. O pipeline recusa promover uma vigência assim de agora em diante; estas vieram de antes da regra.',
      sem_unidade;
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "snapshot" ALTER COLUMN "dataset_family" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshot" ALTER COLUMN "canal" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshot" ALTER COLUMN "canonical_scope" SET NOT NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 7. As constraints que sustentam a identidade
-- ---------------------------------------------------------------------------
-- `NOT NULL` cobre o nulo e nada mais. Estas cobrem o resto: o escopo tem de
-- estar em forma canônica, o canal e a família não podem ser vazios, e o escopo
-- não pode ser `[]`. Sem elas, um erro no TypeScript poderia gravar uma linha
-- que satisfaz a obrigatoriedade e mesmo assim colapsa duas identidades numa.
--
-- Cada uma é adotada se já existir com a mesma definição, e aborta a migration
-- se existir com definição diferente. A comparação ignora espaço, aspas e o
-- `::text` que o Postgres acrescenta ao normalizar.
DO $$
DECLARE
  esperado record;
  atual    text;
  norm     text;
BEGIN
  FOR esperado IN
    SELECT * FROM (VALUES
      ('snapshot_canonical_scope_ck',
       'CHECK ((canonical_scope = freightcheck_canonical_scope(canonical_scope)))'),
      ('snapshot_canal_nao_vazio_ck',
       'CHECK ((btrim(canal) <> ''''::text))'),
      ('snapshot_dataset_family_nao_vazio_ck',
       'CHECK ((btrim(dataset_family) <> ''''::text))'),
      ('snapshot_canonical_scope_nao_vazio_ck',
       'CHECK ((jsonb_array_length(canonical_scope) > 0))')
    ) AS v(nome, definicao)
  LOOP
    SELECT pg_get_constraintdef(c.oid) INTO atual
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public' AND t.relname = 'snapshot' AND c.conname = esperado.nome;

    IF atual IS NULL THEN
      EXECUTE format(
        'ALTER TABLE "snapshot" ADD CONSTRAINT %I %s', esperado.nome, esperado.definicao);
    ELSE
      norm := replace(replace(replace(lower(atual), ' ', ''), '"', ''), '::text', '');
      IF norm <> replace(replace(replace(lower(esperado.definicao), ' ', ''), '"', ''), '::text', '') THEN
        RAISE EXCEPTION
          E'A constraint % já existe em "snapshot" com outra definição.\n  encontrada: %\n  esperada:   %\n\nEsta migration não substitui constraint que ela não escreveu. Confira de onde veio, remova-a ou alinhe-a, e rode de novo. Nada foi alterado.',
          esperado.nome, atual, esperado.definicao
          USING ERRCODE = 'data_exception';
      END IF;
    END IF;
  END LOOP;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 8. A chave, calculada pelo banco
-- ---------------------------------------------------------------------------
-- Coluna **gerada**: a aplicação não a escreve e não pode escrevê-la. É o que
-- transforma "o TypeScript calcula certo" em "é impossível calcular errado".
--
-- Este é o objeto mais sensível da migration inteira: uma coluna homônima que
-- não seja gerada, ou que seja gerada por outra expressão, produz uma segunda
-- definição de identidade — e o índice único da `0016` passaria a trancar a
-- identidade errada. Aqui ela é conferida expressão contra expressão.
DO $$
DECLARE
  gerada    char;
  expressao text;
  tipo      text;
  esperada  CONSTANT text :=
    'freightcheck_snapshot_key(source_system, dataset_family, canal, effective_date, canonical_scope)';
BEGIN
  SELECT a.attgenerated, pg_get_expr(d.adbin, d.adrelid), format_type(a.atttypid, a.atttypmod)
    INTO gerada, expressao, tipo
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE n.nspname = 'public' AND c.relname = 'snapshot'
     AND a.attname = 'canonical_snapshot_key' AND NOT a.attisdropped;

  IF NOT FOUND THEN
    EXECUTE 'ALTER TABLE "snapshot" ADD COLUMN "canonical_snapshot_key" text '
         || 'GENERATED ALWAYS AS (freightcheck_snapshot_key("source_system", "dataset_family", "canal", "effective_date", "canonical_scope")) STORED';
  ELSIF gerada <> 's'
     OR tipo <> 'text'
     OR replace(replace(lower(coalesce(expressao, '')), ' ', ''), '"', '')
        <> replace(replace(lower(esperada), ' ', ''), '"', '') THEN
    RAISE EXCEPTION
      E'A coluna snapshot.canonical_snapshot_key já existe e não é a identidade canônica desta migration.\n  gerada (s=stored): %\n  tipo:              %\n  expressão:         %\n  esperada:          %\n\nDuas definições de identidade no mesmo banco é o defeito que esta migration existe para fechar; ela não sobrescreve a que encontrou. Confira de onde veio (o SQL automático do Publishing cria esta coluna sem as funções que a sustentam), remova-a ou alinhe-a, e rode de novo. Nada foi alterado.',
      coalesce(gerada, '-'), coalesce(tipo, '-'), coalesce(expressao, '(nenhuma)'), esperada
      USING ERRCODE = 'data_exception';
  END IF;
END $$;--> statement-breakpoint

-- O índice não-único: esta migration mede, a `0016` tranca. Se já existir com
-- outra definição — em outra coluna, único, parcial — a migration para: um
-- índice de identidade diferente do declarado aqui muda o que o banco garante.
DO $$
DECLARE
  atual    text;
  esperada CONSTANT text :=
    'CREATE INDEX snapshot_canonical_key_idx ON public.snapshot USING btree (canonical_snapshot_key)';
BEGIN
  SELECT pg_get_indexdef(i.indexrelid) INTO atual
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'snapshot_canonical_key_idx';

  IF atual IS NULL THEN
    EXECUTE 'CREATE INDEX "snapshot_canonical_key_idx" ON "snapshot" USING btree ("canonical_snapshot_key")';
  ELSIF replace(replace(lower(atual), ' ', ''), '"', '')
     <> replace(replace(lower(esperada), ' ', ''), '"', '') THEN
    RAISE EXCEPTION
      E'O índice snapshot_canonical_key_idx já existe com outra definição.\n  encontrada: %\n  esperada:   %\n\nRemova-o ou alinhe-o e rode de novo. Nada foi alterado.',
      atual, esperada
      USING ERRCODE = 'data_exception';
  END IF;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 9. A placa como ela veio, ao lado da placa normalizada
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
-- 10. O diagnóstico
-- ---------------------------------------------------------------------------
-- As três views são derivadas: não guardam nada e podem ser reescritas. O que
-- não pode é uma **tabela** homônima virar view por conta desta migration, nem
-- uma view com outro conjunto de colunas ser substituída em silêncio — quem
-- consulta pelo nome antigo receberia outra coisa sem aviso.
DO $$
DECLARE
  achado text;
BEGIN
  SELECT string_agg(format('%s é %s', c.relname,
           CASE c.relkind WHEN 'r' THEN 'tabela' WHEN 'm' THEN 'view materializada'
                          WHEN 'f' THEN 'tabela externa' ELSE c.relkind::text END), '; ')
    INTO achado
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('freightcheck_snapshot_ativo_duplicado',
                       'freightcheck_fato_duplicado',
                       'freightcheck_identidade_vigencia')
     AND c.relkind <> 'v';
  IF achado IS NOT NULL THEN
    RAISE EXCEPTION
      'Os nomes de diagnóstico já existem, e não como view (%). Esta migration não derruba relação que ela não criou. Nada foi alterado.',
      achado
      USING ERRCODE = 'data_exception';
  END IF;
END $$;--> statement-breakpoint

-- "Existe mais de uma vigência ativa para a mesma identidade?" — a pergunta que
-- o produto precisa saber responder a qualquer momento, e a mesma que o teste
-- de invariante faz. Zero linhas é a resposta correta.
--
-- `DROP` antes de `CREATE` porque `CREATE OR REPLACE VIEW` recusa qualquer
-- mudança na lista de colunas, e a view pode ter chegado aqui pela metade. Sem
-- `CASCADE`, de propósito: se alguém tiver construído em cima dela, o erro do
-- Postgres nomeia o dependente em vez de derrubá-lo junto.
DROP VIEW IF EXISTS "freightcheck_snapshot_ativo_duplicado";--> statement-breakpoint
CREATE VIEW "freightcheck_snapshot_ativo_duplicado" AS
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
DROP VIEW IF EXISTS "freightcheck_fato_duplicado";--> statement-breakpoint
CREATE VIEW "freightcheck_fato_duplicado" AS
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
DROP VIEW IF EXISTS "freightcheck_identidade_vigencia";--> statement-breakpoint
CREATE VIEW "freightcheck_identidade_vigencia" AS
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
