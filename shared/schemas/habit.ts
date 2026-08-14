/**
 * 习惯（Habit）IPC 共享 Zod schemas（v0.4.0）
 *
 * DTO（Habit / HabitLog）的 IPC shape 由 z.infer 推导并通过 `HabitParsed` /
 * `HabitLogParsed` 暴露给主进程 / preload / 渲染端共用。
 */
import { z } from 'zod';

/** 单条 Habit schema。 */
export const HabitSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(60),
  icon: z.string().max(16).default(''),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable(),
  weeklyTarget: z.number().int().min(0).max(7),
  archived: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

/** `z.infer` 推导的 Habit 类型（IPC DTO）。 */
export type HabitParsed = z.infer<typeof HabitSchema>;

/** Habit 列表 schema。 */
export const HabitListSchema = z.array(HabitSchema);

/** `habit:list` 入参 schema。 */
export const HabitListFilterSchema = z
  .object({
    archived: z.boolean().optional(),
  })
  .default({});

/** `habit:create` 入参 schema。 */
export const CreateHabitInputSchema = z.object({
  name: z.string().min(1).max(60),
  icon: z.string().max(16).optional().default(''),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .nullable()
    .optional(),
  weeklyTarget: z.number().int().min(0).max(7).optional().default(0),
});
export type CreateHabitInputParsed = z.infer<typeof CreateHabitInputSchema>;

/** `habit:update` 入参 schema。 */
export const UpdateHabitInputSchema = z.object({
  id: z.string().min(1).max(64),
  patch: z.object({
    name: z.string().min(1).max(60).optional(),
    icon: z.string().max(16).optional(),
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .nullable()
      .optional(),
    weeklyTarget: z.number().int().min(0).max(7).optional(),
    archived: z.boolean().optional(),
  }),
});
export type UpdateHabitInputParsed = z.infer<typeof UpdateHabitInputSchema>;

/** `habit:delete` 入参 schema。 */
export const DeleteHabitInputSchema = z.object({
  id: z.string().min(1).max(64),
});
export type DeleteHabitInputParsed = z.infer<typeof DeleteHabitInputSchema>;

/** `habit:archive` 入参 schema。 */
export const ArchiveHabitInputSchema = z.object({
  id: z.string().min(1).max(64),
  archived: z.boolean().optional().default(true),
});
export type ArchiveHabitInputParsed = z.infer<typeof ArchiveHabitInputSchema>;

/** 单条 HabitLog schema。 */
export const HabitLogSchema = z.object({
  habitId: z.string().min(1).max(64),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  loggedAt: z.number().int().nonnegative(),
  note: z.string().max(200).default(''),
});

/** `z.infer` 推导的 HabitLog 类型（IPC DTO）。 */
export type HabitLogParsed = z.infer<typeof HabitLogSchema>;

/** HabitLog 列表 schema。 */
export const HabitLogListSchema = z.array(HabitLogSchema);

/** `habit:toggleLog` 入参 schema：toggle 一个 habit 在某天是否打卡。 */
export const ToggleHabitLogInputSchema = z.object({
  habitId: z.string().min(1).max(64),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type ToggleHabitLogInputParsed = z.infer<typeof ToggleHabitLogInputSchema>;

/** `habit:listLogs` 入参 schema：列出某 habit 的所有 log。 */
export const ListHabitLogsInputSchema = z.object({
  habitId: z.string().min(1).max(64),
  /** 可选：限定日期范围（YYYY-MM-DD）。 */
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type ListHabitLogsInputParsed = z.infer<typeof ListHabitLogsInputSchema>;

/** `habit:logsInRange` 入参 schema：列出所有 habit 在某段时间的 log。 */
export const LogsInRangeInputSchema = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type LogsInRangeInputParsed = z.infer<typeof LogsInRangeInputSchema>;
