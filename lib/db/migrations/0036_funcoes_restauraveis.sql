-- As funções da identidade canônica passam a citar o próprio schema.
--
-- O defeito apareceu na primeira prova de restore (backup-restore.test.ts):
-- `pg_restore` roda a sessão com `search_path` vazio — é o comportamento
-- padrão do formato do pg_dump, por segurança — e o COPY de `snapshot` avalia
-- a coluna gerada `canonical_snapshot_key`, cujo corpo chama
-- `freightcheck_norm_canal(...)` sem schema. Sem search_path, o nome não
-- resolve, o COPY morre e o backup inteiro é irrestaurável:
--
--   pg_restore: error: could not execute query:
--   ERROR: function freightcheck_norm_canal(text) does not exist
--
-- Um backup que não restaura é fé, não cópia. A correção é qualificar as
-- chamadas internas com `public.` nas seis funções que chamam outras — os
-- corpos são os da 0015, byte a byte fora do prefixo. `CREATE OR REPLACE` com
-- a mesma assinatura preserva a coluna gerada, os índices e o dado; rodar isto
-- num banco que já o tem não muda nada, que é a reentrância que a fila exige.
--
-- As funções-folha (sem_acento, norm_documento, serialize_scope, iso_date,
-- dataset_family) não chamam ninguém e ficam como estão.

CREATE OR REPLACE FUNCTION freightcheck_norm_identificador(v text)
RETURNS text AS $$
  SELECT regexp_replace(upper(public.freightcheck_sem_acento(coalesce(v, ''))), '[^A-Z0-9]', '', 'g');
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint

CREATE OR REPLACE FUNCTION freightcheck_norm_scope_code(scope_type text, v text)
RETURNS text AS $$
  SELECT CASE upper(btrim(coalesce(scope_type, '')))
    WHEN 'UNIDADE' THEN public.freightcheck_norm_documento(v)
    WHEN 'OPERADOR' THEN public.freightcheck_norm_documento(v)
    ELSE btrim(regexp_replace(upper(public.freightcheck_sem_acento(coalesce(v, ''))), '[^A-Z0-9]+', ' ', 'g'))
  END;
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint

CREATE OR REPLACE FUNCTION freightcheck_norm_canal(v text)
RETURNS text AS $$
  SELECT btrim(
    regexp_replace(upper(public.freightcheck_sem_acento(coalesce(v, ''))), '[^A-Z0-9]+', '_', 'g'),
    '_'
  );
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint

CREATE OR REPLACE FUNCTION freightcheck_canal_do_rotulo(label text)
RETURNS text AS $$
  SELECT public.freightcheck_norm_canal(
    coalesce(
      substring(btrim(coalesce(label, '')) from '^([A-Za-z][A-Za-z0-9_]*)_[0-9]{1,2}_[0-9]{1,2}_[0-9]{4}$'),
      btrim(coalesce(label, ''))
    )
  );
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint

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
      public.freightcheck_norm_scope_code(e ->> 'scopeType', e ->> 'code') AS c
    FROM jsonb_array_elements(coalesce(scope, '[]'::jsonb)) e
  ) s
  WHERE t <> '' AND c <> '';
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint

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
      public.freightcheck_norm_canal(canal) || chr(31) ||
      public.freightcheck_iso_date(effective_date) || chr(31) ||
      public.freightcheck_serialize_scope(canonical_scope),
      'UTF8'
    )),
    'hex'
  );
$$ LANGUAGE sql IMMUTABLE;
