ALTER TABLE "documents" ADD COLUMN "trashed_at" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "trashed_by_id" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "client_ids" jsonb;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_trashed_by_id_people_id_fk" FOREIGN KEY ("trashed_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;