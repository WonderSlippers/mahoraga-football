CREATE TABLE `market_results` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`league_code` text NOT NULL,
	`observed_at` integer NOT NULL,
	`state` text NOT NULL,
	`home_score` integer,
	`away_score` integer,
	`detail` text NOT NULL,
	`source_url` text NOT NULL,
	`fingerprint` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_market_results_match_time` ON `market_results` (`league_code`,`match_id`,`observed_at`);