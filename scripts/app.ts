// Opens the throwaway herdr-app window (`pnpm app`): the home the scripts deploy to and
// check against. Its first start writes the default layouts, mods and type files there.
import { spawn } from "node:child_process";
import { APP_BIN, APP_HOME, appEnv } from "./tools.ts";

// No `windowsHide`: on Windows it starts the process with SW_HIDE, which a GUI app honours for its
// first window, so the throwaway window would run invisible (and draw no new frames for `shot`).
const app = spawn(APP_BIN, [], { env: appEnv(APP_HOME), detached: true, stdio: "ignore" });
app.on("error", (error) => {
  console.error(`app: cannot run ${APP_BIN} (${error.message}): is it installed and on PATH, or named in .env?`);
  process.exit(1);
});
app.on("spawn", () => {
  app.unref();
  console.log(`app: ${APP_BIN} opened with HERDR_APP_HOME=${APP_HOME}`);
});
