import type { Host } from "../../host.ts";

// hc-autofwd: autofwd tunnels from this computer to herdr-core machines. Pure, tested in
// core.test.ts, loaded by cli.ts and mod.ts alike; everything goes through `host`.
//
// Each tunnel is one `autofwd <ssh target>` in a terminal of the local hc, started without a
// parent so it outlives whoever started it. hc is the record of what runs: a tunnel is a
// terminal carrying MARK_LABEL, and MACHINE_LABEL says where it goes. autofwd keeps its state
// in `<statusDir>/<pid>.json` (--status-file with {pid}); `hc get` gives the terminal's pid, so
// each file belongs to exactly one terminal, and a file no terminal owns is left over.

/** Every tunnel's terminal carries it. `hc ls --label` only filters on key=value pairs. */
export const MARK_LABEL = "hc-autofwd=tunnel";
/** The hc machine a tunnel reaches. */
export const MACHINE_LABEL = "hc-autofwd.machine";

// ── Paths and settings ──────────────────────────────────────────────────────────────────

/** Joins with the separator `base` uses: a Windows home gets backslashes. */
export function joinPath(base: string, ...parts: string[]): string {
  const sep = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return [base.replace(/[\\/]+$/, ""), ...parts].join(sep);
}

/** The optional settings file, the same on every platform. */
export const configPath = (home: string): string => joinPath(home, ".config", "hc-autofwd", "config.json");

export interface Settings {
  /** autofwd: a path, or a name hc finds on PATH in the tunnel's terminal. */
  autofwd: string;
  /** More autofwd flags for every tunnel. Per-host ones belong in autofwd's own config.toml. */
  args: string[];
  /** Where each autofwd keeps its status file, named after its pid. */
  statusDir: string;
  /** Where tunnel terminals start. */
  home: string;
}

