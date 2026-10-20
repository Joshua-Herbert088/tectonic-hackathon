-- Simulated client replies and their notifications are removed with the feature.
DELETE FROM "notifications" WHERE "actor_id" IS NULL;--> statement-breakpoint
DELETE FROM "messages" WHERE "simulated";--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "actor_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "simulated";--> statement-breakpoint
ALTER TABLE "notifications" DROP COLUMN "actor_name";