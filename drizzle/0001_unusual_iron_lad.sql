CREATE TABLE `odds_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` text NOT NULL,
	`league_code` text NOT NULL,
	`captured_at` integer NOT NULL,
	`home_odds` real,
	`draw_odds` real,
	`away_odds` real,
	`provider` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_odds_snapshots_match_time` ON `odds_snapshots` (`match_id`,`captured_at`);