ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "confidential" boolean DEFAULT false NOT NULL;
