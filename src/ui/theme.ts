import type { Color } from "gpui-kit";
import { theme } from "herdr";
import type { ColorName } from "../lib/theme-colors.ts";

export type { ColorName };
export type Palette = Record<ColorName, Color>;

/**
 * `theme()`, typed for gpui-kit: herdr declares its values as plain strings, and
 * gpui-kit's setters take `#…` colors. Call it in `render`; it follows the theme.
 */
export const colors = (): Palette => theme() as Palette;
