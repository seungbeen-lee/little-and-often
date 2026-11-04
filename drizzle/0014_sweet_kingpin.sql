ALTER TABLE `cards` ADD `mastery_streak` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `cards` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `cards` ADD `archive_review_stage` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `cards` ADD `archive_review_due_at` text;--> statement-breakpoint
CREATE INDEX `cards_owner_archive_due_idx` ON `cards` (`owner_email`,`archived_at`,`archive_review_due_at`);