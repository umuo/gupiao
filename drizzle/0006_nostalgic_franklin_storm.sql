CREATE TABLE `paper_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`symbol` text NOT NULL,
	`stock_name` text NOT NULL,
	`strategy_id` text NOT NULL,
	`strategy_name` text NOT NULL,
	`strategy_definition` text NOT NULL,
	`initial_capital` real NOT NULL,
	`cash` real NOT NULL,
	`realized_pnl` real DEFAULT 0 NOT NULL,
	`position_percent` real DEFAULT 30 NOT NULL,
	`stop_loss` real DEFAULT 8 NOT NULL,
	`take_profit` real DEFAULT 22 NOT NULL,
	`commission_rate` real DEFAULT 0.00025 NOT NULL,
	`slippage_rate` real DEFAULT 0.001 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_price` real,
	`last_valuation_date` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_paper_accounts_user_name` ON `paper_accounts` (`user_id`,`name`);--> statement-breakpoint
CREATE INDEX `idx_paper_accounts_user_created` ON `paper_accounts` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `paper_equity_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`paper_account_id` text NOT NULL,
	`snapshot_date` text NOT NULL,
	`equity` real NOT NULL,
	`cash` real NOT NULL,
	`market_value` real NOT NULL,
	`total_return` real NOT NULL,
	`realized_pnl` real DEFAULT 0 NOT NULL,
	`unrealized_pnl` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_paper_equity_account_date` ON `paper_equity_snapshots` (`paper_account_id`,`snapshot_date`);--> statement-breakpoint
CREATE INDEX `idx_paper_equity_user_date` ON `paper_equity_snapshots` (`user_id`,`snapshot_date`);--> statement-breakpoint
CREATE TABLE `paper_positions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`paper_account_id` text NOT NULL,
	`symbol` text NOT NULL,
	`stock_name` text NOT NULL,
	`shares` integer NOT NULL,
	`average_cost` real NOT NULL,
	`last_price` real NOT NULL,
	`opened_at` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_paper_positions_account_symbol` ON `paper_positions` (`paper_account_id`,`symbol`);--> statement-breakpoint
CREATE INDEX `idx_paper_positions_user_id` ON `paper_positions` (`user_id`);--> statement-breakpoint
CREATE TABLE `paper_trades` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`paper_account_id` text NOT NULL,
	`automation_id` text,
	`action` text NOT NULL,
	`symbol` text NOT NULL,
	`stock_name` text NOT NULL,
	`shares` integer NOT NULL,
	`signal_price` real NOT NULL,
	`execution_price` real NOT NULL,
	`gross_amount` real NOT NULL,
	`commission` real NOT NULL,
	`realized_pnl` real DEFAULT 0 NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`bar_timestamp` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`executed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_paper_trades_account_idempotency` ON `paper_trades` (`paper_account_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_paper_trades_account_executed` ON `paper_trades` (`paper_account_id`,`executed_at`);--> statement-breakpoint
CREATE INDEX `idx_paper_trades_user_executed` ON `paper_trades` (`user_id`,`executed_at`);--> statement-breakpoint
ALTER TABLE `automations` ADD `paper_account_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_automations_paper_account_id` ON `automations` (`paper_account_id`);--> statement-breakpoint
PRAGMA optimize;
