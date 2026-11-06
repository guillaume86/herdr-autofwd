// types/ holds herdr-app's generated type files, aligned on upstream herdr-app's master
// (`defaults/herdr.d.ts` there; gpui-kit.d.ts as the app writes it). This script compares
// them with what the app in the throwaway home wrote (it rewrites them on every start):
//   node scripts/sync-types.ts           report a difference, never write (what `pnpm typecheck` runs)
//   node scripts/sync-types.ts --write   take the app's files into types/ (`pnpm sync-types`)
// Line endings are normalized to LF: the app writes CRLF on Windows.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP_HOME, ROOT } from "./tools.ts";

const FILES = ["gpui-kit.d.ts", "herdr.d.ts"];
const target = join(ROOT, "types");
const write = process.argv.includes("--write");

const lf = (text: string) => text.replaceAll("\r\n", "\n");
const read = (file: string) => (existsSync(file) ? lf(readFileSync(file, "utf8")) : null);

const missing = FILES.filter((f) => !existsSync(join(APP_HOME, f)));
if (missing.length > 0) {
  if (FILES.every((f) => existsSync(join(target, f)))) {
    console.log(`sync-types: types/ as committed (no ${missing.join(", ")} in ${APP_HOME} yet; \`pnpm app\` writes them)`);
    process.exit(0);
  }
  console.error(`sync-types: no ${missing.join(", ")} in ${APP_HOME}, and types/ is incomplete: restore types/ from git.`);
  process.exit(1);
}

mkdirSync(target, { recursive: true });
const differ: string[] = [];
for (const file of FILES) {
  const theirs = read(join(APP_HOME, file)) ?? "";
  if (theirs === read(join(target, file))) continue;
  if (write) {
    writeFileSync(join(target, file), theirs);
    console.log(`sync-types: wrote types/${file} from ${APP_HOME}`);
  } else {
    differ.push(file);
  }
}
if (differ.length > 0) {
  console.log(
    `sync-types: the app in ${APP_HOME} writes another ${differ.join(" and ")} than types/ holds ` +
      "(types/ follows upstream herdr-app master; `pnpm sync-types` takes the app's instead)",
  );
}
