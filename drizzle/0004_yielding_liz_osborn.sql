CREATE TABLE IF NOT EXISTS `model_forecasts` (
	`id` text PRIMARY KEY NOT NULL,
	`league_code` text NOT NULL,
	`match_id` text NOT NULL,
	`kickoff_at` integer NOT NULL,
	`captured_at` integer NOT NULL,
	`source_observed_at` integer NOT NULL,
	`source_url` text NOT NULL,
	`source_updated_at` integer,
	`quote_provider` text NOT NULL,
	`quote_phase` text NOT NULL,
	`home_odds` real NOT NULL,
	`draw_odds` real NOT NULL,
	`away_odds` real NOT NULL,
	`raw_probabilities` text NOT NULL,
	`pick` integer NOT NULL,
	`conservative_probability` real NOT NULL,
	`old_score` integer NOT NULL,
	`new_score` integer NOT NULL,
	`model_version` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_model_forecasts_match_time` ON `model_forecasts` (`league_code`,`match_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_model_forecasts_captured_at` ON `model_forecasts` (`captured_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `model_outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`league_code` text NOT NULL,
	`match_id` text NOT NULL,
	`observed_at` integer NOT NULL,
	`state` text NOT NULL,
	`home_score` integer,
	`away_score` integer,
	`source_url` text NOT NULL,
	`detail` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_model_outcomes_match_time` ON `model_outcomes` (`league_code`,`match_id`,`observed_at`);
