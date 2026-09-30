CREATE TABLE `conflict_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`doc_id` text NOT NULL,
	`person_id` text NOT NULL,
	`at` text NOT NULL,
	`reason` text NOT NULL,
	`probability` real NOT NULL,
	`line_no` integer NOT NULL,
	`line_text` text NOT NULL,
	`existing_doc_id` text NOT NULL,
	`existing_title` text NOT NULL,
	`existing_line_no` integer NOT NULL,
	`existing_line_text` text NOT NULL,
	FOREIGN KEY (`doc_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `conflict_overrides_doc_idx` ON `conflict_overrides` (`doc_id`);--> statement-breakpoint
CREATE INDEX `conflict_overrides_existing_idx` ON `conflict_overrides` (`existing_doc_id`);