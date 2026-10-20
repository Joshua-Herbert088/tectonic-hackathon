CREATE TABLE "taxonomy_terms" (
	"kind" text NOT NULL,
	"id" text NOT NULL,
	"label" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parent_id" text,
	"created_at" text NOT NULL,
	CONSTRAINT "taxonomy_terms_kind_id_pk" PRIMARY KEY("kind","id")
);
