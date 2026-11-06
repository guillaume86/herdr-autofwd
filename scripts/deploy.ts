// Copies built mods into a herdr-app home's mods folder: `pnpm deploy-mods [--real] [tool ...]`
// (default: every mod, into the throwaway home; --real: into the window you work in).
// Saving a mod's files makes the running app reload it; a broken one keeps the old
// version running, so the copy is checked again in place.
//
// Safety: a folder of a shipped mod, or one this repo did not create, is never touched
// (claimModFolder). Files the build no longer produces are removed from a claimed folder.
import { copyFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { APP_WRITTEN, MARKER, checkMod, claimModFolder, shippedMods } from "./mods.ts";
import { APP_HOME, DIST, REAL_APP_HOME, errorMessage } from "./tools.ts";

const args = process.argv.slice(2);
const real = args.includes("--real");
const home = real ? REAL_APP_HOME : APP_HOME;
const wanted = args.filter((arg) => arg !== "--real");
const flag = wanted.find((arg) => arg.startsWith("-"));
if (flag) {
  console.error(`deploy: unknown option ${flag} (usage: pnpm deploy-mods [--real] [tool ...])`);
  process.exit(2);
}

const built = join(DIST, "mods");
const available = existsSync(built) ? readdirSync(built) : [];
const unknown = wanted.filter((name) => !available.includes(name));
if (unknown.length > 0) {
  console.error(`deploy: no built mod ${unknown.join(", ")} (built: ${available.join(", ") || "none"})`);
  process.exit(1);
}

let shipped: Set<string>;
try {
  shipped = shippedMods(home);
} catch (error) {
  console.error(`deploy: ${errorMessage(error)}`);
  process.exit(1);
}

let failed = 0;
for (const name of wanted.length > 0 ? wanted : available) {
  let target: string;
  try {
    target = claimModFolder(name, home, shipped);
  } catch (error) {
    console.error(`${name}: skipped, ${errorMessage(error)}`);
    failed++;
    continue;
  }

  // main.js last: each save reloads the mod, and the last reload should see every file.
  const files = readdirSync(join(built, name))
    .filter((file) => !APP_WRITTEN(file))
    .sort((a, b) => Number(a === "main.js") - Number(b === "main.js"));
  const stale = readdirSync(target).filter((file) => file !== MARKER && !APP_WRITTEN(file) && !files.includes(file));
  for (const file of stale) rmSync(join(target, file), { recursive: true, force: true });
  for (const file of files) copyFileSync(join(built, name, file), join(target, file));

  try {
    const r = checkMod(target, home);
    if (r.ok) {
      console.log(`${name}: deployed to ${target}${stale.length > 0 ? ` (removed ${stale.join(", ")})` : ""}`);
    } else {
      failed++;
      console.error(`${name}: deployed but herdr-app check FAILED (the app keeps the previous version)\n${r.output}`);
    }
  } catch (error) {
    failed++;
    console.error(`${name}: deployed but not checked: ${errorMessage(error)}`);
  }
}
process.exit(failed > 0 ? 1 : 0);
