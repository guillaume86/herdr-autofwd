import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ExecResult, Host } from "../../host.ts";
import {
  type AutofwdStatus,
  type Machine,
  type Settings,
  type Tunnel,
  age,
  checkAutofwd,
  entries,
  formatEntries,
  joinPath,
  listTunnels,
  parseMachines,
  parseSettings,
  parseStatus,
  phase,
  runArgs,
  staleFiles,
  startTunnel,
  statusFileName,
  statusFileOf,
  stopTunnel,
  summary,
  sweep,
  terminalName,
} from "./core.ts";

type HcReply = Record<string, unknown> | { error: { kind: string; message: string } };

/**
 * A Host whose `hc` answers from `hc(args)` (an `{error}` reply goes to stderr with exit 3, as
 * hc does), whose files are `files`, and which records every call in order.
 */
function fakeHost(options: { hc?: (args: string[]) => HcReply; files?: Record<string, string>; exec?: (command: string, args: string[]) => ExecResult }) {
  const calls: string[] = [];
  const files = { ...options.files };
  const host: Host = {
    exec: async (command, args = []) => {
      calls.push([command, ...args].join(" "));
      if (command !== "hc") return options.exec?.(command, args) ?? { code: 0, stdout: "", stderr: "" };
      const reply = options.hc?.(args) ?? {};
      return "error" in reply ? { code: 3, stdout: "", stderr: JSON.stringify(reply) } : { code: 0, stdout: JSON.stringify(reply), stderr: "" };
    },
    fetch: () => Promise.reject(new Error("no network in tests")),
    readTextFile: async (path) => {
      calls.push(`read ${path}`);
      return files[path] ?? null;
    },
    listDir: async (path) => {
      calls.push(`listDir ${path}`);
      return Object.keys(files)
        .filter((f) => f.startsWith(`${path}/`))
        .map((f) => f.slice(path.length + 1));
    },
    removeFile: async (path) => {
      calls.push(`removeFile ${path}`);
      delete files[path];
    },
    home: () => "/home/me",
  };
  return { host, calls, files };
}

const settings: Settings = parseSettings("/home/me", null);
const DIR = "/home/me/.cache/hc-autofwd/status";
const DESK_FILE = "autofwd-desk-aaaa1111.json";
const desk: Machine = { name: "desk", target: "gui-desktop", state: "connected", why: null };

function statusJSON(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: 1,
    version: "v0.3.0",
    pid: 4812,
    host: "gui-desktop",
    started: "2026-11-06T09:00:00.000Z",
    state: "connected",
    since: "2026-11-06T09:00:01.000Z",
    retry_at: null,
    error: "",
    last_keepalive: null,
    forwards: [{ port: 3000, url: "http://localhost:3000", remote: "127.0.0.1:3000", process: "node", dir: "~/src/shop", since: "2026-11-06T09:00:02.000Z", conns: 1 }],
    busy: [{ port: 9229, reason: "local port busy", retry_at: "2026-11-06T09:00:32.000Z" }],
    skipped: [{ port: 22, reason: "below --min-port 1024", process: "" }],
    ...over,
  });
}

function tunnel(over: Partial<Tunnel> = {}): Tunnel {
  return { address: "t7", machine: "desk", live: true, file: DESK_FILE, exitCode: null, reason: null, status: null, ...over };
}

describe("paths and settings", () => {
  test("joinPath follows the home's separator", () => {
    assert.equal(joinPath("/home/me", ".cache", "x"), "/home/me/.cache/x");
    assert.equal(joinPath("C:\\Users\\me", ".cache", "x"), "C:\\Users\\me\\.cache\\x");
    assert.equal(joinPath("C:/Users/me/", "x"), "C:/Users/me/x");
  });

  test("defaults without a file", () => {
    assert.deepEqual(settings, { autofwd: "autofwd", args: [], statusDir: DIR, home: "/home/me" });
  });

  test("the file sets the program and extra flags", () => {
    const s = parseSettings("/home/me", '{"autofwd": "/opt/autofwd", "args": ["--min-port", "3000"]}');
    assert.equal(s.autofwd, "/opt/autofwd");
    assert.deepEqual(s.args, ["--min-port", "3000"]);
  });

  test("mistakes are errors naming the file", () => {
    assert.throws(() => parseSettings("/home/me", "{"), /config\.json: not JSON/);
    assert.throws(() => parseSettings("/home/me", '{"autofwds": "x"}'), /unknown key "autofwds"/);
    assert.throws(() => parseSettings("/home/me", '{"args": "--min-port 3000"}'), /"args" wants a list of strings/);
  });
});

