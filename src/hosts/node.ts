import { execFile } from "node:child_process";
import { readFile, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import type { ExecOptions, ExecResult, Host } from "../host.ts";

/**
 * herdr-app's `exec` limits, applied here too so a tool behaves the same in both
 * runtimes. Read from the `exec` comment of types/herdr.d.ts (upstream herdr-app master,
 * 2026-11-06; hc 0.1.18), the only place herdr states them: re-check when types/ moves.
 */
export const EXEC_TIMEOUT_MS = 30_000;
export const EXEC_MAX_TIMEOUT_MS = 600_000;
export const EXEC_MAX_OUTPUT = 8 * 1024 * 1024;

/** How to run herdr-core's CLI. The default is `hc` on PATH; tests point it at a fake. */
export interface HcCommand {
  command: string;
  args?: string[];
}

function clampTimeout(ms: number | undefined): number {
  if (ms === undefined) return EXEC_TIMEOUT_MS;
  if (!(ms > 0)) throw new RangeError(`timeout must be a positive number of milliseconds, got ${ms}`);
  return Math.min(ms, EXEC_MAX_TIMEOUT_MS);
}

/**
 * Runs `command` here. Resolves with any exit code; rejects when it cannot start,
 * times out or writes too much, like herdr's `exec`.
 */
function runHere(command: string, args: string[], cwd: string | undefined, timeout: number): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { cwd, timeout, maxBuffer: EXEC_MAX_OUTPUT, windowsHide: true, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (!error) return resolve({ code: 0, stdout, stderr });
        // A number is the program's exit code; anything else means it did not run to the end.
        if (typeof error.code === "number") return resolve({ code: error.code, stdout, stderr });
        if (error.killed) return reject(new Error(`${command} timed out after ${timeout / 1000} s`));
        if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
          return reject(new Error(`${command} wrote more than ${EXEC_MAX_OUTPUT / 1024 / 1024} MiB`));
        }
        if (error.code === "ENOENT") {
          return reject(new Error(`cannot start ${command}: program not found${cwd ? ` or no folder ${cwd}` : ""}`));
        }
        reject(new Error(`cannot start ${command}: ${error.message}`));
      },
    );
  });
}

export interface HcError {
  error: { kind: string; message: string };
}
interface HcExec {
  code: number;
  stdout: string;
  stderr: string;
  timed_out: boolean;
  truncated: boolean;
}
interface HcFileRead {
  text: string;
}

/**
 * herdr-core's `--json` reply: its result on stdout, or its own `{ error }` on
 * stderr with a nonzero exit. Both come back parsed, neither as a rejection.
 */
export function parseHcReply<T>(r: ExecResult, subcommand: string): T | HcError {
  try {
    return JSON.parse(r.stdout.trim() || r.stderr.trim()) as T | HcError;
  } catch {
    throw new Error(`hc ${subcommand} gave no JSON (exit ${r.code}): ${(r.stderr || r.stdout).trim()}`);
  }
}

const fromBase64 = (text: string) => Buffer.from(text, "base64").toString("utf8");

/** A Host for Node. `hc` says how to run herdr-core's CLI for `on: "<machine>"` (default: `hc` on PATH). */
export function createNodeHost(options: { hc?: HcCommand } = {}): Host {
  const hc: HcCommand = options.hc ?? { command: "hc" };

  /** Runs hc with `args`, which must ask for `--json` before any `--`. */
  async function hcJson<T>(args: string[], timeout = EXEC_TIMEOUT_MS): Promise<T | HcError> {
    return parseHcReply<T>(await runHere(hc.command, [...(hc.args ?? []), ...args], undefined, timeout), args[0] ?? "");
  }

  /** Runs `command` on a herdr-core machine, the way a mod's `exec(..., { on })` does. */
  async function runOn(machine: string, command: string, args: string[], cwd: string | undefined, timeoutMs: number): Promise<ExecResult> {
    // hc takes whole seconds and enforces them on the remote side; the local wait gets a margin for the round trip.
    const seconds = Math.ceil(timeoutMs / 1000);
    const hcArgs = ["exec", "--json", "--on", machine, "--timeout", String(seconds), ...(cwd ? ["--cwd", cwd] : [])];
    const reply = await hcJson<HcExec>([...hcArgs, "--", command, ...args], seconds * 1000 + 5_000);
    if ("error" in reply) throw new Error(reply.error.message);
    if (reply.timed_out) throw new Error(`${command} timed out after ${seconds} s on ${machine}`);
    if (reply.truncated) throw new Error(`${command} wrote too much output on ${machine}`);
    return { code: reply.code, stdout: fromBase64(reply.stdout), stderr: fromBase64(reply.stderr) };
  }

  return {
    async exec(command: string, args: string[] = [], options: ExecOptions = {}) {
      const timeout = clampTimeout(options.timeout);
      return options.on ? runOn(options.on, command, args, options.cwd, timeout) : runHere(command, args, options.cwd, timeout);
    },

    fetch: (url, request) => fetch(url, request),

    async readTextFile(path, options) {
      if (options?.on) {
        const reply = await hcJson<HcFileRead>(["file", "read", "--json", "--on", options.on, "--", path]);
        if (!("error" in reply)) return reply.text;
        if (reply.error.kind === "not_found") return null;
        throw new Error(reply.error.message);
      }
      try {
        return await readFile(path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },

    async listDir(path) {
      try {
        return await readdir(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
    },

    removeFile: (path) => rm(path, { force: true }),

    home: () => homedir(),
  };
}

export const nodeHost: Host = createNodeHost();
