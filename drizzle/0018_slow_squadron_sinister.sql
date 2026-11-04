ALTER TABLE `reviews` ADD `coverage` text DEFAULT 'full' NOT NULL;--> statement-breakpoint
ALTER TABLE `reviews` ADD `keyword_ids` text DEFAULT '[]' NOT NULL;