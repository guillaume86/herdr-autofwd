// Loads every built mod with `herdr-app check`: it runs the module in the app's own
// runtime and renders it once, so a bad import or a missing API fails here, not on screen.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { checkMod } from "./mods.ts";
import { APP_HOME, DIST, errorMessage } from "./tools.ts";

const modsDir = join(DIST, "mods");
const mods = existsSync(modsDir) ? readdirSync(modsDir) : [];
if (mods.length === 0) {
  console.log("check-mods: no mod built");
  process.exit(0);
}

let failed = 0;
for (const name of mods) {
  try {
    const r = checkMod(join(modsDir, name), APP_HOME);
    if (r.ok) {
      console.log(`${name}: ok${r.output ? `  ${r.output}` : ""}`);
    } else {
      failed++;
      console.error(`${name}: FAILED\n${r.output}`);
    }
  } catch (error) {
    console.error(`check-mods: ${errorMessage(error)}`);
    process.exit(1);
  }
}
process.exit(failed > 0 ? 1 : 0);
