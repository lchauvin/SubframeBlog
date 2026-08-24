CREATE TABLE `frame_gear` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`frame_id` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`key_label` text NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`frame_id`) REFERENCES `frames`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `frame_gear_frame_idx` ON `frame_gear` (`frame_id`);--> statement-breakpoint
INSERT INTO `frame_gear` (`frame_id`, `position`, `key_label`, `value`)
SELECT `frames`.`id`, `gear_items`.`position`, `gear_items`.`key_label`, `gear_items`.`value`
FROM `frames`
CROSS JOIN `gear_items`;