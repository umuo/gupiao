CREATE TABLE `automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`automation_id` text NOT NULL,
	`trigger` text NOT NULL,
	`schedule_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`lease_owner` text,
	`lease_expires_at` text,
	`next_retry_at` text,
	`started_at` text,
	`finished_at` text,
	`action` text,
	`price` real,
	`reason` text DEFAULT '' NOT NULL,
	`source` text,
	`delivery_total` integer DEFAULT 0 NOT NULL,
	`delivery_succeeded` integer DEFAULT 0 NOT NULL,
	`delivery_failed` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_automation_runs_schedule` ON `automation_runs` (`automation_id`,`schedule_key`);--> statement-breakpoint
CREATE INDEX `idx_automation_runs_user_created` ON `automation_runs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_automation_runs_automation_created` ON `automation_runs` (`automation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_automation_runs_retry` ON `automation_runs` (`status`,`next_retry_at`);--> statement-breakpoint
CREATE TABLE `strategy_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`strategy_id` text NOT NULL,
	`version` integer NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`tag` text DEFAULT '自定义' NOT NULL,
	`definition` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_strategy_versions_strategy_version` ON `strategy_versions` (`strategy_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_strategy_versions_user_created` ON `strategy_versions` (`user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `automations` ADD `strategy_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `automations` ADD `strategy_snapshot_hash` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `automations` ADD `last_status` text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE `automations` ADD `last_error` text;--> statement-breakpoint
ALTER TABLE `automations` ADD `consecutive_failures` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `automations` ADD `lease_owner` text;--> statement-breakpoint
ALTER TABLE `automations` ADD `lease_expires_at` text;--> statement-breakpoint
ALTER TABLE `custom_strategies` ADD `current_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `paper_accounts` ADD `strategy_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `paper_accounts` ADD `strategy_snapshot_hash` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
INSERT INTO `strategy_versions` (`id`, `user_id`, `strategy_id`, `version`, `name`, `description`, `tag`, `definition`, `content_hash`, `created_at`)
SELECT lower(hex(randomblob(16))), `user_id`, `id`, 1, `name`, `description`, `tag`, `definition`, 'legacy:' || lower(substr(hex(`definition`), 1, 24)), `created_at`
FROM `custom_strategies`;--> statement-breakpoint
UPDATE `paper_accounts`
SET `strategy_snapshot_hash` = 'legacy:' || lower(substr(hex(`strategy_definition`), 1, 24))
WHERE `strategy_snapshot_hash` = 'legacy';--> statement-breakpoint
UPDATE `automations`
SET `strategy_snapshot_hash` = 'legacy:' || lower(substr(hex(`strategy_definition`), 1, 24))
WHERE `strategy_snapshot_hash` = 'legacy';--> statement-breakpoint
PRAGMA optimize;
