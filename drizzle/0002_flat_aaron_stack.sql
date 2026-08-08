CREATE TABLE `automations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`symbol` text NOT NULL,
	`stock_name` text NOT NULL,
	`strategy_id` text NOT NULL,
	`strategy_name` text NOT NULL,
	`strategy_definition` text NOT NULL,
	`data_mode` text DEFAULT 'daily' NOT NULL,
	`run_time` text DEFAULT '09:35' NOT NULL,
	`interval_minutes` integer DEFAULT 5 NOT NULL,
	`timezone` text DEFAULT 'Asia/Shanghai' NOT NULL,
	`weekdays` text DEFAULT '[1,2,3,4,5]' NOT NULL,
	`webhook_url` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`position_state` text DEFAULT 'flat' NOT NULL,
	`entry_price` real,
	`stop_loss` real DEFAULT 8 NOT NULL,
	`take_profit` real DEFAULT 22 NOT NULL,
	`last_checked_bar` integer,
	`last_run_date` text,
	`last_run_at` text,
	`last_signal_key` text,
	`last_notified_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_automations_user_id` ON `automations` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_automations_enabled_time` ON `automations` (`enabled`,`run_time`);--> statement-breakpoint
CREATE TABLE `notification_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`automation_id` text NOT NULL,
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
CREATE INDEX `idx_notification_logs_user_created` ON `notification_logs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_notification_logs_automation_id` ON `notification_logs` (`automation_id`);--> statement-breakpoint
ALTER TABLE `user_settings` ADD `tickflow_api_key_encrypted` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `tickflow_key_hint` text;