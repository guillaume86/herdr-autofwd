#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { nodeHost } from "../../hosts/node.ts";
import {
  type Identities,
  type Machine,
  type Settings,
  type Tunnel,
  checkAutofwd,
  entries,
  formatEntries,
  listMachines,
  listTunnels,
  loadSettings,
  phase,
  readStatuses,
  retryTunnel,
  startTunnel,
  stopTunnel,
  summary,
  sweep,
  tunnelsOf,
} from "./core.ts";

const HELP = `Usage: hc-autofwd [command] [machine...] [options]

autofwd tunnels from this computer to herdr-core machines (hc machine ls). Each runs
in a terminal of the local hc, so it keeps running after this command, the window or
the shell that started it ends.

Commands:
  ls                    Machines and their tunnels (the default)
  up <machine...>       Start tunnels (--all: to every machine reached over ssh)
  down [machine...]     Stop tunnels (no machine named: all of them)
  restart <machine...>  Stop, then start again
  retry <machine...>    Look for new remote ports now and retry busy ones
  attach <machine>      autofwd's own screen, to type a passphrase or watch (Ctrl+\\ detaches)

Options:
      --all             up: every machine reached over ssh
      --autofwd <path>  The autofwd program (default: "autofwd" in the settings file, else on PATH)
      --json            ls: JSON output
  -h, --help            This help

Settings (optional): ~/.config/hc-autofwd/config.json, {"autofwd": "<path>", "args": ["--min-port", "3000"]}`;

const host = nodeHost;

/** How long `up` waits for a tunnel to say where it stands before printing it. */
const UP_WAIT_MS = 15_000;
/** How long after connecting autofwd's first port list may take. */
const FIRST_POLL_MS = 1_500;

interface State {
  machines: Machine[];
  tunnels: Tunnel[];
}

async function load(settings: Settings, known: Identities): Promise<State> {
  const [machines, list] = await Promise.all([listMachines(host), listTunnels(host, settings, known)]);
  await sweep(host, settings, list);
  return { machines, tunnels: list.tunnels };
}

function machineNamed(state: State, name: string): Machine {
  const m = state.machines.find((x) => x.name === name);
  if (!m) throw new Error(`no machine "${name}" in hc (hc machine ls: ${state.machines.map((x) => x.name).join(", ") || "none"})`);
  return m;
}

function liveTunnel(state: State, name: string): Tunnel {
  const t = tunnelsOf(state.tunnels, name).find((x) => x.live);
  if (!t) throw new Error(`no tunnel to ${name} is running`);
  return t;
}

/** Waits until each started tunnel is past starting/connecting, or UP_WAIT_MS, then prints where each stands. */
async function report(settings: Settings, known: Identities, names: string[]): Promise<number> {
  const deadline = Date.now() + UP_WAIT_MS;
  let state = await load(settings, known);
  // autofwd says "connected" just before its first look at the remote ports: give that a moment too.
  const pending = () =>
    names.some((n) => {
      const t = tunnelsOf(state.tunnels, n).find((x) => x.live) ?? null;
      const p = phase(t);
      const justConnected = p === "connected" && Date.now() - Date.parse(t?.status?.since ?? "") < FIRST_POLL_MS;
      return p === "starting" || p === "connecting" || justConnected;
    });
  for (let round = 1; pending() && Date.now() < deadline; round++) {
    await sleep(500);
    // The status files every half second; hc every 2 s, to notice a tunnel that ended (a fatal error).
    if (round % 4 === 0) state = await load(settings, known);
    else await readStatuses(host, settings, state.tunnels);
  }
  state = await load(settings, known);
  let code = 0;
  const now = Date.now();
  for (const name of names) {
    const t = tunnelsOf(state.tunnels, name).find((x) => x.live) ?? tunnelsOf(state.tunnels, name).at(-1) ?? null;
    const p = phase(t);
    console.log(`${name}: ${summary(t, now)}`);
    if (p === "connecting" || p === "starting") console.log(`  still connecting; a passphrase prompt? hc-autofwd attach ${name}`);
    if (p === "failed" || p === "stopped" || p === "off") code = 1;
  }
  return code;
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      all: { type: "boolean" },
      autofwd: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const [command = "ls", ...names] = positionals;
  const settings = await loadSettings(host);
  if (values.autofwd) settings.autofwd = values.autofwd;
  const known: Identities = new Map();
  const state = await load(settings, known);

  switch (command) {
    case "ls": {
      const list = entries(state.machines, state.tunnels);
      if (values.json) console.log(JSON.stringify(list, null, 2));
      else for (const line of formatEntries(list, Date.now())) console.log(line);
      return 0;
    }

    case "up":
    case "restart": {
      const targets = values.all && command === "up" ? state.machines.filter((m) => m.target).map((m) => m.name) : names;
      if (targets.length === 0) throw new Error(`${command}: name a machine (hc machine ls)${command === "up" ? " or use --all" : ""}`);
      const machines = targets.map((n) => machineNamed(state, n));
      await checkAutofwd(host, settings);
      for (const m of machines) {
        if (command === "restart") for (const t of tunnelsOf(state.tunnels, m.name)) await stopTunnel(host, settings, t);
        const running = command === "up" && tunnelsOf(state.tunnels, m.name).some((t) => t.live);
        const address = await startTunnel(host, settings, m, command === "restart" ? [] : state.tunnels);
        console.log(`${m.name}: ${running ? "already running" : "started"} in ${address} (autofwd ${m.target})`);
      }
      return report(settings, known, machines.map((m) => m.name));
    }

    case "down": {
      const stop = names.length === 0 ? state.tunnels : names.flatMap((n) => tunnelsOf(state.tunnels, n));
      for (const n of names) if (!state.tunnels.some((t) => t.machine === n)) console.log(`${n}: no tunnel`);
      for (const t of stop) {
        await stopTunnel(host, settings, t);
        console.log(`${t.machine}: ${t.live ? "stopped" : "removed"} (${t.address})`);
      }
      return 0;
    }

    case "retry": {
      if (names.length === 0) throw new Error("retry: name a machine");
      for (const n of names) {
        await retryTunnel(host, liveTunnel(state, n));
        console.log(`${n}: polling now, retrying busy ports`);
      }
      return 0;
    }

    case "attach": {
      if (names.length !== 1) throw new Error("attach: name one machine");
      const t = liveTunnel(state, names[0] ?? "");
      return spawnSync("hc", ["attach", t.address], { stdio: "inherit" }).status ?? 1;
    }

    default:
      throw new Error(`unknown command "${command}" (hc-autofwd --help)`);
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`hc-autofwd: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
