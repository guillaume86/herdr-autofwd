import { readdir, unlink } from "fs/promises";
import { exec, home, readTextFile } from "herdr";
import { platform } from "os";
import type { Host } from "../host.ts";

/**
 * herdr-app's own functions. The Host shapes are copied from them, so nothing
 * here adapts anything; wrapping keeps each call inside the host call that makes it.
 * herdr's option types take no explicit `undefined`, hence the conditional spreads.
 * The exceptions are the folder calls: `listDir` turns a missing folder into [],
 * and `removeFile` deletes through the platform's command where a mod may not write.
 */
export const herdrHost: Host = {
  exec: (command, args, options) =>
    exec(command, args, {
      ...(options?.cwd !== undefined && { cwd: options.cwd }),
      ...(options?.timeout !== undefined && { timeout: options.timeout }),
      on: options?.on ?? null,
    }),
  fetch: (url, request) => fetch(url, request),
  readTextFile: (path, options) => readTextFile(path, { on: options?.on ?? null }),

  async listDir(path) {
    try {
      return await readdir(path);
    } catch {
      return []; // herdr's fs reports no error kinds: a missing folder looks like any other failure
    }
  },

  async removeFile(path) {
    try {
      await unlink(path);
      return;
    } catch {
      // Mods write only under the app's folder (and the file may be gone already): ask the platform.
    }
    const windows = /^win/i.test(platform());
    const r = windows
      ? await exec("cmd.exe", ["/d", "/c", "if", "exist", path, "del", "/f", "/q", path])
      : await exec("rm", ["-f", "--", path]);
    if (r.code !== 0) throw new Error(`cannot delete ${path}: ${(r.stderr || r.stdout).trim() || `exit ${r.code}`}`);
  },

  home: () => home(),
};
