CREATE TABLE "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"team_id" text NOT NULL,
	"location" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conflict_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"doc_id" text NOT NULL,
	"person_id" text NOT NULL,
	"at" text NOT NULL,
	"reason" text NOT NULL,
	"probability" double precision NOT NULL,
	"line_no" integer NOT NULL,
	"line_text" text NOT NULL,
	"existing_doc_id" text NOT NULL,
	"existing_title" text NOT NULL,
	"existing_line_no" integer NOT NULL,
	"existing_line_text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"title" text NOT NULL,
	"client_id" text,
	"imported_by_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_members" (
	"doc_id" text NOT NULL,
	"person_id" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "document_members_doc_id_person_id_pk" PRIMARY KEY("doc_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "document_sources" (
	"doc_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	CONSTRAINT "document_sources_doc_id_conversation_id_pk" PRIMARY KEY("doc_id","conversation_id")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"content" text NOT NULL,
	"owner_id" text,
	"location" text NOT NULL,
	"status" text NOT NULL,
	"team_id" text NOT NULL,
	"tags" jsonb NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"last_edited_by_id" text,
	"superseded_by_id" text,
	"client_id" text
);
--> statement-breakpoint
CREATE TABLE "edits" (
	"id" serial PRIMARY KEY NOT NULL,
	"doc_id" text NOT NULL,
	"person_id" text,
	"at" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"status" text NOT NULL,
	"location" text NOT NULL,
	"team_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"person_id" text,
	"author_name" text NOT NULL,
	"author_email" text,
	"sent_at" text NOT NULL,
	"body" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipient_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"kind" text NOT NULL,
	"doc_id" text NOT NULL,
	"doc_title" text NOT NULL,
	"other_doc_id" text,
	"other_doc_title" text,
	"changes" jsonb NOT NULL,
	"reason" text,
	"created_at" text NOT NULL,
	"read_at" text
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"team_id" text NOT NULL,
	"location" text NOT NULL,
	"active" boolean NOT NULL,
	"joined_at" text NOT NULL,
	"left_at" text,
	"previous_team_id" text,
	"moved_team_at" text,
	"color" text NOT NULL,
	"email" text,
	"phone" text
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trust_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"doc_id" text NOT NULL,
	"viewer_id" text NOT NULL,
	"score" integer NOT NULL,
	"confidence" double precision NOT NULL,
	"level_probabilities" jsonb NOT NULL,
	"model" text NOT NULL,
	"input_hash" text NOT NULL,
	"latency_ms" integer NOT NULL,
	"computed_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"doc_id" text NOT NULL,
	"person_id" text NOT NULL,
	"at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "views" (
	"id" serial PRIMARY KEY NOT NULL,
	"doc_id" text NOT NULL,
	"person_id" text NOT NULL,
	"at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_overrides" ADD CONSTRAINT "conflict_overrides_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_overrides" ADD CONSTRAINT "conflict_overrides_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_imported_by_id_people_id_fk" FOREIGN KEY ("imported_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_members" ADD CONSTRAINT "document_members_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_members" ADD CONSTRAINT "document_members_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_sources" ADD CONSTRAINT "document_sources_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_sources" ADD CONSTRAINT "document_sources_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_id_people_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_last_edited_by_id_people_id_fk" FOREIGN KEY ("last_edited_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edits" ADD CONSTRAINT "edits_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edits" ADD CONSTRAINT "edits_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_people_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_people_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_previous_team_id_teams_id_fk" FOREIGN KEY ("previous_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_scores" ADD CONSTRAINT "trust_scores_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_scores" ADD CONSTRAINT "trust_scores_viewer_id_people_id_fk" FOREIGN KEY ("viewer_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "views" ADD CONSTRAINT "views_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "views" ADD CONSTRAINT "views_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conflict_overrides_doc_idx" ON "conflict_overrides" USING btree ("doc_id");--> statement-breakpoint
CREATE INDEX "conflict_overrides_existing_idx" ON "conflict_overrides" USING btree ("existing_doc_id");--> statement-breakpoint
CREATE INDEX "conversations_client_idx" ON "conversations" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "edits_doc_idx" ON "edits" USING btree ("doc_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "people_email_idx" ON "people" USING btree ("email");--> statement-breakpoint
CREATE INDEX "trust_scores_doc_viewer_idx" ON "trust_scores" USING btree ("doc_id","viewer_id","id");--> statement-breakpoint
CREATE INDEX "verifications_doc_idx" ON "verifications" USING btree ("doc_id");--> statement-breakpoint
CREATE INDEX "views_doc_idx" ON "views" USING btree ("doc_id");