/** Settings from the file's text (null: no file), checked like autofwd checks its own: unknown keys are errors. */
export function parseSettings(home: string, text: string | null): Settings {
  const settings: Settings = { autofwd: "autofwd", args: [], statusDir: joinPath(home, ".cache", "hc-autofwd", "status"), home };
  if (text === null || text.trim() === "") return settings;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`${configPath(home)}: not JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!isRecord(raw)) throw new Error(`${configPath(home)}: want an object`);
  for (const [key, value] of Object.entries(raw)) {
    if (key === "autofwd" && typeof value === "string" && value !== "") settings.autofwd = value;
    else if (key === "args" && Array.isArray(value) && value.every((a) => typeof a === "string")) settings.args = value;
    else if (key === "autofwd" || key === "args") throw new Error(`${configPath(home)}: "${key}" wants ${key === "args" ? "a list of strings" : "a program name or path"}`);
    else throw new Error(`${configPath(home)}: unknown key "${key}" (known: autofwd, args)`);
  }
  return settings;
}

export async function loadSettings(host: Host): Promise<Settings> {
  const home = host.home();
  return parseSettings(home, await host.readTextFile(configPath(home)));
}

// ── hc ──────────────────────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** hc's own error reply: `kind` is its machine-readable part (not_found, usage, ...). */
export class HcError extends Error {
  readonly kind: string;
  constructor(kind: string, message: string) {
    super(message);
    this.kind = kind;
  }
}

/** Runs `hc <args>` (asking for --json) and returns its reply; hc's own `{error}` becomes an HcError. */
export async function hcJson(host: Host, args: string[], timeout?: number): Promise<Record<string, unknown>> {
  const r = await host.exec("hc", args, timeout === undefined ? {} : { timeout });
  let reply: unknown;
  try {
    reply = JSON.parse(r.stdout.trim() || r.stderr.trim());
  } catch {
    throw new Error(`hc ${args[0] ?? ""} failed (exit ${r.code}): ${(r.stderr || r.stdout).trim() || "no output"}`);
  }
  if (!isRecord(reply)) throw new Error(`hc ${args[0] ?? ""}: unexpected reply ${r.stdout.trim()}`);
  if (isRecord(reply.error)) {
    throw new HcError(str(reply.error.kind) ?? "unknown", str(reply.error.message) ?? `hc ${args[0] ?? ""} failed`);
  }
  return reply;
}

const notFound = (error: unknown): boolean => error instanceof HcError && error.kind === "not_found";

export interface Machine {
  /** Its hc name (`hc machine ls`): the key for everything here. */
  name: string;
  /** What hc gives ssh, often a Host of ~/.ssh/config; null for machines reached `--via` a command. */
  target: string | null;
  /** hc's connection to it: connected, unreachable, ... */
  state: string;
  /** Why hc can't reach it, when it can't. */
  why: string | null;
}

export function parseMachines(reply: Record<string, unknown>): Machine[] {
  const list = Array.isArray(reply.machines) ? reply.machines : [];
  return list.filter(isRecord).flatMap((m) => {
    const name = str(m.name);
    if (!name) return [];
    const target = m.via ? null : str(m.target);
    return [{ name, target, state: str(m.state) ?? "unknown", why: str(m.why) }];
  });
}

export async function listMachines(host: Host): Promise<Machine[]> {
  return parseMachines(await hcJson(host, ["machine", "ls", "--json"]));
}

// ── autofwd's status file (format 1) ────────────────────────────────────────────────────

export interface Forward {
  port: number;
  url: string;
  /** The address dialed on the remote side. */
  remote: string;
  /** The remote process (or systemd unit) and its folder, "" when unknown. */
  process: string;
  dir: string;
  since: string;
  conns: number;
}
export interface Busy {
  port: number;
  reason: string;
  retryAt: string;
}
export interface Skipped {
  port: number;
  reason: string;
  process: string;
}
export interface AutofwdStatus {
  pid: number;
  host: string;
  version: string;
  started: string;
  /** connecting, connected, reconnecting or failed (autofwd stopped on an error it can't retry). */
  state: string;
  since: string;
  retryAt: string | null;
  error: string;
  lastKeepalive: string | null;
  forwards: Forward[];
  busy: Busy[];
  skipped: Skipped[];
}

/** A status file's content, or null when it is not one (half-written, another format). */
export function parseStatus(text: string): AutofwdStatus | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.format !== 1) return null;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter(isRecord) : []);
  return {
    pid: num(raw.pid) ?? 0,
    host: str(raw.host) ?? "",
    version: str(raw.version) ?? "",
    started: str(raw.started) ?? "",
    state: str(raw.state) ?? "unknown",
    since: str(raw.since) ?? "",
    retryAt: str(raw.retry_at),
    error: str(raw.error) ?? "",
    lastKeepalive: str(raw.last_keepalive),
    forwards: list(raw.forwards).map((f) => ({
      port: num(f.port) ?? 0,
      url: str(f.url) ?? "",
      remote: str(f.remote) ?? "",
      process: str(f.process) ?? "",
      dir: str(f.dir) ?? "",
      since: str(f.since) ?? "",
      conns: num(f.conns) ?? 0,
    })),
    busy: list(raw.busy).map((b) => ({ port: num(b.port) ?? 0, reason: str(b.reason) ?? "", retryAt: str(b.retry_at) ?? "" })),
    skipped: list(raw.skipped).map((s) => ({ port: num(s.port) ?? 0, reason: str(s.reason) ?? "", process: str(s.process) ?? "" })),
  };
}

/** The status file name autofwd uses for `pid`, given `{pid}.json`. */
export const statusFileName = (pid: number): string => `${pid}.json`;

/** The pid a status file (or autofwd's temporary `.<pid>.json.*.tmp`) belongs to, or null for other files. */
export function statusFilePid(name: string): number | null {
  const m = /^(\d+)\.json$/.exec(name) ?? /^\.(\d+)\.json\..+\.tmp$/.exec(name);
  return m ? Number(m[1]) : null;
}

// ── Tunnels ─────────────────────────────────────────────────────────────────────────────

export interface Tunnel {
  /** Its hc terminal (local: no machine prefix). */
  address: string;
  /** The hc machine it reaches. */
  machine: string;
  live: boolean;
  /** autofwd's pid, which names its status file. */
  pid: number | null;
  /** How it ended, once it has. */
  exitCode: number | null;
  reason: string | null;
  /** autofwd's last snapshot: null before its first one, after a clean exit, or for a killed one whose file is gone. */
  status: AutofwdStatus | null;
}

/** What `hc get` says about a terminal that never changes: asked once per terminal. */
export interface Identity {
  machine: string;
  pid: number | null;
}
export type Identities = Map<string, Identity>;

export interface TunnelList {
  tunnels: Tunnel[];
  /** The status folder's names, read before asking hc: see `staleFiles`. */
  files: string[];
}

/** The tunnels hc knows of, finished ones included, with their status. `known` caches `hc get` across calls. */
export async function listTunnels(host: Host, settings: Settings, known: Identities = new Map()): Promise<TunnelList> {
  // The folder first: a file present now belongs to an autofwd already started, so its terminal
  // is in the list hc gives next. The other order could take a just-started tunnel's file for a leftover.
  const files = await host.listDir(settings.statusDir);
  const reply = await hcJson(host, ["ls", "--all", "--json", "--label", MARK_LABEL]);
  const terminals = (Array.isArray(reply.terminals) ? reply.terminals : []).filter(isRecord);
  const tunnels = await Promise.all(
    terminals.map(async (t): Promise<Tunnel | null> => {
      const address = str(t.address);
      if (!address || address.includes("/")) return null; // on another machine: not one of ours
      let id = known.get(address);
      if (!id) {
        try {
          const got = await hcJson(host, ["get", address, "--json"]);
          const labels = isRecord(got.labels) ? got.labels : {};
          id = { machine: str(labels[MACHINE_LABEL]) ?? "?", pid: num(got.pid) };
          known.set(address, id);
        } catch (error) {
          if (notFound(error)) return null; // removed meanwhile
          throw error;
        }
      }
      const tunnel: Tunnel = {
        address,
        machine: id.machine,
        live: t.state === "live",
        pid: id.pid,
        exitCode: num(t.exit_code),
        reason: str(t.reason),
        status: null,
      };
      return tunnel;
    }),
  );
  const list = tunnels.filter((t): t is Tunnel => t !== null);
  await readStatuses(host, settings, list, files);
  return { tunnels: list, files };
}

/** Rereads each tunnel's status file in place: what a mod does when the folder changes, without asking hc. */
export async function readStatuses(host: Host, settings: Settings, tunnels: Tunnel[], files?: string[]): Promise<void> {
  await Promise.all(
    tunnels.map(async (t) => {
      if (t.pid === null || (files && !files.includes(statusFileName(t.pid)))) {
        t.status = null;
        return;
      }
      const text = await host.readTextFile(joinPath(settings.statusDir, statusFileName(t.pid)));
      const status = text === null ? null : parseStatus(text);
      // A half-written file can't happen (autofwd renames), but a foreign one can: keep the last good one then.
      if (text === null || status !== null) t.status = status;
    }),
  );
}

/** Status files no tunnel terminal owns: left by an autofwd that was killed, or by one whose terminal was removed. */
export function staleFiles(files: string[], tunnels: Tunnel[]): string[] {
  const owned = new Set(tunnels.map((t) => t.pid));
  return files.filter((name) => {
    const pid = statusFilePid(name);
    return pid !== null && !owned.has(pid);
  });
}

/** Deletes the stale files; one that can't go stays for the next time. */
export async function sweep(host: Host, settings: Settings, list: TunnelList): Promise<void> {
  await Promise.all(staleFiles(list.files, list.tunnels).map((name) => host.removeFile(joinPath(settings.statusDir, name)).catch(() => {})));
}

/** The hc terminal name for a machine's tunnel: `autofwd-<machine>`, in hc's alphabet and length. */
export function terminalName(machine: string): string {
  const safe = machine.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `autofwd-${safe || "machine"}`.slice(0, 32);
}

/** `hc` arguments that start a machine's tunnel. */
export function runArgs(settings: Settings, machine: Machine): string[] {
  if (!machine.target) throw new Error(`${machine.name} is reached through a command (--via), not ssh: autofwd can't tunnel to it`);
  return [
    "run",
    "--json",
    "--bg",
    "--no-parent",
    "--name",
    terminalName(machine.name),
    "--label",
    MARK_LABEL,
    "--label",
    `${MACHINE_LABEL}=${machine.name}`,
    "--cwd",
    settings.home,
    "--",
    settings.autofwd,
    ...settings.args,
    "--status-file",
    joinPath(settings.statusDir, "{pid}.json"),
    machine.target,
  ];
}

