CREATE TABLE IF NOT EXISTS "assistant_conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"state" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assistant_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"evidence" jsonb,
	"writer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'assistant_conversation_owner_id_app_user_id_fk'
                   AND conrelid = '"assistant_conversation"'::regclass) THEN
ALTER TABLE "assistant_conversation" ADD CONSTRAINT "assistant_conversation_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'assistant_message_conversation_id_assistant_conversation_id_fk'
                   AND conrelid = '"assistant_message"'::regclass) THEN
ALTER TABLE "assistant_message" ADD CONSTRAINT "assistant_message_conversation_id_assistant_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."assistant_conversation"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_conversation_owner_idx" ON "assistant_conversation" USING btree ("owner_id","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_message_conversation_idx" ON "assistant_message" USING btree ("conversation_id","position");