describe("parsing", () => {
  test("machines: a --via machine has no ssh target", () => {
    const reply = {
      machines: [
        { name: "desk", target: "gui-desktop", state: "connected", via: false },
        { name: "fly", target: "fly ssh console", state: "connected", via: true },
        { name: "msi", target: "msi-ubuntu", state: "unreachable", why: "timed out", via: false },
      ],
    };
    assert.deepEqual(parseMachines(reply), [
      desk,
      { name: "fly", target: null, state: "connected", why: null },
      { name: "msi", target: "msi-ubuntu", state: "unreachable", why: "timed out" },
    ]);
  });

  test("status: format 1 in camelCase; anything else is null", () => {
    const s = parseStatus(statusJSON()) as AutofwdStatus;
    assert.equal(s.state, "connected");
    assert.equal(s.retryAt, null);
    assert.deepEqual(s.forwards[0], { port: 3000, url: "http://localhost:3000", remote: "127.0.0.1:3000", process: "node", dir: "~/src/shop", since: "2026-11-06T09:00:02.000Z", conns: 1 });
    assert.deepEqual(s.busy, [{ port: 9229, reason: "local port busy", retryAt: "2026-11-06T09:00:32.000Z" }]);
    assert.equal(parseStatus(statusJSON({ format: 2 })), null);
    assert.equal(parseStatus("{ half"), null);
  });

  test("status file names: one per start, and which file a temporary one belongs to", () => {
    assert.equal(statusFileName("My Box", "k3j9x2ab"), "autofwd-my-box-k3j9x2ab.json");
    assert.equal(statusFileOf(DESK_FILE), DESK_FILE);
    assert.equal(statusFileOf(`.${DESK_FILE}.98123.tmp`), DESK_FILE);
    assert.equal(statusFileOf("4812.json"), "4812.json"); // an earlier build's: swept like any leftover
    assert.equal(statusFileOf("notes.txt"), null);
    assert.equal(statusFileOf("desk.json"), null);
    const files = [DESK_FILE, `.${DESK_FILE}.2.tmp`, "autofwd-desk-old00000.json", ".autofwd-desk-old00000.json.1.tmp", "4812.json", "readme.md"];
    assert.deepEqual(staleFiles(files, [tunnel()]), ["autofwd-desk-old00000.json", ".autofwd-desk-old00000.json.1.tmp", "4812.json"]);
  });
});

describe("starting", () => {
  test("terminal names fit hc's rules", () => {
    assert.equal(terminalName("desk"), "autofwd-desk");
    assert.equal(terminalName("My Box.lan"), "autofwd-my-box-lan");
    assert.equal(terminalName("a".repeat(40)).length, 32);
  });

  test("runArgs: a parentless hc terminal running autofwd, its status file named in a label", () => {
    const s = { ...settings, args: ["--min-port", "3000"] };
    assert.deepEqual(runArgs(s, desk, DESK_FILE), [
      "run", "--json", "--bg", "--no-parent", "--name", "autofwd-desk",
      "--label", "hc-autofwd=tunnel", "--label", "hc-autofwd.machine=desk", "--label", `hc-autofwd.file=${DESK_FILE}`,
      "--cwd", "/home/me",
      "--", "autofwd", "--min-port", "3000", "--status-file", `${DIR}/${DESK_FILE}`, "gui-desktop",
    ]);
    assert.throws(() => runArgs(settings, { ...desk, target: null }, DESK_FILE), /--via/);
  });

  test("a running tunnel is left alone", async () => {
    const { host, calls } = fakeHost({});
    assert.equal(await startTunnel(host, settings, desk, [tunnel({ address: "t9" })]), "t9");
    assert.deepEqual(calls, []);
  });

  test("an ended tunnel and its file go before the new one starts", async () => {
    const { host, calls } = fakeHost({ hc: (args) => (args[0] === "run" ? { address: "t12" } : { removed: args[1] }) });
    const ended = tunnel({ address: "t3", live: false, file: "autofwd-desk-old00000.json", exitCode: 1 });
    assert.equal(await startTunnel(host, settings, desk, [ended, tunnel({ machine: "nas", live: false })], "new11111"), "t12");
    assert.deepEqual(calls.slice(0, 2), ["hc rm t3 --json", `removeFile ${DIR}/autofwd-desk-old00000.json`]);
    assert.match(calls[2] ?? "", /^hc run --json --bg --no-parent .* --status-file \S+autofwd-desk-new11111\.json gui-desktop$/);
    assert.equal(calls.length, 3);
  });
});

