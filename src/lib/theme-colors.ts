/**
 * The colors every herdr theme names, light and dark alike. herdr types `theme()` as
 * `Record<string, string>` and lists the names only in its doc comment (herdr.d.ts), so
 * the list lives here as a value and theme-colors.test.ts compares it with that comment.
 */
export const COLOR_NAMES = [
  "background",
  "canvas",
  "chrome",
  "surface",
  "popover",
  "raised",
  "hover",
  "selected",
  "border",
  "input",
  "foreground",
  "muted",
  "dim",
  "accent",
  "accent_foreground",
  "solid",
  "solid_foreground",
  "selection",
  "working",
  "blocked",
  "done",
  "idle",
  "unknown",
] as const;

export type ColorName = (typeof COLOR_NAMES)[number] | `ansi${number}`;
