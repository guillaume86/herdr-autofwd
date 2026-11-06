// A stand-in for `hc` in tests, run as `node fake-hc.ts <args...>`: writes FAKE_HC_REPLY
// (followed by a newline) to FAKE_HC_STREAM ("stdout", the default, or "stderr"), exits with
// FAKE_HC_EXIT (default 0), and appends its arguments as one JSON line to FAKE_HC_LOG, if set.
import { appendFileSync } from "node:fs";

const { FAKE_HC_REPLY = "", FAKE_HC_STREAM = "stdout", FAKE_HC_EXIT = "0", FAKE_HC_LOG } = process.env;

if (FAKE_HC_LOG) appendFileSync(FAKE_HC_LOG, `${JSON.stringify(process.argv.slice(2))}\n`);
(FAKE_HC_STREAM === "stderr" ? process.stderr : process.stdout).write(`${FAKE_HC_REPLY}\n`);
process.exitCode = Number(FAKE_HC_EXIT);
