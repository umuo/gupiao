PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_notification_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`automation_id` text,
	`notification_channel_id` text,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`symbol` text NOT NULL,
	`price` real,
	`reason` text DEFAULT '' NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`http_status` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_notification_logs`("id", "user_id", "automation_id", "notification_channel_id", "type", "status", "symbol", "price", "reason", "payload", "http_status", "created_at") SELECT "id", "user_id", "automation_id", "notification_channel_id", "type", "status", "symbol", "price", "reason", "payload", "http_status", "created_at" FROM `notification_logs`;--> statement-breakpoint
DROP TABLE `notification_logs`;--> statement-breakpoint
ALTER TABLE `__new_notification_logs` RENAME TO `notification_logs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_notification_logs_user_created` ON `notification_logs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_notification_logs_automation_id` ON `notification_logs` (`automation_id`);--> statement-breakpoint
ALTER TABLE `automations` DROP COLUMN `webhook_url`;