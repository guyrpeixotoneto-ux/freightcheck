-- A monthly figure and an annual one do not add up.
--
-- `calculated_impact` was a single number, and once the confirmed set grew
-- beyond a single periodicity it started claiming they did: one change set
-- reported "R$ -757.009,57" for what was really R$ -735 mil per year plus
-- R$ -88 mil per month. Summing those is precisely the error this product
-- exists to catch, so the scalar is replaced by a breakdown that cannot be
-- read as a total.
--
-- Annualising the two into one comparable figure is F4's work, and needs its
-- own confirmed rules. Change sets are derived data: recomputing rebuilds this.
ALTER TABLE "change_set" DROP COLUMN IF EXISTS "calculated_impact";
--> statement-breakpoint
ALTER TABLE "change_set"
  ADD COLUMN IF NOT EXISTS "calculated_impact_by_periodicity" jsonb DEFAULT '{}'::jsonb NOT NULL;
