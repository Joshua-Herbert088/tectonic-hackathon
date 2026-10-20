CREATE TABLE "answers" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"question_message_id" integer NOT NULL,
	"answer_message_id" integer NOT NULL,
	"asker_id" text NOT NULL,
	"answerer_id" text NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"asked_at" text NOT NULL,
	"answered_at" text NOT NULL,
	"topics" jsonb NOT NULL,
	"locations" jsonb NOT NULL,
	"client_id" text,
	"conflict" jsonb,
	"method" text NOT NULL,
	"faq_doc_id" text,
	"faq_dismissed_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "keep_private" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "answers_through_id" integer;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_question_message_id_messages_id_fk" FOREIGN KEY ("question_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_answer_message_id_messages_id_fk" FOREIGN KEY ("answer_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_asker_id_people_id_fk" FOREIGN KEY ("asker_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_answerer_id_people_id_fk" FOREIGN KEY ("answerer_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_faq_doc_id_documents_id_fk" FOREIGN KEY ("faq_doc_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "answers_question_idx" ON "answers" USING btree ("question_message_id");--> statement-breakpoint
CREATE INDEX "answers_answerer_idx" ON "answers" USING btree ("answerer_id");