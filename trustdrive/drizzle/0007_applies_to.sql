-- A document applies to one or more countries (or Global) and optionally to teams within them.
-- Safe to run again: a database that already has the new columns is left as it is.
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "locations" jsonb;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'documents' AND column_name = 'location') THEN
    UPDATE "documents" SET "locations" = jsonb_build_array("location") WHERE "locations" IS NULL;
    ALTER TABLE "documents" ALTER COLUMN "location" DROP NOT NULL;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "locations" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "audience_team_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
