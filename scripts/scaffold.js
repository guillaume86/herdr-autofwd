// Making a tool folder from scripts/skeleton/, and the package.json edits that go with it.
// Plain JavaScript on purpose: scripts/create.js runs from node_modules after a
// `pnpm dlx` install, where Node refuses to strip types, and it imports this file.
// Checked by tsc through `checkJs` (tsconfig.cli.json).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** A tool name: a folder, a `bin` command and a herdr-app mod name at once. */
export const NAME_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** The mods herdr-app 0.1.13 ships, for when no app home is there to ask (installed.json). */
export const KNOWN_SHIPPED = new Set([
  "agents", "changes", "confirm", "files", "help", "machine-add", "menu", "new-menu", "pane", "peek", "picker",
  "prompt", "spaces", "tabs", "terminals-bar", "terminals-pane", "toast", "win98", "workspace-chrome",
  "workspace-status", "worktree",
]);

/** The herdr-app home the scripts use (see .env.example), for the shipped-mod check. */
export const defaultAppHome = () => process.env.HERDR_TOOLS_HOME || join(homedir(), ".config", "herdr-tools-app");

/**
 * The mod names an app home's installed.json lists, or null when there is none.
 * @param {string} home
 * @returns {Set<string> | null}
 */
export function shippedModsIn(home) {
  const file = join(home, "installed.json");
  if (!existsSync(file)) return null;
  return new Set(Object.keys(JSON.parse(readFileSync(file, "utf8"))).filter((name) => !name.includes(":")));
}

/**
 * Throws when `name` cannot be a tool: bad shape, or the name of a mod herdr-app ships.
 * @param {string} name
 * @param {Set<string> | null} [shipped] the shipped mods to check against (default: the app home's, else KNOWN_SHIPPED)
 */
export function validateName(name, shipped = shippedModsIn(defaultAppHome())) {
  if (!NAME_RE.test(name)) {
    throw new Error(`"${name}" is not a tool name: lowercase letters, digits and single dashes, starting with a letter (my-tool)`);
  }
  if ((shipped ?? KNOWN_SHIPPED).has(name)) throw new Error(`herdr-app ships a mod named "${name}"; pick another name`);
}

/** @param {string} name kebab-case */
const pascal = (name) => name.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
/** @param {string} name kebab-case */
const title = (name) => name.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");

/**
 * Writes src/tools/<name>/ from scripts/skeleton/, replacing __name__, __Name__ and __Title__.
 * @param {string} root the repo
 * @param {string} name
 * @returns {string[]} the files written, relative to the repo
 */
export function generateTool(root, name) {
  const skeleton = join(root, "scripts", "skeleton");
  const dir = join(root, "src", "tools", name);
  if (existsSync(dir)) throw new Error(`src/tools/${name} already exists`);
  mkdirSync(dir, { recursive: true });
  const written = [];
  for (const file of readdirSync(skeleton)) {
    const text = readFileSync(join(skeleton, file), "utf8")
      .replaceAll("__name__", name)
      .replaceAll("__Name__", pascal(name))
      .replaceAll("__Title__", title(name));
    writeFileSync(join(dir, file), text);
    written.push(`src/tools/${name}/${file}`);
  }
  return written;
}

/** @typedef {{ name?: string; bin?: Record<string, string>; [key: string]: unknown }} PackageJson */

/** @param {string} root @returns {PackageJson} */
export const readPackage = (root) => JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/** @param {string} root @param {PackageJson} pkg */
export const writePackage = (root, pkg) => writeFileSync(join(root, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

/** Adds the tool's `bin` entry (dist/cli/<name>.mjs), the way scripts/build.ts expects it. @param {string} root @param {string} name */
export function addBin(root, name) {
  const pkg = readPackage(root);
  pkg.bin = { ...pkg.bin, [name]: `dist/cli/${name}.mjs` };
  writePackage(root, pkg);
}

/** @param {string} root @param {string} name */
export function removeBin(root, name) {
  const pkg = readPackage(root);
  if (pkg.bin) delete pkg.bin[name];
  writePackage(root, pkg);
}
