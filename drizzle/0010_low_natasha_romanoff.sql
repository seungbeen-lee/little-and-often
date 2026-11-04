CREATE TABLE `study_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_email` text NOT NULL,
	`event_id` text NOT NULL,
	`subject` text NOT NULL,
	`total_count` integer NOT NULL,
	`correct_count` integer NOT NULL,
	`total_duration_ms` integer NOT NULL,
	`attempts` text DEFAULT '[]' NOT NULL,
	`completed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `study_runs_owner_idx` ON `study_runs` (`owner_email`);--> statement-breakpoint
CREATE INDEX `study_runs_owner_subject_idx` ON `study_runs` (`owner_email`,`subject`);--> statement-breakpoint
CREATE UNIQUE INDEX `study_runs_owner_event_idx` ON `study_runs` (`owner_email`,`event_id`);