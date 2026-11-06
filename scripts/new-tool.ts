// Adds a barebones tool to this repo: `pnpm new-tool <name>` writes src/tools/<name>/ from
// scripts/skeleton/ (core, test, CLI, mod) and its "bin" entry. Then `pnpm check`.
import { addBin, generateTool, shippedModsIn, validateName } from "./scaffold.js";
import { APP_HOME, ROOT, errorMessage } from "./tools.ts";

const [name, ...rest] = process.argv.slice(2);
if (!name || rest.length > 0) {
  console.error("usage: pnpm new-tool <name>   (lowercase, dashes: my-tool)");
  process.exit(2);
}

try {
  validateName(name, shippedModsIn(APP_HOME));
  const written = generateTool(ROOT, name);
  addBin(ROOT, name);
  console.log(`${name}:\n  ${written.join("\n  ")}\n  package.json: "bin" entry\n\nNext: pnpm check, then pnpm dev ${name}`);
} catch (error) {
  console.error(`new-tool: ${errorMessage(error)}`);
  process.exit(1);
}
