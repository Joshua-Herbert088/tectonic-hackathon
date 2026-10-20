ALTER TABLE "verifications" ADD COLUMN "conversation_id" text;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "message_id" integer;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;