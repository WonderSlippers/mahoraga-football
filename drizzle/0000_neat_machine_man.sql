CREATE TABLE `app_state` (
	`key` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`updated_at` integer NOT NULL
);
