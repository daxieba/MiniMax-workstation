-- T5-1 每日复盘：reviews 表 + date 倒序索引
--
-- 一条复盘 = 一条 reviews 行
--   - 唯一约束：`date`（一天一条复盘）
--   - 5 段固定字段：completed / uncompleted / blockers / topThree / aiDraft
--   - JSON 字段全部用 text + Drizzle `mode: 'json'` 在应用层 (de)serialize
--   - aiDraft 可空（null = 未生成 / 已采纳后清空）
--
-- 索引：idx_reviews_date_desc（review:listRecent 按 date DESC 取最近 N 条）
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`completed` text DEFAULT '[]' NOT NULL,
	`uncompleted` text DEFAULT '[]' NOT NULL,
	`blockers` text DEFAULT '' NOT NULL,
	`top_three` text DEFAULT '[]' NOT NULL,
	`ai_draft` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_date_unique` ON `reviews` (`date`);
--> statement-breakpoint
CREATE INDEX `idx_reviews_date_desc` ON `reviews` (`date` DESC);
