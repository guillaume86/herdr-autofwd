import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const ROOT = join(import.meta.dirname, "..");
export const DIST = join(ROOT, "dist");

// .env (see .env.example) fills in what the shell did not set.
try {
  process.loadEnvFile(join(ROOT, ".env"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const expandHome = (path: string) => (path === "~" || path.startsWith("~/") || path.startsWith("~\\") ? join(homedir(), path.slice(1)) : path);

/**
 * The herdr-app home the scripts use: a throwaway by default, so testing a mod never
 * touches the window you work in. `pnpm app` opens its window; `herdr-app check` runs in it.
 */
export const APP_HOME = expandHome(process.env.HERDR_TOOLS_HOME || join(homedir(), ".config", "herdr-tools-app"));

/** The home of the window you work in, for `pnpm deploy-mods --real`. */
export const REAL_APP_HOME = expandHome(process.env.HERDR_TOOLS_REAL_HOME || join(homedir(), ".config", "herdr-app"));

/** The herdr-app program the scripts run: `herdr-app` on PATH, or the path .env names. */
export const APP_BIN = expandHome(process.env.HERDR_TOOLS_APP_BIN || "herdr-app");

/** The environment for a `herdr-app` run against `home`. */
export const appEnv = (home: string): NodeJS.ProcessEnv => ({ ...process.env, HERDR_APP_HOME: home });

export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export interface Tool {
  name: string;
  dir: string;
  /** `cli.ts`, when the tool has a command line. */
  cli: string | null;
  /** `mod.ts`, when the tool has a herdr-app mod (then `mod.json` is required). */
  mod: string | null;
}

/** Every folder of src/tools with a `core.ts`. Entry points sit at the folder's root. */
export function tools(): Tool[] {
  const base = join(ROOT, "src", "tools");
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(base, d.name, "core.ts")))
    .map((d) => {
      const dir = join(base, d.name);
      const file = (name: string) => (existsSync(join(dir, name)) ? join(dir, name) : null);
      const tool = { name: d.name, dir, cli: file("cli.ts"), mod: file("mod.ts") };
      if (tool.mod && !file("mod.json")) throw new Error(`${d.name}: mod.ts needs a mod.json next to it`);
      return tool;
    });
}
