ALTER TABLE `frames` ADD `parent_frame_id` integer REFERENCES frames(id);--> statement-breakpoint
ALTER TABLE `frames` ADD `revision_kind` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `frames_parent_idx` ON `frames` (`parent_frame_id`);