CREATE TABLE `study_sets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_email` text NOT NULL,
	`subject` text NOT NULL,
	`name` text NOT NULL,
	`memo` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `study_sets_owner_idx` ON `study_sets` (`owner_email`);--> statement-breakpoint
CREATE INDEX `study_sets_owner_subject_idx` ON `study_sets` (`owner_email`,`subject`);--> statement-breakpoint
CREATE TABLE `study_set_cards` (
	`set_id` integer NOT NULL,
	`card_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`set_id`, `card_id`),
	FOREIGN KEY (`set_id`) REFERENCES `study_sets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `study_set_cards_set_idx` ON `study_set_cards` (`set_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `study_set_cards_card_idx` ON `study_set_cards` (`card_id`);
