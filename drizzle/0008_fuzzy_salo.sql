CREATE TABLE `frame_tiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`frame_id` integer NOT NULL,
	`path` text NOT NULL,
	`extension` text DEFAULT 'jpeg' NOT NULL,
	`tile_size` integer NOT NULL,
	`overlap` integer DEFAULT 0 NOT NULL,
	`max_level` integer NOT NULL,
	`min_level` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`tile_count` integer DEFAULT 0 NOT NULL,
	`bytes` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`frame_id`) REFERENCES `frames`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `frame_tiles_frame_idx` ON `frame_tiles` (`frame_id`);