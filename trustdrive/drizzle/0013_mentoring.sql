CREATE TABLE "activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"kind" text NOT NULL,
	"at" text NOT NULL,
	"query" text,
	"doc_id" text,
	"results" integer
);
--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "mentor_id" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "mentor_since" text;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_person_idx" ON "activity" USING btree ("person_id","at");--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_mentor_id_people_id_fk" FOREIGN KEY ("mentor_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;