/** The tunnels of one machine, oldest first. */
export const tunnelsOf = (tunnels: Tunnel[], machine: string): Tunnel[] => tunnels.filter((t) => t.machine === machine);

/**
 * Starts a machine's tunnel, unless one runs already: returns its terminal's address.
 * Finished tunnels of that machine go first, so the new one is the only record.
 */
export async function startTunnel(host: Host, settings: Settings, machine: Machine, tunnels: Tunnel[]): Promise<string> {
  const args = runArgs(settings, machine);
  const mine = tunnelsOf(tunnels, machine.name);
  const running = mine.find((t) => t.live);
  if (running) return running.address;
  for (const t of mine) await discard(host, settings, t);
  const reply = await hcJson(host, args);
  const address = str(reply.address);
  if (!address) throw new Error(`hc run gave no address: ${JSON.stringify(reply)}`);
  return address;
}

/** How long a tunnel gets to end on Ctrl+C, and then on a kill, in seconds. */
export const STOP_WAIT_S = 5;

/**
 * Stops a tunnel and removes its terminal and status file. Ctrl+C first: autofwd closes its
 * listeners and deletes its file. One that doesn't end in time (a passphrase prompt) is killed.
 */
export async function stopTunnel(host: Host, settings: Settings, t: Tunnel): Promise<void> {
  if (t.live) {
    const wait = () => hcJson(host, ["wait", t.address, "--timeout", String(STOP_WAIT_S), "--json"], (STOP_WAIT_S + 10) * 1000);
    const live = () =>
      hcJson(host, ["get", t.address, "--json"]).then(
        (got) => got.state === "live",
        (error: unknown) => (notFound(error) ? false : Promise.reject(error)),
      );
    await hcJson(host, ["keys", t.address, "ctrl+c", "--json"]).catch(() => {}); // it may have ended meanwhile
    await wait().catch(() => {});
    if (await live()) {
      await hcJson(host, ["kill", t.address, "--json"]);
      await wait().catch(() => {});
    }
  }
  await discard(host, settings, t);
}

