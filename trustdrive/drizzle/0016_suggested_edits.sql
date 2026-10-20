CREATE TABLE "suggested_edits" (
	"id" serial PRIMARY KEY NOT NULL,
	"answer_id" integer NOT NULL,
	"doc_id" text NOT NULL,
	"kind" text NOT NULL,
	"old_line" text,
	"new_line" text NOT NULL,
	"status" text NOT NULL,
	"created_at" text NOT NULL,
	"decided_at" text,
	"decided_by_id" text,
	"reason" text
);
--> statement-breakpoint
ALTER TABLE "answers" ADD COLUMN "edits_checked_at" text;--> statement-breakpoint
ALTER TABLE "suggested_edits" ADD CONSTRAINT "suggested_edits_answer_id_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggested_edits" ADD CONSTRAINT "suggested_edits_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggested_edits" ADD CONSTRAINT "suggested_edits_decided_by_id_people_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "suggested_edits_doc_idx" ON "suggested_edits" USING btree ("doc_id");--> statement-breakpoint
CREATE INDEX "suggested_edits_answer_idx" ON "suggested_edits" USING btree ("answer_id");