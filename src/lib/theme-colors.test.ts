import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { COLOR_NAMES } from "./theme-colors.ts";

// herdr names its theme colors only in the doc comment of `theme()`. When an app update
// adds or renames one, `pnpm typecheck` refreshes types/herdr.d.ts and this test fails.
test("COLOR_NAMES matches the theme() comment of types/herdr.d.ts", () => {
  const source = readFileSync(new URL("../../types/herdr.d.ts", import.meta.url), "utf8");
  const match = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*export function theme\(/.exec(source);
  assert.ok(match?.[1], "no doc comment before `export function theme(`");

  const text = match[1]
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\*\s?/, ""))
    .join(" ")
    .replace(/\([^)]*\)/g, " ");
  const list = /by name:\s*(.*?)\s*,?\s*ansi0\.\.ansi15/.exec(text);
  assert.ok(list?.[1], `cannot find the "by name: ... ansi0..ansi15" list in: ${text}`);

  const named = list[1]
    .split(/,|\band\b/)
    .map((s) => s.trim())
    .filter((s) => /^[a-z_]+$/.test(s));
  assert.deepEqual(new Set(named), new Set(COLOR_NAMES));
});