describe("listTunnels", () => {
  const ls = {
    terminals: [
      { address: "t7", state: "live" },
      { address: "t3", state: "finished", exit_code: 1, reason: "exited" },
      { address: "desk/t2", state: "live" }, // carries the label on another machine: not ours
    ],
  };
  const get: Record<string, HcReply> = {
    t7: { pid: 4812, labels: { "hc-autofwd": "tunnel", "hc-autofwd.machine": "desk", "hc-autofwd.file": DESK_FILE } },
    t3: { pid: 100, labels: { "hc-autofwd": "tunnel", "hc-autofwd.machine": "nas", "hc-autofwd.file": "autofwd-nas-bbbb2222.json" } },
  };
  const hc = (args: string[]): HcReply => (args[0] === "ls" ? ls : (get[args[1] ?? ""] ?? { error: { kind: "not_found", message: "no terminal" } }));

  test("joins hc's terminals with their status files, folder first", async () => {
    const { host, calls } = fakeHost({ hc, files: { [`${DIR}/${DESK_FILE}`]: statusJSON(), [`${DIR}/autofwd-desk-old00000.json`]: statusJSON({ pid: 55 }) } });
    const known = new Map();
    const list = await listTunnels(host, settings, known);
    assert.deepEqual(calls.slice(0, 2), [`listDir ${DIR}`, "hc ls --all --json --label hc-autofwd=tunnel"]);
    assert.deepEqual(
      list.tunnels.map((t) => [t.address, t.machine, t.live, t.file, t.exitCode, t.status?.state ?? null]),
      [
        ["t7", "desk", true, DESK_FILE, null, "connected"],
        ["t3", "nas", false, "autofwd-nas-bbbb2222.json", 1, null],
      ],
    );
    assert.deepEqual(list.files.sort(), ["autofwd-desk-aaaa1111.json", "autofwd-desk-old00000.json"]);

    // hc get is asked once per terminal.
    calls.length = 0;
    await listTunnels(host, settings, known);
    assert.ok(!calls.some((c) => c.startsWith("hc get")), calls.join("\n"));

    // Only the file nobody owns is swept.
    calls.length = 0;
    await sweep(host, settings, list);
    assert.deepEqual(calls, [`removeFile ${DIR}/autofwd-desk-old00000.json`]);
  });

  test("hc's errors other than a vanished terminal stop the listing", async () => {
    const { host } = fakeHost({ hc: (args) => (args[0] === "ls" ? ls : { error: { kind: "unreachable", message: "core is down" } }) });
    await assert.rejects(listTunnels(host, settings), { message: "core is down" });
  });
});

describe("stopTunnel", () => {
  test("Ctrl+C, a wait, then the terminal and its file go", async () => {
    const { host, calls } = fakeHost({ hc: (args) => (args[0] === "get" ? { state: "finished" } : {}) });
    await stopTunnel(host, settings, tunnel());
    assert.deepEqual(calls, ["hc keys t7 ctrl+c --json", "hc wait t7 --timeout 5 --json", "hc get t7 --json", "hc rm t7 --json", `removeFile ${DIR}/${DESK_FILE}`]);
  });

  test("one that ignores Ctrl+C is killed", async () => {
    const { host, calls } = fakeHost({ hc: (args) => (args[0] === "get" ? { state: "live" } : {}) });
    await stopTunnel(host, settings, tunnel());
    assert.deepEqual(calls.slice(3, 5), ["hc kill t7 --json", "hc wait t7 --timeout 5 --json"]);
  });

  test("an ended one is only removed, even when hc already forgot it", async () => {
    const { host, calls } = fakeHost({ hc: () => ({ error: { kind: "not_found", message: "no terminal t3" } }) });
    await stopTunnel(host, settings, tunnel({ address: "t3", live: false, file: null }));
    assert.deepEqual(calls, ["hc rm t3 --json"]);
  });
});

