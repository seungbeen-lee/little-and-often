CREATE TABLE `cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_email` text NOT NULL,
	`subject` text NOT NULL,
	`section` text NOT NULL,
	`area` text DEFAULT '' NOT NULL,
	`importance` integer DEFAULT 2 NOT NULL,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`correct_count` integer DEFAULT 0 NOT NULL,
	`incorrect_count` integer DEFAULT 0 NOT NULL,
	`last_reviewed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cards_owner_idx` ON `cards` (`owner_email`);--> statement-breakpoint
CREATE INDEX `cards_owner_subject_idx` ON `cards` (`owner_email`,`subject`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` integer NOT NULL,
	`owner_email` text NOT NULL,
	`mode` text NOT NULL,
	`result` text NOT NULL,
	`typed_answer` text,
	`reviewed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reviews_owner_idx` ON `reviews` (`owner_email`);--> statement-breakpoint
CREATE INDEX `reviews_card_idx` ON `reviews` (`card_id`);