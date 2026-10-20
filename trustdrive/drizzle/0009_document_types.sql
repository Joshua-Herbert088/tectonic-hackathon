-- Document types: FAQ is folded into Guide (which takes over its keywords), and Informal is added for
-- notes, tips and know-how. Only for a taxonomy that's already stored; a new database is seeded with the
-- new defaults instead.
UPDATE "documents" SET "tags" = CASE WHEN "tags" ? 'guide' THEN "tags" - 'faq' ELSE ("tags" - 'faq') || '["guide"]'::jsonb END WHERE "tags" ? 'faq';--> statement-breakpoint
DELETE FROM "taxonomy_terms" WHERE "kind" = 'docType' AND "id" = 'faq';--> statement-breakpoint
UPDATE "taxonomy_terms" SET "description" = 'Explanations, questions and answers, troubleshooting and quick fixes',
  "keywords" = "keywords" || '["faq","q:","vraag","question","frage"]'::jsonb
WHERE "kind" = 'docType' AND "id" = 'guide' AND NOT "keywords" ? 'faq';--> statement-breakpoint
INSERT INTO "taxonomy_terms" ("kind", "id", "label", "description", "keywords", "parent_id", "created_at")
SELECT 'docType', 'informal', 'Informal', 'Notes, tips and know-how written down informally – not an official policy or procedure',
  '["notes","note","tips","tip","fyi","quick note","good to know","notities","weetje","astuce","bon a savoir","notizen","hinweis","tipp"]'::jsonb, NULL, to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
WHERE EXISTS (SELECT 1 FROM "taxonomy_terms") AND NOT EXISTS (SELECT 1 FROM "taxonomy_terms" WHERE "kind" = 'docType' AND "id" = 'informal');