describe("checkAutofwd", () => {
  /** A Host whose `hc exec -- <program> <flag>` answers with `reply(flag)`, plain text as hc gives it. */
  function hcExecHost(reply: (flag: string) => ExecResult) {
    const calls: string[] = [];
    const host: Host = {
      ...fakeHost({}).host,
      exec: async (command, args = []) => {
        calls.push([command, ...args].join(" "));
        return reply(args.at(-1) ?? "");
      },
    };
    return { host, calls };
  }

  test("asks where tunnels run: through hc exec", async () => {
    const { host, calls } = hcExecHost((flag) => ({ code: 0, stdout: flag === "--version" ? "autofwd 0.3.0\n" : "  -status-file path\n", stderr: "" }));
    assert.equal(await checkAutofwd(host, settings), "autofwd 0.3.0");
    assert.deepEqual(calls, ["hc exec -- autofwd --help", "hc exec -- autofwd --version"]);
  });

  test("wants --status-file", async () => {
    const { host } = hcExecHost((flag) => ({ code: 0, stdout: flag === "--version" ? "autofwd 0.2.0\n" : "  -log\n  -quiet\n", stderr: "" }));
    await assert.rejects(checkAutofwd(host, settings), /autofwd 0\.2\.0 has no --status-file/);
  });

  test("a program hc can't start says where to point it", async () => {
    const stderr = '{"error":{"hint":"","kind":"spawn_failed","message":"cannot start autofwd: program not found"}}\n';
    const { host } = hcExecHost(() => ({ code: 1, stdout: "", stderr }));
    await assert.rejects(checkAutofwd(host, settings), /^Error: cannot start autofwd: program not found: hc-autofwd needs autofwd 0\.3\.0 or later on PATH, or its path as "autofwd" in .*config\.json$/);
  });
});

describe("what to show", () => {
  const now = Date.parse("2026-11-06T09:03:01.000Z");

  test("age prints like autofwd's footer", () => {
    assert.deepEqual([age(45_000), age(180_000), age(8_040_000), age(7_200_000), age(3 * 86_400_000), age(-5)], ["45s", "3m", "2h14m", "2h", "3d", "0s"]);
  });

  test("phases and summaries", () => {
    const connected = tunnel({ status: parseStatus(statusJSON()) });
    assert.equal(phase(null), "off");
    assert.equal(phase(tunnel()), "starting");
    assert.equal(summary(connected, now), "connected 3m · 1 port · 1 busy");
    const waiting = tunnel({ status: parseStatus(statusJSON({ state: "reconnecting", retry_at: "2026-11-06T09:03:05.000Z", error: "no keepalive reply", forwards: [] })) });
    assert.equal(summary(waiting, now), "reconnecting in 4s: no keepalive reply");
    const failed = tunnel({ live: false, exitCode: 1, status: parseStatus(statusJSON({ state: "failed", error: "host key mismatch" })) });
    assert.equal(phase(failed), "failed");
    assert.equal(summary(failed, now), "failed: host key mismatch");
    assert.equal(summary(tunnel({ live: false, exitCode: 1, reason: "killed" }), now), "stopped (exit 1, killed)");
  });

  test("entries: every machine, the running tunnel first, then forgotten machines", () => {
    const nas: Machine = { name: "nas", target: "herdr", state: "connected", why: null };
    const old = tunnel({ address: "t3", live: false });
    const running = tunnel({ address: "t7" });
    const orphan = tunnel({ address: "t9", machine: "gone" });
    const list = entries([desk, nas], [running, old, orphan]);
    assert.deepEqual(
      list.map((e) => [e.name, e.machine?.name ?? null, e.tunnel?.address ?? null]),
      [
        ["desk", "desk", "t7"],
        ["nas", "nas", null],
        ["gone", null, "t9"],
      ],
    );
  });

  test("formatEntries", () => {
    const list = entries([desk, { name: "msi", target: "msi-ubuntu", state: "unreachable", why: "timed out" }], [tunnel({ status: parseStatus(statusJSON()) })]);
    assert.deepEqual(formatEntries(list, now), [
      "● desk  gui-desktop  connected 3m · 1 port · 1 busy",
      "    3000   http://localhost:3000    node  ~/src/shop",
      "    9229   busy: local port busy",
      "    skipped: 22",
      "· msi   msi-ubuntu   off (hc: timed out)",
    ]);
  });
});
