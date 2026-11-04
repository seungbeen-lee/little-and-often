ALTER TABLE `cards` ADD `keyword_success_streak` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `cards` ADD `full_write_success_streak` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `reviews` ADD `learning_kind` text;--> statement-breakpoint
ALTER TABLE `reviews` ADD `hint_used` integer DEFAULT false NOT NULL;