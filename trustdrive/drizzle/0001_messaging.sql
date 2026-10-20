ALTER TABLE "conversations" ADD COLUMN "participants" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "simulated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Existing conversations: everyone who wrote in them.
UPDATE "conversations" c SET "participants" = coalesce((
  SELECT jsonb_agg(DISTINCT jsonb_strip_nulls(jsonb_build_object('personId', m."person_id", 'name', m."author_name", 'email', m."author_email")))
  FROM "messages" m WHERE m."conversation_id" = c."id"
), '[]'::jsonb);
