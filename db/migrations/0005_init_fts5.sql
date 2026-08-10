-- 注：FTS5 全文搜索虚拟表 + 同步触发器（T4-2 全文搜索）。
-- 三张 FTS5 虚拟表，分别索引 notes / inbox_items / tasks 的可搜索字段。
-- 模式：contentless + external content（content + content_rowid）。
-- 触发器：每张 source 表 3 个（INSERT / UPDATE / DELETE）做双向同步。
-- 分词器：trigram —— SQLite 3.34+ 支持，对中英混合 query 都可用。
--   - 英文 / 数字：每个连续 3 字符作为一个 token
--   - 中文：每个连续 3 字符作为一个 token（≥3 字符的子串可搜）
--   - 单字符 / 双字符中文：不在索引内（SQLite FTS5 trigram 固有限制）
CREATE VIRTUAL TABLE `notes_fts` USING fts5(
  `title`,
  `content`,
  `tags`,
  content='notes',
  content_rowid='rowid',
  tokenize='trigram'
);
--> statement-breakpoint
CREATE VIRTUAL TABLE `inbox_fts` USING fts5(
  `content`,
  content='inbox_items',
  content_rowid='rowid',
  tokenize='trigram'
);
--> statement-breakpoint
CREATE VIRTUAL TABLE `tasks_fts` USING fts5(
  `title`,
  `description`,
  content='tasks',
  content_rowid='rowid',
  tokenize='trigram'
);
--> statement-breakpoint
CREATE TRIGGER `notes_ai` AFTER INSERT ON `notes` BEGIN
  INSERT INTO `notes_fts`(rowid, title, content, tags) VALUES (new.rowid, new.title, new.content, new.tags);
END;
--> statement-breakpoint
CREATE TRIGGER `notes_ad` AFTER DELETE ON `notes` BEGIN
  INSERT INTO `notes_fts`(`notes_fts`, rowid, title, content, tags) VALUES('delete', old.rowid, old.title, old.content, old.tags);
END;
--> statement-breakpoint
CREATE TRIGGER `notes_au` AFTER UPDATE ON `notes` BEGIN
  INSERT INTO `notes_fts`(`notes_fts`, rowid, title, content, tags) VALUES('delete', old.rowid, old.title, old.content, old.tags);
  INSERT INTO `notes_fts`(rowid, title, content, tags) VALUES (new.rowid, new.title, new.content, new.tags);
END;
--> statement-breakpoint
CREATE TRIGGER `inbox_items_ai` AFTER INSERT ON `inbox_items` BEGIN
  INSERT INTO `inbox_fts`(rowid, content) VALUES (new.rowid, new.content);
END;
--> statement-breakpoint
CREATE TRIGGER `inbox_items_ad` AFTER DELETE ON `inbox_items` BEGIN
  INSERT INTO `inbox_fts`(`inbox_fts`, rowid, content) VALUES('delete', old.rowid, old.content);
END;
--> statement-breakpoint
CREATE TRIGGER `inbox_items_au` AFTER UPDATE ON `inbox_items` BEGIN
  INSERT INTO `inbox_fts`(`inbox_fts`, rowid, content) VALUES('delete', old.rowid, old.content);
  INSERT INTO `inbox_fts`(rowid, content) VALUES (new.rowid, new.content);
END;
--> statement-breakpoint
CREATE TRIGGER `tasks_ai` AFTER INSERT ON `tasks` BEGIN
  INSERT INTO `tasks_fts`(rowid, title, description) VALUES (new.rowid, new.title, IFNULL(new.description, ''));
END;
--> statement-breakpoint
CREATE TRIGGER `tasks_ad` AFTER DELETE ON `tasks` BEGIN
  INSERT INTO `tasks_fts`(`tasks_fts`, rowid, title, description) VALUES('delete', old.rowid, old.title, IFNULL(old.description, ''));
END;
--> statement-breakpoint
CREATE TRIGGER `tasks_au` AFTER UPDATE ON `tasks` BEGIN
  INSERT INTO `tasks_fts`(`tasks_fts`, rowid, title, description) VALUES('delete', old.rowid, old.title, IFNULL(old.description, ''));
  INSERT INTO `tasks_fts`(rowid, title, description) VALUES (new.rowid, new.title, IFNULL(new.description, ''));
END;
