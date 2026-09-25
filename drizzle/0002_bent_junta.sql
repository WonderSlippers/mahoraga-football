CREATE TABLE `market_quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`league_code` text NOT NULL,
	`home` text NOT NULL,
	`away` text NOT NULL,
	`kickoff_at` integer NOT NULL,
	`captured_at` integer NOT NULL,
	`market` text NOT NULL,
	`line` real NOT NULL,
	`over_odds` real NOT NULL,
	`under_odds` real NOT NULL,
	`provider` text NOT NULL,
	`phase` text NOT NULL,
	`source_url` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_market_quotes_match_time` ON `market_quotes` (`league_code`,`match_id`,`captured_at`);