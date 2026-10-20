CREATE TABLE "document_opens" (
	"doc_id" text PRIMARY KEY NOT NULL,
	"at" text NOT NULL,
	"person_id" text NOT NULL,
	"previous_at" text,
	"previous_person_id" text
);
--> statement-breakpoint
ALTER TABLE "document_opens" ADD CONSTRAINT "document_opens_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_opens" ADD CONSTRAINT "document_opens_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_opens" ADD CONSTRAINT "document_opens_previous_person_id_people_id_fk" FOREIGN KEY ("previous_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;