// Bundles each tool twice from the same core:
//   dist/cli/<tool>.mjs        a Node script (no TypeScript needed to run it)
//   dist/mods/<tool>/main.js   a herdr-app mod, plus its mod.json and assets
// and checks that package.json's "bin" names exactly the tools with a cli.ts (entries outside
// dist/cli/, like create-herdr-tool, are not tools).
import { build } from "esbuild";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { bundledPackages, copyModFiles, modBuildOptions } from "./mods.ts";
import { DIST, ROOT, type Tool, tools } from "./tools.ts";

rmSync(DIST, { recursive: true, force: true });

const all = tools();
for (const tool of all) {
  const built: string[] = [];

  if (tool.cli) {
    await build({
      entryPoints: [tool.cli],
      outfile: join(DIST, "cli", `${tool.name}.mjs`),
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      // Node built-ins stay imports; npm dependencies are bundled.
      packages: "bundle",
      logLevel: "warning",
    });
    built.push("cli");
  }

  if (tool.mod) {
    const out = join(DIST, "mods", tool.name);
    const result = await build(modBuildOptions(tool, join(out, "main.js")));
    copyModFiles(tool, out);
    const packages = result.metafile ? bundledPackages(result.metafile) : [];
    built.push(packages.length > 0 ? `mod (bundles ${packages.join(", ")})` : "mod");
  }

  console.log(`${tool.name}: ${built.join(" + ") || "core only"}`);
}

checkBins(all);

/** Every tool with a cli.ts has its "bin" entry, and every "bin" entry has its tool. */
function checkBins(all: Tool[]): void {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { bin?: Record<string, string> };
  const bin = pkg.bin ?? {};
  const problems: string[] = [];
  for (const tool of all) {
    if (!tool.cli) continue;
    const want = `dist/cli/${tool.name}.mjs`;
    if (bin[tool.name] !== want) problems.push(`"bin" in package.json needs "${tool.name}": "${want}"`);
  }
  for (const [name, file] of Object.entries(bin)) {
    if (!file.startsWith("dist/cli/")) continue; // create-herdr-tool and the like: not a tool
    if (!all.some((tool) => tool.name === name && tool.cli)) problems.push(`"bin" entry "${name}" has no src/tools/${name}/cli.ts`);
  }
  if (problems.length > 0) {
    console.error(`build: ${problems.join("\nbuild: ")}`);
    process.exit(1);
  }
}
