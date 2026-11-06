/**
 * What a tool's core may ask of the outside world.
 *
 * A core file never imports `node:*` or `herdr` and never touches a runtime
 * global (tsconfig.core.json enforces it): each entry point hands it a Host.
 * The shapes copy herdr-app's own (`exec`, `fetch`, `readTextFile`), so the
 * herdr host is a pass-through and the Node host is the one that adapts. The
 * contract is the common ground of both runtimes: what only one of them can do
 * (hc's `--env`, Node's streams) stays out until herdr offers it too.
 *
 * The core has no timers either: herdr-app mods have no `setTimeout`. Waiting
 * and repeating belong to the entry point (`cx.timer` in a mod, a loop in a CLI).
 */

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  /** Working directory. Omitted: the process's (CLI) or the machine's home (remote). */
  cwd?: string | undefined;
  /** A herdr-core machine (`hc machine ls`); null or omitted runs it on this computer. */
  on?: string | null | undefined;
  /** Milliseconds before the program is ended and the call rejects: herdr's 30 s by default, at most 600 s
   *  (herdr-app releases up to 0.1.13 have no `timeout` and ignore it: always 30 s there). */
  timeout?: number | undefined;
}

export interface HttpRequest {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly url: string;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export interface Host {
  /**
   * Runs a program directly (no shell) and resolves with its exit code and output,
   * whatever the code. Rejects only when it cannot run: program or folder missing,
   * machine unreachable, `timeout` elapsed, more than 8 MiB of output (herdr-app's limits).
   */
  exec(command: string, args?: string[], options?: ExecOptions): Promise<ExecResult>;
  fetch(url: string, request?: HttpRequest): Promise<HttpResponse>;
  /** UTF-8 text, or null when the file does not exist. */
  readTextFile(path: string, options?: { on?: string | null | undefined }): Promise<string | null>;
  /** The names in a folder of this computer (files and folders, no paths), or [] when it does not exist. */
  listDir(path: string): Promise<string[]>;
  /**
   * Deletes a file of this computer; a file that is already gone is not an error.
   * Mods may only write under the app's folder, so the herdr host deletes elsewhere through
   * the platform's own command: keep this for files the tool itself manages.
   */
  removeFile(path: string): Promise<void>;
  /** The user's home directory on this computer. */
  home(): string;
}
