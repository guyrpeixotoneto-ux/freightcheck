-- Reconciliar o que o bridge remove e o registro dá por criado.
--
-- ---------------------------------------------------------------------------
-- O buraco que esta migration fecha
-- ---------------------------------------------------------------------------
-- Três fatos deste repositório, cada um correto sozinho, compõem um estado do
-- qual nenhum banco sai por conta própria:
--
--   1. `bridgeDown` remove objetos que as migrations criam — cinco tabelas,
--      onze colunas, seis índices, views, funções, CHECKs e três NOT NULL. É
--      deliberado: encolhe o diff que o Publishing do Replit calcula, e sem
--      isso o deploy morre. Ver `lib/db/src/bridge.ts`.
--   2. `bridgeDown` **não toca no registro de migrations**, e está escrito lá
--      por quê: `drizzle.__drizzle_migrations` é história de migrations, não
--      retrato de estrutura.
--   3. `runMigrations()` pula toda migration cujo `when` já está no registro.
--
-- Some-se: depois de um `bridge:down`, **só o `bridge:up` devolve aqueles
-- objetos — a fila de migrations estruturalmente não consegue.** Se o `up` não
-- rodar (deploy interrompido, sessão perdida, erro no meio, esquecimento), o
-- banco fica divergente para sempre. `migrate` responde "nada a aplicar",
-- `/api/healthz` responde SAUDAVEL, e a contagem fecha: 23 de 23.
--
-- Foi exatamente esse o estado observado em 16/08/2026. `attribute.definition`
-- — item da lista `COLUNAS_REMOVIDAS`, criada pela `0022_significado` — não
-- estava no banco, o registro dava a `0022` por aplicada, e a fila de curadoria
-- (a única tela que lê essa coluna) respondia 500 enquanto o resto do produto
-- funcionava.
--
-- ---------------------------------------------------------------------------
-- Por que uma migration nova, e não um comando manual
-- ---------------------------------------------------------------------------
-- Um `ALTER TABLE` no banco de produção conserta **aquele** banco. Esta
-- migration tem um `when` que registro nenhum contém, então ela roda sozinha,
-- uma vez, em todos: no Development, no de produção, no de cada teste e em
-- qualquer banco novo que venha a existir. É a única forma de os quatro
-- terminarem no mesmo schema sem alguém lembrar de nada.
--
-- Em banco saudável ela é no-op — todo comando abaixo é `IF NOT EXISTS`, e as
-- `0015`..`0022` já criaram tudo isto. Custa uma varredura de catálogo.
--
-- ---------------------------------------------------------------------------
-- O que esta migration deliberadamente NÃO reconcilia
-- ---------------------------------------------------------------------------
-- A família da identidade canônica: `snapshot.canonical_snapshot_key`, os
-- índices `snapshot_canonical_live_uq`, `snapshot_canonical_revision_uq` e
-- `snapshot_canonical_key_idx`, os quatro CHECKs de `snapshot` e os três
-- NOT NULL de `dataset_family`, `canal` e `canonical_scope`.
--
-- Não é esquecimento. Aquela coluna é `GENERATED ALWAYS AS
-- (freightcheck_snapshot_key(...)) STORED` sobre funções que o mesmo
-- `bridgeDown` também remove, e a `0015` que a cria não faz um `ADD COLUMN`:
-- faz um bloco que **confere geração, tipo e expressão** e aborta nomeando a
-- diferença se achar outra coisa no lugar — precisamente porque o SQL
-- automático do Publishing cria essa coluna sem as funções que a sustentam.
-- Repô-la aqui com um `IF NOT EXISTS` mais fraco trocaria uma coluna ausente
-- por uma coluna presente e errada, que é pior: para de doer sem parar de estar
-- errada, e a identidade canônica é o que impede duas vigências de se
-- confundirem.
--
-- Para essa família o instrumento continua sendo o `bridge:up`, que levanta o
-- DDL exato da migration proprietária. O que muda é que a ausência dela deixa
-- de ser invisível: `pnpm --filter @workspace/db run conferir-schema` a acusa,
-- e `bridge-reconciliacao.test.ts` impede que a lista do bridge cresça sem que
-- alguém decida conscientemente de que lado desta fronteira o item novo cai.

-- As dez colunas nuláveis, sem default, que o `down` remove. O DDL é o mesmo
-- da migration proprietária de cada uma — 0013, 0014, 0017, 0019 e 0022.
ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "changed_parameter_count" integer;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "vigencia_label" text;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "entity_description" text;--> statement-breakpoint
ALTER TABLE "ticket_import" ADD COLUMN IF NOT EXISTS "parameter_columns" jsonb;--> statement-breakpoint
ALTER TABLE "fact" ADD COLUMN IF NOT EXISTS "inherited_from_snapshot_id" uuid;--> statement-breakpoint
ALTER TABLE "assistant_message" ADD COLUMN IF NOT EXISTS "feedback" text;--> statement-breakpoint
ALTER TABLE "assistant_message" ADD COLUMN IF NOT EXISTS "feedback_note" text;--> statement-breakpoint
ALTER TABLE "assistant_message" ADD COLUMN IF NOT EXISTS "feedback_at" timestamptz;--> statement-breakpoint
ALTER TABLE "attribute" ADD COLUMN IF NOT EXISTS "definition" text;--> statement-breakpoint
ALTER TABLE "attribute_semantics" ADD COLUMN IF NOT EXISTS "definition" text;--> statement-breakpoint

-- Os três índices que dependem só de colunas repostas acima. Os outros três da
-- lista do bridge pendem de `canonical_snapshot_key` e saem junto com ela, pelo
-- motivo escrito no cabeçalho.
CREATE INDEX IF NOT EXISTS "fact_inherited_idx"
  ON "fact" USING btree ("inherited_from_snapshot_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_vigencia_idx"
  ON "ticket" USING btree ("vigencia_label");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fact_nao_aplicavel_idx"
  ON "fact" USING btree ("snapshot_id", "attribute_id")
  WHERE "null_reason" = 'NOT_APPLICABLE';
