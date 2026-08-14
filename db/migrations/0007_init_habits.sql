-- v0.4.0 习惯打卡 (Habits)
--
-- 两张表：
--   - habits: 用户定义的习惯（名称 / 图标 / 颜色 / 每周目标 / 归档）
--   - habit_logs: 打卡记录（habit_id, date 联合主键）
--
-- 索引：
--   - habit_logs 的 PK 索引（habit_id, date）天然支持"按 habit + 时间范围查"
--   - 加 (date) 单列索引支持"全局查今天打了几张卡"
CREATE TABLE `habits` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`icon` text DEFAULT '' NOT NULL,
	`color` text,
	`weekly_target` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `habit_logs` (
	`habit_id` text NOT NULL,
	`date` text NOT NULL,
	`logged_at` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	PRIMARY KEY (`habit_id`, `date`)
);
--> statement-breakpoint
CREATE INDEX `idx_habit_logs_date` ON `habit_logs` (`date`);
