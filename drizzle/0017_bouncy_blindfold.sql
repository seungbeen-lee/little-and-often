CREATE TABLE `card_images` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `card_images_owner_idx` ON `card_images` (`owner_email`);--> statement-breakpoint
ALTER TABLE `cards` ADD `media` text DEFAULT '{}' NOT NULL;