/** Removes a finished tunnel's terminal and its status file. */
async function discard(host: Host, settings: Settings, t: Tunnel): Promise<void> {
  await hcJson(host, ["rm", t.address, "--json"]).catch((error: unknown) => {
    if (!notFound(error)) throw error;
  });
  if (t.pid !== null) await host.removeFile(joinPath(settings.statusDir, statusFileName(t.pid)));
}

/** Asks a running tunnel to look for new ports now and retry the busy ones (autofwd's `r` key). */
export async function retryTunnel(host: Host, t: Tunnel): Promise<void> {
  if (!t.live) throw new Error(`the tunnel to ${t.machine} is not running`);
  await hcJson(host, ["keys", t.address, "r", "--json"]);
}

/** autofwd's version, once it is known to take --status-file. */
export async function checkAutofwd(host: Host, settings: Settings): Promise<string> {
  const help = await host.exec(settings.autofwd, ["--help"]);
  const version = (await host.exec(settings.autofwd, ["--version"])).stdout.trim() || settings.autofwd;
  if (!/-status-file/.test(help.stdout + help.stderr)) {
    throw new Error(`${version} has no --status-file: hc-autofwd needs autofwd 0.3.0 or later`);
  }
  return version;
}

// ── What to show ────────────────────────────────────────────────────────────────────────

export interface Entry {
  name: string;
  /** null for a tunnel to a machine hc no longer has. */
  machine: Machine | null;
  /** The running tunnel, else the last one that ended (it says why), else null: off. */
  tunnel: Tunnel | null;
}

