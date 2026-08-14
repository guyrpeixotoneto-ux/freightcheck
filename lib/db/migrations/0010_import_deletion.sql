-- Excluir uma importação — a única porta pela qual RAW e vigência fechada saem
-- deste banco, e ela abre por dentro.
--
-- A `0001` proíbe UPDATE e DELETE em RAW, em snapshot fechado e nos fatos dele
-- por trigger, e não por convenção: é o que sustenta a frase "nenhum número
-- deste produto foi reescrito". Só que "não reescrever" e "não poder desfazer"
-- não são a mesma promessa. Um arquivo importado por engano — a planilha
-- errada, o mês errado, o export de teste — ficava no sistema para sempre,
-- somando fatos a vigências reais, e o SHA-256 ainda impedia que o arquivo
-- certo entrasse depois com aquele conteúdo. A resposta para isso não é
-- afrouxar a invariante; é dar a ela uma porta única, explícita e auditada.
--
-- Essa porta é `freightcheck.purge_import_run`: uma configuração **local à
-- transação** (`set_config(..., true)`), que morre no COMMIT ou no ROLLBACK e
-- nunca é herdada por outra conexão. Com ela ligada, e só com ela, as triggers
-- aceitam DELETE. O que continua proibido em qualquer circunstância é UPDATE
-- em RAW e edição de um snapshot fechado: apagar uma importação inteira é uma
-- operação que se declara e se registra; alterar uma célula no lugar continua
-- sendo o que este produto nunca faz.
--
-- E o registro é o resto da promessa. `import_deletion` guarda o que foi
-- apagado depois que a evidência já não existe — nome, SHA-256, vigências,
-- quanta coisa saiu, quem mandou e por quê —, e é ela própria imutável, sem
-- porta nenhuma. "Nunca descarte silenciosamente" vale para o descarte também.

-- ---------------------------------------------------------------------------
-- O registro do que foi apagado
-- ---------------------------------------------------------------------------
CREATE TABLE "import_deletion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_run_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"content_sha256" text NOT NULL,
	"run_status" text NOT NULL,
	"received_at" timestamp with time zone,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"restored_labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"removed" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deleted_by" text NOT NULL,
	"reason" text,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "import_deletion_deleted_at_idx" ON "import_deletion" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "import_deletion_sha256_idx" ON "import_deletion" USING btree ("content_sha256");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Chave estrangeira sem índice é varredura por linha apagada
