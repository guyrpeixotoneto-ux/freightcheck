-- Architectural invariants, enforced by the database rather than by
-- application convention. Application code cannot opt out of these.
--
--   1. RAW is immutable.
--   2. A CLOSED snapshot is immutable, and so are its facts.
--
-- Both are the backbone of the audit story: if either can be violated by a
-- stray UPDATE, no number in the product is trustworthy.

-- ---------------------------------------------------------------------------
-- 1. RAW is append-only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION freightcheck_raw_is_immutable()
RETURNS TRIGGER AS $$
BEGIN
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

CREATE TRIGGER source_file_immutable
  BEFORE UPDATE OR DELETE ON "source_file"
  FOR EACH ROW EXECUTE FUNCTION freightcheck_raw_is_immutable();
--> statement-breakpoint

CREATE TRIGGER raw_sheet_immutable
  BEFORE UPDATE OR DELETE ON "raw_sheet"
  FOR EACH ROW EXECUTE FUNCTION freightcheck_raw_is_immutable();
--> statement-breakpoint

CREATE TRIGGER raw_row_immutable
  BEFORE UPDATE OR DELETE ON "raw_row"
  FOR EACH ROW EXECUTE FUNCTION freightcheck_raw_is_immutable();
--> statement-breakpoint

CREATE TRIGGER raw_cell_immutable
  BEFORE UPDATE OR DELETE ON "raw_cell"
  FOR EACH ROW EXECUTE FUNCTION freightcheck_raw_is_immutable();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. A CLOSED snapshot is frozen
-- ---------------------------------------------------------------------------
-- The only mutation a CLOSED snapshot accepts is being stepped aside by a
-- newer revision (CLOSED -> SUPERSEDED), which records history rather than
-- erasing it. Every other field is locked, and SUPERSEDED is terminal.
CREATE OR REPLACE FUNCTION freightcheck_snapshot_is_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION
        'Snapshot % is % and cannot be deleted', OLD.id, OLD.status
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'DRAFT' THEN
    RETURN NEW;                       -- still being assembled
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

CREATE TRIGGER snapshot_immutable
  BEFORE UPDATE OR DELETE ON "snapshot"
  FOR EACH ROW EXECUTE FUNCTION freightcheck_snapshot_is_immutable();
--> statement-breakpoint

-- Facts belonging to a snapshot that is no longer DRAFT are frozen with it.
-- This is what makes "nunca sobrescrever silenciosamente" a structural
-- property: a correction must arrive as a new revision, never as an edit.
CREATE OR REPLACE FUNCTION freightcheck_fact_is_immutable()
RETURNS TRIGGER AS $$
DECLARE
  snap_status snapshot_status;
  target_snapshot uuid;
BEGIN
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

CREATE TRIGGER fact_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON "fact"
  FOR EACH ROW EXECUTE FUNCTION freightcheck_fact_is_immutable();
