/**
 * 桌面通知（v0.3.0）
 *
 * 渲染端调 `window.api.app.notify({ title, body, link? })` → 主进程触发系统通知。
 * - Zod 校验入参（防 XSS / 注入）
 * - link 可选（点击通知打开 URL）
 *
 * 不做的事：
 *   - 不接 push（本地通知 only）
 *   - 不做通知权限请求（用系统默认行为；Windows 上通知一般不需要显式请求权限）
 */
import { z } from 'zod';

const TITLE_MAX = 200;
const BODY_MAX = 1000;
const LINK_MAX = 2000;

export const NotifyInputSchema = z.object({
  /** 通知标题。 */
  title: z.string().min(1).max(TITLE_MAX),
  /** 通知正文。 */
  body: z.string().max(BODY_MAX).default(''),
  /** 可选：点击通知时打开的 URL（http/https 开头；外链）。 */
  link: z
    .string()
    .url()
    .max(LINK_MAX)
    .refine((s) => /^https?:\/\//i.test(s), { message: 'link must be http(s) URL' })
    .optional(),
});

export type NotifyInputParsed = z.infer<typeof NotifyInputSchema>;
