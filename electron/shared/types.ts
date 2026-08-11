/**
 * 主进程 / 预加载共享类型
 *
 * 跨进程共享类型也可以放在项目根的 `shared/` 目录（参见 PROJECT_IDENTITY.md §2.3）。
 */

import { z } from 'zod';

/** 应用版本号（来自 package.json）。 */
export type AppVersion = string;

/**
 * 主题源（与 Electron `nativeTheme.themeSource` 保持一致）。
 *  - `system` 跟随操作系统
 *  - `light` / `dark` 强制指定
 */
export const ThemeSourceSchema = z.enum(['light', 'dark', 'system']);

/** 解析后的实际主题（`system` 模式下由 main 进程给出）。 */
export const ResolvedThemeSchema = z.enum(['light', 'dark']);

/** 主题源类型。 */
export type ThemeSource = z.infer<typeof ThemeSourceSchema>;

/** 解析后主题类型。 */
export type ResolvedTheme = z.infer<typeof ResolvedThemeSchema>;
