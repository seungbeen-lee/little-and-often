CREATE TABLE `connection_attempt_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_email` text NOT NULL,
	`event_id` text NOT NULL,
	`card_id` integer NOT NULL,
	`connected` integer NOT NULL,
	`attempted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `connection_attempt_events_owner_idx` ON `connection_attempt_events` (`owner_email`);--> statement-breakpoint
CREATE UNIQUE INDEX `connection_attempt_events_owner_event_idx` ON `connection_attempt_events` (`owner_email`,`event_id`);--> statement-breakpoint
CREATE TABLE `connection_stats` (
	`card_id` integer PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`connected_count` integer DEFAULT 0 NOT NULL,
	`last_attempted_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `connection_stats_owner_idx` ON `connection_stats` (`owner_email`);