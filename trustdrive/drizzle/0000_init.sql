CREATE TABLE `document_members` (
	`doc_id` text NOT NULL,
	`person_id` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`doc_id`, `person_id`),
	FOREIGN KEY (`doc_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`owner_id` text,
	`location` text NOT NULL,
	`status` text NOT NULL,
	`team_id` text NOT NULL,
	`tags` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_edited_by_id` text,
	`superseded_by_id` text,
	FOREIGN KEY (`owner_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`last_edited_by_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `edits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`doc_id` text NOT NULL,
	`person_id` text,
	`at` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`status` text NOT NULL,
	`location` text NOT NULL,
	`team_id` text NOT NULL,
	FOREIGN KEY (`doc_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `edits_doc_idx` ON `edits` (`doc_id`);--> statement-breakpoint
CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`team_id` text NOT NULL,
	`location` text NOT NULL,
	`active` integer NOT NULL,
	`joined_at` text NOT NULL,
	`left_at` text,
	`previous_team_id` text,
	`moved_team_at` text,
	`color` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`previous_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trust_scores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`doc_id` text NOT NULL,
	`viewer_id` text NOT NULL,
	`score` integer NOT NULL,
	`confidence` real NOT NULL,
	`level_probabilities` text NOT NULL,
	`model` text NOT NULL,
	`input_hash` text NOT NULL,
	`latency_ms` integer NOT NULL,
	`computed_at` text NOT NULL,
	FOREIGN KEY (`doc_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`viewer_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `trust_scores_doc_viewer_idx` ON `trust_scores` (`doc_id`,`viewer_id`,`id`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`doc_id` text NOT NULL,
	`person_id` text NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`doc_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `verifications_doc_idx` ON `verifications` (`doc_id`);--> statement-breakpoint
CREATE TABLE `views` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`doc_id` text NOT NULL,
	`person_id` text NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`doc_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `views_doc_idx` ON `views` (`doc_id`);