CREATE TABLE `ai_configs` (
	`provider` text PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`base_url` text NOT NULL,
	`updated_at` integer NOT NULL
);
