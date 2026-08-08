CREATE TABLE `automation_notification_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`automation_id` text NOT NULL,
	`notification_channel_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_automation_channels_automation_id` ON `automation_notification_channels` (`automation_id`);--> statement-breakpoint
CREATE INDEX `idx_automation_channels_channel_id` ON `automation_notification_channels` (`notification_channel_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_automation_channels_unique` ON `automation_notification_channels` (`automation_id`,`notification_channel_id`);--> statement-breakpoint
ALTER TABLE `notification_channels` ADD `type` text DEFAULT 'webhook' NOT NULL;--> statement-breakpoint
INSERT INTO `automation_notification_channels` (`id`, `user_id`, `automation_id`, `notification_channel_id`)
SELECT lower(hex(randomblob(16))), `user_id`, `id`, `notification_channel_id`
FROM `automations`
WHERE `notification_channel_id` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `automations` DROP COLUMN `notification_channel_id`;
