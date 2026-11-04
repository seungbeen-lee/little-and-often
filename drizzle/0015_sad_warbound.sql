ALTER TABLE `reviews` ADD `statistics_only` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `reviews_owner_reviewed_at_idx` ON `reviews` (`owner_email`,`reviewed_at`);