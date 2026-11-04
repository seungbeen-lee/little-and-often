CREATE TABLE `study_progress` (
	`owner_email` text NOT NULL,
	`context_key` text NOT NULL,
	`next_card_id` integer NOT NULL,
	`sequence_ids` text DEFAULT '[]' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`owner_email`, `context_key`)
);
--> statement-breakpoint
CREATE INDEX `study_progress_owner_idx` ON `study_progress` (`owner_email`);--> statement-breakpoint
ALTER TABLE `reviews` ADD `event_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_owner_event_idx` ON `reviews` (`owner_email`,`event_id`);