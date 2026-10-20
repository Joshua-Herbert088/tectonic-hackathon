CREATE TABLE "board_threads" (
	"conversation_id" text PRIMARY KEY NOT NULL,
	"topics" jsonb NOT NULL,
	"locations" jsonb NOT NULL,
	"asked_ids" jsonb NOT NULL,
	"asked_at" text NOT NULL,
	"solved_message_id" integer
);
--> statement-breakpoint
DROP INDEX "answers_question_idx";--> statement-breakpoint
ALTER TABLE "answers" ADD COLUMN "sharing" text DEFAULT 'shared' NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "answer_sharing" text DEFAULT 'ask' NOT NULL;--> statement-breakpoint
ALTER TABLE "board_threads" ADD CONSTRAINT "board_threads_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_threads" ADD CONSTRAINT "board_threads_solved_message_id_messages_id_fk" FOREIGN KEY ("solved_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "answers_answer_idx" ON "answers" USING btree ("answer_message_id");--> statement-breakpoint
CREATE INDEX "answers_question_idx" ON "answers" USING btree ("question_message_id");