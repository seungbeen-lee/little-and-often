CREATE TABLE `keyword_attempt_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_email` text NOT NULL,
	`event_id` text NOT NULL,
	`card_id` integer NOT NULL,
	`attempted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `keyword_attempt_events_owner_idx` ON `keyword_attempt_events` (`owner_email`);--> statement-breakpoint
CREATE UNIQUE INDEX `keyword_attempt_events_owner_event_idx` ON `keyword_attempt_events` (`owner_email`,`event_id`);--> statement-breakpoint
CREATE TABLE `keyword_stats` (
	`card_id` integer NOT NULL,
	`owner_email` text NOT NULL,
	`keyword_key` text NOT NULL,
	`keyword` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`correct_count` integer DEFAULT 0 NOT NULL,
	`last_attempted_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`card_id`, `keyword_key`),
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `keyword_stats_owner_idx` ON `keyword_stats` (`owner_email`);--> statement-breakpoint
CREATE INDEX `keyword_stats_owner_card_idx` ON `keyword_stats` (`owner_email`,`card_id`);