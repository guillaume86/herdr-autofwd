import type { ExecOptions, Host } from "../../host.ts";

// The logic of __name__: pure, tested in core.test.ts, loaded by cli.ts and mod.ts alike.
// It asks nothing of the outside world except through `host`. Replace all of it.

export interface Info {
  /** herdr-core's version where it ran (`hc --version`). */
  core: string;
  /** The user's home folder on this computer. */
  home: string;
}

/** What __name__ shows: here, or on the machine `options.on` names. */
export async function info(host: Host, options: ExecOptions = {}): Promise<Info> {
  const r = await host.exec("hc", ["--version"], options);
  if (r.code !== 0) throw new Error(r.stderr.trim() || `hc --version exited with ${r.code}`);
  return { core: r.stdout.trim(), home: host.home() };
}

/** One line per fact, for the CLI and the mod. */
export function formatInfo(i: Info): string[] {
  return [i.core, `home: ${i.home}`];
}