-- ---------------------------------------------------------------------------
-- Estes índices não servem a nenhuma tela: servem ao caminho de escrita. Ao
-- apagar um fato o Postgres confere quem aponta para ele, e sem índice essa
-- conferência é uma varredura sequencial — por linha. Com um arquivo real
-- (41.391 fatos, 42.770 células) a exclusão levava 28 segundos; com eles, 2.
CREATE INDEX "fact_attribute_idx" ON "fact" USING btree ("attribute_id");--> statement-breakpoint
CREATE INDEX "snapshot_attribute_attribute_idx" ON "snapshot_attribute" USING btree ("attribute_id");--> statement-breakpoint
CREATE INDEX "column_mapping_attribute_idx" ON "column_mapping" USING btree ("target_attribute_id");--> statement-breakpoint
CREATE INDEX "staged_fact_raw_cell_idx" ON "staged_fact" USING btree ("raw_cell_id");--> statement-breakpoint
CREATE INDEX "validation_issue_sheet_idx" ON "validation_issue" USING btree ("raw_sheet_id");--> statement-breakpoint
CREATE INDEX "validation_issue_row_idx" ON "validation_issue" USING btree ("raw_row_id");--> statement-breakpoint
CREATE INDEX "validation_issue_cell_idx" ON "validation_issue" USING btree ("raw_cell_id");--> statement-breakpoint
CREATE INDEX "change_fact_a_idx" ON "change" USING btree ("fact_a_id");--> statement-breakpoint
CREATE INDEX "change_fact_b_idx" ON "change" USING btree ("fact_b_id");--> statement-breakpoint
CREATE INDEX "attribute_semantics_evidence_idx" ON "attribute_semantics" USING btree ("evidence_snapshot_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- A porta
-- ---------------------------------------------------------------------------
-- Guarda o id do run sendo apagado — serve de trava e de rastro: um `SHOW`
-- durante a transação diz qual importação justifica os DELETEs em curso.
CREATE OR REPLACE FUNCTION freightcheck_purge_em_curso()
RETURNS boolean AS $$
BEGIN
  RETURN COALESCE(current_setting('freightcheck.purge_import_run', true), '') <> '';
END;
$$ LANGUAGE plpgsql STABLE;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RAW: UPDATE nunca; DELETE só dentro de uma exclusão declarada
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION freightcheck_raw_is_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND freightcheck_purge_em_curso() THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION
    'RAW layer is immutable: % on % is not allowed (row id %)',
    TG_OP, TG_TABLE_NAME,
    COALESCE(
      to_jsonb(OLD) ->> 'id',
      '?'
    )
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Snapshot: some inteiro, ou desfaz a correção que o superou
-- ---------------------------------------------------------------------------
-- A segunda parte é o que impede uma exclusão de apagar mais do que apagou:
-- quando a importação excluída era a revisão 2 de uma vigência, a revisão 1
-- está SUPERSEDED e sumiria das telas junto com ela. Voltar a revisão anterior
-- para CLOSED é restaurar o estado anterior à importação — não é editar um
-- fechado, é desfazer o que a importação tinha feito com ele.
CREATE OR REPLACE FUNCTION freightcheck_snapshot_is_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'DRAFT' OR freightcheck_purge_em_curso() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION
      'Snapshot % is % and cannot be deleted', OLD.id, OLD.status
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status = 'DRAFT' THEN
    RETURN NEW;                       -- still being assembled
  END IF;

  -- SUPERSEDED -> CLOSED, e só durante uma exclusão: a revisão que superou
  -- esta está sendo apagada agora.
  IF freightcheck_purge_em_curso()
     AND OLD.status              = 'SUPERSEDED'
     AND NEW.status              = 'CLOSED'
     AND NEW.id                  = OLD.id
     AND NEW.source_file_id      = OLD.source_file_id
     AND NEW.import_run_id       = OLD.import_run_id
     AND NEW.source_system       = OLD.source_system
     AND NEW.source_label        = OLD.source_label
     AND NEW.effective_date      = OLD.effective_date
     AND NEW.scope_hash          = OLD.scope_hash
     AND NEW.entity_type_set     = OLD.entity_type_set
     AND NEW.revision            = OLD.revision
     AND NEW.entity_count        = OLD.entity_count
     AND NEW.fact_count          = OLD.fact_count
  THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'SUPERSEDED' THEN
    RAISE EXCEPTION
      'Snapshot % is SUPERSEDED and is terminal', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- OLD.status = 'CLOSED': allow only the supersede transition.
  IF NEW.status = 'SUPERSEDED'
     AND NEW.id                = OLD.id
     AND NEW.source_file_id    = OLD.source_file_id
     AND NEW.import_run_id     = OLD.import_run_id
     AND NEW.source_system     = OLD.source_system
     AND NEW.source_label      = OLD.source_label
     AND NEW.effective_date    = OLD.effective_date
     AND NEW.scope_hash        = OLD.scope_hash
     AND NEW.entity_type_set   = OLD.entity_type_set
     AND NEW.revision          = OLD.revision
     AND NEW.entity_count      = OLD.entity_count
     AND NEW.fact_count        = OLD.fact_count
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Snapshot % is CLOSED and immutable; only CLOSED -> SUPERSEDED is allowed',
    OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Fatos: saem junto com a vigência que os carrega, e só assim
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION freightcheck_fact_is_immutable()
RETURNS TRIGGER AS $$
DECLARE
  snap_status snapshot_status;
  target_snapshot uuid;
BEGIN
  IF TG_OP = 'DELETE' AND freightcheck_purge_em_curso() THEN
    RETURN OLD;
  END IF;

  target_snapshot := COALESCE(NEW.snapshot_id, OLD.snapshot_id);
  SELECT status INTO snap_status FROM "snapshot" WHERE id = target_snapshot;

  IF snap_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION
      'Snapshot % is %; its facts are immutable (% attempted)',
      target_snapshot, COALESCE(snap_status::text, 'MISSING'), TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- O registro da exclusão não tem porta
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION freightcheck_import_deletion_is_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'import_deletion is append-only: % is not allowed (row id %)',
    TG_OP, OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER import_deletion_immutable
  BEFORE UPDATE OR DELETE ON "import_deletion"
  FOR EACH ROW EXECUTE FUNCTION freightcheck_import_deletion_is_immutable();
