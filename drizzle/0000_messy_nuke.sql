CREATE TABLE `admin_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_login_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_users_username_idx` ON `admin_users` (`username`);--> statement-breakpoint
CREATE TABLE `annotations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`frame_id` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`label` text NOT NULL,
	`x_pct` real NOT NULL,
	`y_pct` real NOT NULL,
	`radius_px` real DEFAULT 28 NOT NULL,
	FOREIGN KEY (`frame_id`) REFERENCES `frames`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `annotations_frame_idx` ON `annotations` (`frame_id`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_user_idx` ON `auth_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `frame_filters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`frame_id` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`name` text NOT NULL,
	`sub_length_seconds` integer DEFAULT 0 NOT NULL,
	`kept_frames` integer DEFAULT 0 NOT NULL,
	`total_frames` integer DEFAULT 0 NOT NULL,
	`hours` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`frame_id`) REFERENCES `frames`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `frame_filters_frame_idx` ON `frame_filters` (`frame_id`);--> statement-breakpoint
CREATE TABLE `frame_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`frame_id` integer NOT NULL,
	`variant` text NOT NULL,
	`format` text NOT NULL,
	`path` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`bytes` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`frame_id`) REFERENCES `frames`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `frame_images_variant_idx` ON `frame_images` (`frame_id`,`variant`,`format`);--> statement-breakpoint
CREATE INDEX `frame_images_frame_idx` ON `frame_images` (`frame_id`);--> statement-breakpoint
CREATE TABLE `frames` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`catalog_id` text NOT NULL,
	`common_name` text DEFAULT '' NOT NULL,
	`frame_number` text DEFAULT '' NOT NULL,
	`revision` text DEFAULT '' NOT NULL,
	`captured_on` text NOT NULL,
	`palette` text DEFAULT 'HOO' NOT NULL,
	`bandwidth` text DEFAULT '3nm' NOT NULL,
	`total_integration_minutes` integer DEFAULT 0 NOT NULL,
	`meta_line` text DEFAULT '' NOT NULL,
	`blurb` text DEFAULT '' NOT NULL,
	`body_markdown` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`plate_catalog` text DEFAULT '' NOT NULL,
	`plate_class` text DEFAULT '' NOT NULL,
	`plate_constellation` text DEFAULT '' NOT NULL,
	`plate_distance` text DEFAULT '' NOT NULL,
	`plate_coordinates` text DEFAULT '' NOT NULL,
	`plate_palette` text DEFAULT '' NOT NULL,
	`plate_sessions` text DEFAULT '' NOT NULL,
	`plate_sky` text DEFAULT '' NOT NULL,
	`optics_label` text DEFAULT '' NOT NULL,
	`sensor_label` text DEFAULT '' NOT NULL,
	`arcsec_per_px` real,
	`published` integer DEFAULT false NOT NULL,
	`sort_index` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `frames_slug_idx` ON `frames` (`slug`);--> statement-breakpoint
CREATE INDEX `frames_captured_on_idx` ON `frames` (`captured_on`);--> statement-breakpoint
CREATE TABLE `gear_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`key_label` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `nights` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`frame_id` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`night_date` text NOT NULL,
	`filter_label` text DEFAULT '' NOT NULL,
	`sub_length_seconds` integer DEFAULT 0 NOT NULL,
	`kept` integer DEFAULT 0 NOT NULL,
	`rejected` integer DEFAULT 0 NOT NULL,
	`reason` text DEFAULT '—' NOT NULL,
	FOREIGN KEY (`frame_id`) REFERENCES `frames`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `nights_frame_idx` ON `nights` (`frame_id`);--> statement-breakpoint
CREATE TABLE `site_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_name` text DEFAULT 'Subframe' NOT NULL,
	`site_tagline` text DEFAULT 'MTL / Bortle 9' NOT NULL,
	`nav_log_label` text DEFAULT 'The log' NOT NULL,
	`nav_about_label` text DEFAULT 'About & rig' NOT NULL,
	`log_heading` text DEFAULT 'The log' NOT NULL,
	`log_pagination_label` text DEFAULT '' NOT NULL,
	`about_kicker` text DEFAULT 'About' NOT NULL,
	`about_heading` text DEFAULT '' NOT NULL,
	`about_body` text DEFAULT '' NOT NULL,
	`about_rig_label` text DEFAULT 'Current rig' NOT NULL,
	`about_hero_slug` text DEFAULT '' NOT NULL,
	`about_hero_caption` text DEFAULT '' NOT NULL,
	`prints_label` text DEFAULT 'Prints & licensing' NOT NULL,
	`prints_body` text DEFAULT '' NOT NULL,
	`prints_button_label` text DEFAULT 'Get in touch' NOT NULL,
	`contact_href` text DEFAULT '' NOT NULL,
	`footer_left` text DEFAULT '' NOT NULL,
	`footer_right` text DEFAULT '' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `site_stats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`value` text NOT NULL,
	`label` text NOT NULL
);
