CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recipient_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`kind` text NOT NULL,
	`doc_id` text NOT NULL,
	`doc_title` text NOT NULL,
	`other_doc_id` text,
	`other_doc_title` text,
	`changes` text NOT NULL,
	`reason` text,
	`created_at` text NOT NULL,
	`read_at` text,
	FOREIGN KEY (`recipient_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `notifications_recipient_idx` ON `notifications` (`recipient_id`,`id`);