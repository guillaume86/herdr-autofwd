// Rebuilds one mod on every change, straight into the throwaway home's mods folder, and
// checks it there: `pnpm dev <tool>`. Its window (`pnpm app`) reloads the mod on each save;
// a broken build or a failed check keeps the previous version on screen. Ctrl-C stops it.
import { context } from "esbuild";
import { watch } from "node:fs";
import { extname, join } from "node:path";
import { MOD_ASSETS, checkMod, claimModFolder, copyModFiles, modBuildOptions } from "./mods.ts";
import { APP_HOME, errorMessage, tools } from "./tools.ts";

const [name, ...rest] = process.argv.slice(2);
const all = tools();
const tool = all.find((t) => t.name === name);
if (!tool?.mod || rest.length > 0) {
  const withMod = all.filter((t) => t.mod).map((t) => t.name);
  console.error(`usage: pnpm dev <tool>   (tools with a mod: ${withMod.join(", ") || "none"})`);
  process.exit(2);
}

let target: string;
try {
  target = claimModFolder(tool.name, APP_HOME);
} catch (error) {
  console.error(`dev: ${errorMessage(error)}`);
  process.exit(1);
}
copyModFiles(tool, target);

const stamp = () => new Date().toTimeString().slice(0, 8);

const ctx = await context({
  ...modBuildOptions(tool, join(target, "main.js")),
  plugins: [
    {
      name: "herdr-app-check",
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length > 0) {
            console.error(`${stamp()} build failed; the app keeps the previous version`);
            return;
          }
          try {
            const r = checkMod(target, APP_HOME);
            if (r.ok) console.log(`${stamp()} ok${r.output ? `  ${r.output}` : ""}`);
            else console.error(`${stamp()} herdr-app check FAILED; the app keeps the previous version\n${r.output}`);
          } catch (error) {
            console.error(`${stamp()} not checked: ${errorMessage(error)}`);
          }
        });
      },
    },
  ],
});
await ctx.watch();
console.log(`dev: ${tool.name} -> ${target} (Ctrl-C to stop)`);

// mod.json and the assets are not part of the bundle: copy them again when they change.
watch(tool.dir, (_event, file) => {
  if (!file || (file !== "mod.json" && !MOD_ASSETS.has(extname(file).toLowerCase()))) return;
  try {
    copyModFiles(tool, target);
    console.log(`${stamp()} copied ${file}`);
  } catch (error) {
    console.error(`${stamp()} cannot copy ${file}: ${errorMessage(error)}`);
  }
});
