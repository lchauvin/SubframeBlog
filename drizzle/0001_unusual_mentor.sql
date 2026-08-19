CREATE TABLE `plate_solves` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`frame_id` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`submission_id` text DEFAULT '' NOT NULL,
	`job_id` text DEFAULT '' NOT NULL,
	`center_ra` real,
	`center_dec` real,
	`radius_deg` real,
	`pix_scale` real,
	`orientation` real,
	`objects_found` integer DEFAULT 0 NOT NULL,
	`annotations_written` integer DEFAULT 0 NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`frame_id`) REFERENCES `frames`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plate_solves_frame_idx` ON `plate_solves` (`frame_id`);--> statement-breakpoint
ALTER TABLE `annotations` ADD `source` text DEFAULT 'manual' NOT NULL;