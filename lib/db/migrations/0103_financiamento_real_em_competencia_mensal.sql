-- ---------------------------------------------------------------------------
-- O FINANCIAMENTO REAL EM COMPETÊNCIA MENSAL — o realizado ao lado do pago.
-- ---------------------------------------------------------------------------
--
-- O produto sempre soube guardar o **remunerado**: o que a Ambev paga por
-- equipamento, em vigências quinzenais. O extrato do banco — o que o
-- financiamento de fato custou — nunca coube nele, e a razão não é a família do
-- dataset (essa já existe, `FINANCIAMENTO_REAL`, desde que a declaração do
-- acervo nasceu): é o **período**.
--
-- ---------------------------------------------------------------------------
-- Por que `granularidade`, e não a data sozinha
-- ---------------------------------------------------------------------------
--
-- `snapshot.effective_date` é a data em que o período começa, e a `0093` fixou
-- a régua da quinzena: 1 → dia 1, 2 → dia 16. O extrato do financiamento fecha
-- por mês, e a competência de março começa em `2026-03-01` — exatamente a mesma
-- data da 1ª quinzena de março.
--
-- As duas vigências não colidem, porque a identidade canônica inclui a família
-- e elas têm famílias diferentes. O que falta não é separação: é **saber o que
-- cada uma cobre**. Sem esta coluna, nada no banco distingue um snapshot que
-- fala de quinze dias de um que fala de trinta, e a primeira tela que somasse
-- os dois lados estaria somando períodos diferentes sem ter como perceber.
--
-- A alternativa era derivar da família — `FINANCIAMENTO_REAL` implica mensal. É
-- a mesma dedução que a `0099` desfez para o acervo, e pelo mesmo motivo: no
-- dia em que um segundo dataset mensal aparecer, ou em que o realizado passar a
-- chegar quinzenal por API, a dedução vira mentira em silêncio. Declarada, ela
-- é conferível.
--
-- ---------------------------------------------------------------------------
-- Por que não há backfill
-- ---------------------------------------------------------------------------
--
-- `NULL` descreve com precisão toda vigência anterior a esta coluna: ninguém
-- declarou granularidade nenhuma nelas. Quem as lê como quinzenais é a regra
-- (`granularidadeDoSnapshot`), e ela pode fazer isso com segurança porque até
-- aqui a quinzenal era a única que existia no produto. Preencher em massa
-- diria "alguém declarou isto" sobre snapshots em que ninguém declarou, e
-- apagaria a diferença entre o afirmado e o deduzido — a mesma razão da `0099`
-- e da `0101`.
--
-- ---------------------------------------------------------------------------
-- As duas tabelas, e por que são duas
-- ---------------------------------------------------------------------------
--
-- `finame_real_lancamento` é **derivada**: uma linha por linha do extrato, com
-- o documento contábil inteiro e o caminho de volta até a célula. Reimportar o
-- arquivo a reconstrói idêntica, porque a agregação é função pura das linhas
-- aceitas. Ela existe porque o consolidado mora em `fact` — onde herda rastreio,
-- revisão, exclusão e imutabilidade —, e `fact.raw_cell_id` aponta para uma
-- célula só, enquanto um valor consolidado nasce de várias.
--
-- `financiamento_real_decisao` é **decisão de gente**, e por isso está separada:
-- "fulano confirmou que estas duas linhas são o mesmo pagamento" não é
-- reconstruível por consulta nenhuma. É o mesmo corte que o Monitoramento de
-- Chamados já faz entre `ticket_movement_day` e `ticket_movement_review`, e é
-- ele que decide o destino de cada uma no `down` do bridge: a primeira entre as
-- descartáveis, a segunda entre as que exigem tabela vazia.
--
-- ---------------------------------------------------------------------------
-- Idempotente de ponta a ponta
-- ---------------------------------------------------------------------------
--
-- `IF NOT EXISTS` em tabela, coluna e índice, e o `DO $$` em cada constraint,
-- pela razão que a `0102` escreveu: o Development que já passou pelo bridge tem
-- o registro dando estas migrations por aplicadas, e um DDL cru reprova ali.

CREATE TABLE IF NOT EXISTS "finame_real_lancamento" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"import_run_id" uuid NOT NULL,
	"raw_row_id" bigint NOT NULL,
	"snapshot_id" uuid,
	"fact_id" bigint,
	"competencia" date NOT NULL,
	"placa" text NOT NULL,
	"placa_raw" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"numdoc" text NOT NULL,
	"codfil" text,
	"serie" text,
	"tipdoc" text,
	"conta_analitica" text,
	"conta_analitica_codigo" text,
	"conta_sintetica" text,
	"conta_sintetica_codigo" text,
	"codvei" text,
	"datatu" timestamp,
	"situac" text,
	"valor_absoluto" numeric(18, 6) NOT NULL,
	"valor_original" numeric(18, 6) NOT NULL,
	"rubrica" text NOT NULL,
	"chave_contabil_hash" text NOT NULL,
	"grupo_hash" text NOT NULL,
	"status" text NOT NULL,
	"motivo" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "financiamento_real_decisao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" text NOT NULL,
	"chave" text NOT NULL,
	"valor" text,
	"motivo" text NOT NULL,
	"decidido_por" text NOT NULL,
	"decidido_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_run" ADD COLUMN IF NOT EXISTS "declared_granularity" text;--> statement-breakpoint
ALTER TABLE "import_run" ADD COLUMN IF NOT EXISTS "declared_competence" date;--> statement-breakpoint
ALTER TABLE "snapshot" ADD COLUMN IF NOT EXISTS "granularidade" text;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finame_real_lancamento_import_run_id_import_run_id_fk') THEN
    ALTER TABLE "finame_real_lancamento" ADD CONSTRAINT "finame_real_lancamento_import_run_id_import_run_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_run"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finame_real_lancamento_raw_row_id_raw_row_id_fk') THEN
    ALTER TABLE "finame_real_lancamento" ADD CONSTRAINT "finame_real_lancamento_raw_row_id_raw_row_id_fk" FOREIGN KEY ("raw_row_id") REFERENCES "public"."raw_row"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finame_real_lancamento_snapshot_id_snapshot_id_fk') THEN
    ALTER TABLE "finame_real_lancamento" ADD CONSTRAINT "finame_real_lancamento_snapshot_id_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshot"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finame_real_lancamento_fact_id_fact_id_fk') THEN
    ALTER TABLE "finame_real_lancamento" ADD CONSTRAINT "finame_real_lancamento_fact_id_fact_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."fact"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "finame_real_lancamento_row_uq" ON "finame_real_lancamento" USING btree ("import_run_id","raw_row_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "finame_real_lancamento_run_idx" ON "finame_real_lancamento" USING btree ("import_run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "finame_real_lancamento_snapshot_idx" ON "finame_real_lancamento" USING btree ("snapshot_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "finame_real_lancamento_fact_idx" ON "finame_real_lancamento" USING btree ("fact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "finame_real_lancamento_placa_idx" ON "finame_real_lancamento" USING btree ("placa","competencia");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "finame_real_lancamento_status_idx" ON "finame_real_lancamento" USING btree ("status","competencia");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "finame_real_lancamento_raw_row_idx" ON "finame_real_lancamento" USING btree ("raw_row_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financiamento_real_decisao_chave_idx" ON "financiamento_real_decisao" USING btree ("tipo","chave","decidido_em");