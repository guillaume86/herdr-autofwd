// What build, dev, check-mods and deploy share about herdr-app mods: how a mod is bundled,
// which files go with it, how `herdr-app check` is run, and which folders in an app home's
// mods/ this repo may write to.
import type { BuildOptions, Metafile } from "esbuild";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { APP_BIN, ROOT, type Tool, appEnv } from "./tools.ts";

/**
 * Modules herdr-app's runtime provides: left as imports, never bundled.
 * The list mirrors the `declare module` blocks of its gpui-kit.d.ts, plus `herdr`;
 * `herdr-app check` loads every built mod, which catches a drift.
 */
export const HERDR_PROVIDED = [
  "herdr",
  "gpui",
  "gpui-kit",
  "gpui-base",
  "gpui-component",
  "gpui-shell",
  "gpui-fps",
  "buffer",
  "console",
  "crypto",
  "fs/promises",
  "net",
  "os",
  "path",
  "process",
  "url",
  "websocket",
  "zlib",
];

/** Files of a tool folder that go with its mod, next to main.js and mod.json. */
export const MOD_ASSETS = new Set([".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp"]);

/** esbuild options for a mod: neither Node nor a browser, but QuickJS with herdr's modules. */
export function modBuildOptions(tool: Tool, outfile: string): BuildOptions {
  if (!tool.mod) throw new Error(`${tool.name} has no mod.ts`);
  return {
    entryPoints: [tool.mod],
    outfile,
    bundle: true,
    platform: "neutral",
    mainFields: ["module", "main"],
    format: "esm",
    target: "es2022",
    external: HERDR_PROVIDED,
    // Readable on purpose: herdr-app reports errors by line of main.js.
    minify: false,
    legalComments: "inline",
    logLevel: "warning",
    // To list what npm packages went in (bundledPackages).
    metafile: true,
  };
}

/** The npm packages a bundle pulled in. They run on QuickJS: only `herdr-app check` says if they can. */
export function bundledPackages(metafile: Metafile): string[] {
  const names = new Set<string>();
  for (const input of Object.keys(metafile.inputs)) {
    const m = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(input.replaceAll("\\", "/"));
    if (m?.[1]) names.add(m[1]);
  }
  return [...names].sort();
}

/** Copies mod.json and the assets of a tool into `out`; returns their names. */
export function copyModFiles(tool: Tool, out: string): string[] {
  mkdirSync(out, { recursive: true });
  const files = ["mod.json", ...readdirSync(tool.dir).filter((file) => MOD_ASSETS.has(extname(file).toLowerCase()))];
  for (const file of files) copyFileSync(join(tool.dir, file), join(out, file));
  return files;
}

/** `herdr-app check <folder>` against `home`: loads the mod in the app's runtime and renders it once. */
export function checkMod(folder: string, home: string): { ok: boolean; output: string } {
  const r = spawnSync(APP_BIN, ["check", folder], { encoding: "utf8", env: appEnv(home) });
  if (r.error) throw new Error(`cannot run ${APP_BIN} (${r.error.message}): is it installed and on PATH, or named in .env?`);
  return { ok: r.status === 0, output: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

/** Written into each folder this repo deploys. Hidden, so herdr-app does not reload on it. */
export const MARKER = ".herdr-tools";

/** Files herdr-app writes into a mod folder itself (`herdr-app check` adds them to dist/ too). */
export const APP_WRITTEN = (file: string) => file === "jsconfig.json" || file.endsWith(".d.ts");

/** The names of the mods herdr-app ships (installed.json of `home`), which it replaces on every start. */
export function shippedMods(home: string): Set<string> {
  const file = join(home, "installed.json");
  if (!existsSync(file)) {
    throw new Error(`no installed.json in ${home}: herdr-app never started there (\`pnpm app\` opens the throwaway's window)`);
  }
  return new Set(Object.keys(JSON.parse(readFileSync(file, "utf8")) as object));
}

/**
 * `home`'s mods/<name> folder, created if needed and marked as this repo's. Refuses the
 * name of a shipped mod, and a folder that exists without the marker (not deployed from here).
 */
export function claimModFolder(name: string, home: string, shipped: Set<string> = shippedMods(home)): string {
  if (shipped.has(name)) throw new Error(`herdr-app ships a mod named ${name}; rename the tool folder`);
  const target = join(home, "mods", name);
  if (existsSync(target) && !existsSync(join(target, MARKER))) {
    throw new Error(`${target} exists and was not deployed from this repo`);
  }
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, MARKER), `Deployed by ${ROOT}; edit the sources there, not here.\n`);
  return target;
}