/** One entry per machine, in hc's order, then tunnels to machines hc forgot. */
export function entries(machines: Machine[], tunnels: Tunnel[]): Entry[] {
  const pick = (name: string): Tunnel | null => {
    const mine = tunnelsOf(tunnels, name);
    return mine.find((t) => t.live) ?? mine.at(-1) ?? null;
  };
  const out: Entry[] = machines.map((m) => ({ name: m.name, machine: m, tunnel: pick(m.name) }));
  for (const t of tunnels) {
    if (!out.some((e) => e.name === t.machine)) out.push({ name: t.machine, machine: null, tunnel: pick(t.machine) });
  }
  return out;
}

export type Phase = "off" | "starting" | "connecting" | "connected" | "reconnecting" | "failed" | "stopped";

export function phase(t: Tunnel | null): Phase {
  if (!t) return "off";
  const state = t.status?.state;
  if (t.live) {
    if (state === "connecting" || state === "connected" || state === "reconnecting" || state === "failed") return state;
    return "starting";
  }
  return state === "failed" ? "failed" : "stopped";
}

/** A duration the way autofwd's footer prints it: 45s, 3m, 2h14m, 3d. */
export function age(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}m`;
  }
  return `${Math.floor(s / 86400)}d`;
}

const since = (iso: string | null | undefined, now: number): string => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? "" : age(now - t);
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** One line on a tunnel's state: "connected 3m · 4 ports", "reconnecting in 4s: …", "failed: …". */
export function summary(t: Tunnel | null, now: number): string {
  const s = t?.status;
  switch (phase(t)) {
    case "off":
      return "off";
    case "starting":
      return "starting";
    case "connecting":
      return s?.error ? `connecting: ${s.error}` : "connecting";
    case "connected": {
      const parts = [`connected ${since(s?.since, now)}`.trim(), plural(s?.forwards.length ?? 0, "port")];
      if (s?.busy.length) parts.push(`${s.busy.length} busy`);
      return parts.join(" · ");
    }
    case "reconnecting": {
      const wait = s?.retryAt ? ` in ${age(Date.parse(s.retryAt) - now)}` : "";
      return `reconnecting${wait}${s?.error ? `: ${s.error}` : ""}`;
    }
    case "failed":
      return `failed: ${s?.error || "unknown error"}`;
    case "stopped": {
      const how = [t?.exitCode !== null && t?.exitCode !== undefined ? `exit ${t.exitCode}` : "", t?.reason && t.reason !== "exited" ? t.reason : ""];
      const detail = how.filter(Boolean).join(", ");
      return detail ? `stopped (${detail})` : "stopped";
    }
  }
}

/** What the CLI prints: one block per machine. */
export function formatEntries(list: Entry[], now: number): string[] {
  const nameWidth = Math.max(4, ...list.map((e) => e.name.length));
  const targetWidth = Math.max(0, ...list.map((e) => (e.machine?.target ?? "").length));
  const lines: string[] = [];
  for (const e of list) {
    const p = phase(e.tunnel);
    const mark = p === "connected" ? "●" : p === "off" ? "·" : p === "failed" || p === "stopped" ? "✕" : "○";
    const target = e.machine ? (e.machine.target ?? "(via)") : "(not in hc)";
    let line = `${mark} ${e.name.padEnd(nameWidth)}  ${target.padEnd(targetWidth)}  ${summary(e.tunnel, now)}`;
    if (p === "off" && e.machine && !e.machine.target) line += " (autofwd needs ssh)";
    else if (p === "off" && e.machine?.why) line += ` (hc: ${e.machine.why})`;
    lines.push(line.trimEnd());
    const s = e.tunnel?.live ? e.tunnel.status : null;
    for (const f of s?.forwards ?? []) {
      const what = [f.process, f.dir].filter(Boolean).join("  ");
      lines.push(`    ${String(f.port).padEnd(6)} ${f.url.padEnd(24)} ${what}`.trimEnd());
    }
    for (const b of s?.busy ?? []) lines.push(`    ${String(b.port).padEnd(6)} busy: ${b.reason}`);
    if (s?.skipped.length) lines.push(`    skipped: ${s.skipped.map((k) => k.port).join(" ")}`);
  }
  return lines;
}
