ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "created_by" text;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "disabled_by" text;