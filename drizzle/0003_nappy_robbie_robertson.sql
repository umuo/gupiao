CREATE TABLE `notification_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`method` text DEFAULT 'POST' NOT NULL,
	`headers_encrypted` text NOT NULL,
	`header_names` text DEFAULT '[]' NOT NULL,
	`content_type` text DEFAULT 'application/json' NOT NULL,
	`message_template` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_test_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_notification_channels_user_id` ON `notification_channels` (`user_id`);--> statement-breakpoint
ALTER TABLE `automations` ADD `notification_channel_id` text;--> statement-breakpoint
ALTER TABLE `notification_logs` ADD `notification_channel_id` text;