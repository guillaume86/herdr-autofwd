# herdr-autofwd

**hc-autofwd** runs [autofwd](https://github.com/guillaume86/autofwd) tunnels from this
computer to your herdr-core machines (`hc machine ls`): every TCP port a remote process
listens on shows up on the same port of your `localhost`. It is one library with two faces:

- a **CLI**, `hc-autofwd`, that needs hc and autofwd but not herdr-app, and
- a **herdr-app status-bar item**, "Tunnels": a dot per tunnel in the status bar, and a
  popup on click to switch tunnels on and off, see their ports, and start them again when
  Herdr starts.

Both start and stop the same tunnels, so either one sees what the other did.

## How it runs

Each tunnel is one `autofwd <ssh target>` in a terminal of the **local** hc, started with
`--no-parent`: it keeps running when the CLI, the shell or the Herdr window that started it
ends, and `hc ls` shows it. hc is the record of what runs; there is no other state.

- **Which machines:** `hc machine ls --json` gives each machine's `target`, the destination
  hc gives ssh (often a `Host` of `~/.ssh/config`). autofwd resolves it the same way. Machines
  added with `--via <command>` have no ssh target, so they can't get a tunnel.
- **Labels:** a tunnel's terminal carries `hc-autofwd=tunnel` (what `hc ls --label` filters
  on) and `hc-autofwd.machine=<name>`. Its name is `autofwd-<name>`.
- **State:** autofwd runs with `--status-file ~/.cache/hc-autofwd/status/{pid}.json`. `hc get`
  gives the terminal's pid, so each file belongs to exactly one terminal. A file whose pid no
  tunnel terminal has (an autofwd that was killed) is deleted the next time either face looks.
- **Stopping:** Ctrl+C through `hc keys`, so autofwd closes its ports and deletes its file;
  one that hasn't ended 5 s later (for example at a passphrase prompt) is killed. Then the
  terminal is removed.
- **A tunnel that stopped by itself** (an unknown host key, a bad `ssh_config`) stays as a
  finished terminal, and its status file says why, until you start it again or switch it off.
- **Passphrases:** the terminal is a real one, so autofwd's own prompt works there:
  `hc-autofwd attach <machine>`, or the popup's `›_` button. An ssh-agent avoids the question.

It needs autofwd 0.3.0 or later (`--status-file`). Ports, filters and per-host
settings are autofwd's own: its `config.toml`, keyed by the ssh target.

## CLI

```
hc-autofwd [ls]                 machines and their tunnels, with ports (--json)
hc-autofwd up <machine...>      start tunnels (--all: every machine reached over ssh)
hc-autofwd down [machine...]    stop tunnels (none named: all of them)
hc-autofwd restart <machine...> stop, then start again
hc-autofwd retry <machine...>   look for new remote ports now, retry busy ones (autofwd's `r`)
hc-autofwd attach <machine>     autofwd's own screen (Ctrl+\ detaches)
```

`up` waits up to 15 s for each tunnel to connect and prints where it stands.

## In Herdr

**The bar:** a block for a status bar, like Claude Usage. It shows a dot per tunnel (green
connected, amber connecting, red stopped on an error) with the machine and its port count, and
a tooltip with each tunnel's state. It takes exactly its content's width (`layout.resize`).

**The popup** (click the bar, or the `hc-autofwd.toggle` command from `keys.json` or the
palette): one row per machine with a switch, the connection state, and the forwarded ports
with the remote process and folder; click a port to open it in the browser. Busy ports (taken
on this computer) and skipped ones (filtered by autofwd) are listed under them. `⟳` asks
autofwd to look for ports now, `▶` starts a stopped one again, `›_` peeks at autofwd's own
terminal.

**Start with Herdr** (the popup's footer) remembers the machines switched on there and, when
the bar starts with Herdr, starts the ones that aren't running. Tunnels already running are
left alone: they outlive the window anyway, so this is for after a reboot.

`mod.json` has `"place": "none"`: put the bar in a status row of a layout you own (clone a
shipped one with `layout.clone` first), next to `workspace-status`:

```json
{ "id": "status-bar", "type": "row", "size": { "px": 28 }, "resizable": false,
  "children": [
    { "id": "status", "type": "block", "content": { "mod": "workspace-status" } },
    { "id": "hc-autofwd", "type": "block", "size": { "px": 120 },
      "content": { "mod": "hc-autofwd", "props": { "border": "top" } } } ] }
```

Props: `border` (`"top"` or `"bottom"`: a 1px line to match the bar beside it), `block` (the
block's id, which the bar resizes; default `"hc-autofwd"`), `fit: false` (keep the layout's
width).

## Settings

Optional, the same on every platform: `~/.config/hc-autofwd/config.json`.

```json
{ "autofwd": "C:/tools/autofwd.exe", "args": ["--min-port", "3000"] }
```

`autofwd`: the program, a path or a name on PATH (default `autofwd`). `args`: more autofwd
flags for every tunnel. The CLI also takes `--autofwd <path>`.

---

The rest of this file is the template this repo was made from. Each tool has
**one TypeScript core** and up to two entry points:

- a **standalone CLI** (Node), and
- a **herdr-app mod** (a panel in the Herdr window).

Both load the same `core.ts`. The core is pure: it gets the outside world as a `Host`
argument and never imports Node or herdr.

```
src/
  host.ts                  the Host contract: exec, fetch, readTextFile, listDir, removeFile, home
  hosts/node.ts            Host for the CLI (child_process; `on` goes through hc)
  hosts/herdr.ts           Host for mods (herdr's exec/fetch/readTextFile, passed through)
  hosts/testing/           helpers for tests (a fake hc)
  ui/theme.ts              mod-only helpers (typed theme colors)
  lib/                     shared pure helpers, same rules as a core
  tools/<tool>/
    core.ts                the logic: pure, tested
    *.ts                   any other file is pure too (e.g. target.ts: the mod's decisions, tested in Node)
    *.test.ts              node:test
    cli.ts                 optional: argument parsing, printing
    mod.ts                 optional: a gpui-kit View (needs mod.json next to it)
    mod.json               where the mod first appears; *.svg/*.png assets are copied too
    <subfolder>/           fine for anything but the three entry points above
scripts/                   build, dev, app, sync-types, check-mods, deploy (mods.ts: what they share),
                           new-tool + skeleton/ (a barebones tool), create.js (this repo as a template)
types/                     herdr-app's .d.ts, aligned on upstream master (committed)
.env.example               the settings the scripts take; copy to .env to change them
```

## Commands

| Command | What it does |
|---|---|
| `pnpm test` | Runs every `src/**/*.test.ts` with Node's test runner; no build needed |
| `pnpm typecheck` | `tsc -b` on the three projects, after saying whether the app home's `.d.ts` differ from `types/` |
| `pnpm sync-types` | Takes the app home's `.d.ts` into `types/` (normally `types/` follows upstream, see below) |
| `pnpm build` | `dist/cli/<tool>.mjs` and `dist/mods/<tool>/` (main.js + mod.json + assets); checks `"bin"` |
| `pnpm check` | typecheck + test + build + `herdr-app check` on every built mod |
| `pnpm app` | Opens the throwaway window: the home `dev` and `deploy-mods` write to |
| `pnpm dev <tool>` | Rebuilds one mod on every save, straight into the app home's `mods/<tool>/`, and checks it there |
| `pnpm deploy-mods [--real] [tool…]` | build, then copy mods into the app home's `mods/<tool>/` and check them there; `--real`: into the window you work in |
| `pnpm new-tool <name>` | Adds a barebones tool (core, test, CLI, mod) and its `bin` entry |

During development, run a CLI from source: `node src/tools/<tool>/cli.ts …`
(Node ≥ 22.18 strips the types; 22 prints an ExperimentalWarning doing so, 24+ don't.
Developed on Node 26.) After `pnpm build`, `pnpm link --global` puts the `bin` entries on PATH.

## Starting a project from this repo

This repo is the template: `create-herdr-tool` copies it into a new folder and names the
project and its first tool after that folder. It runs straight from GitHub, nothing published:

```sh
pnpm --package=github:guillaume86/herdr-tools dlx create-herdr-tool my-tool
cd my-tool && pnpm install && pnpm app && pnpm check
```

By default the copy gets a barebones `my-tool` (core + test + CLI + mod, see
`scripts/skeleton/`) in place of `recent-commits`; `--tool <name>` names the tool differently
from the repo (`herdr-autofwd --tool autofwd`); `--example` keeps `recent-commits` instead.
Pin a tag (`#v0.2.0`) rather than a branch: pnpm caches `dlx` packages by spec for a day, so a
moving branch keeps giving the cached copy. `npx --package=github:… create-herdr-tool my-tool`
works the same; `pnpm create` and `npm init` do not take git specs, they need a published package.
pnpm may warn that it "failed to create bin … recent-commits": the template's built CLIs are not
committed, and nothing needs them during the copy.

## Two app homes

A herdr-app home (`HERDR_APP_HOME`, default `~/.config/herdr-app`) holds a window's layouts,
mods, settings and the type files the app generates. Spaces and terminals live in herdr-core,
not in the home, so a second window on another home shows the same spaces with its own mods.

The scripts never touch the window you work in by default. They use a **throwaway home**,
`~/.config/herdr-tools-app`: `pnpm app` opens its window (the first start writes the default
layouts, mods and `.d.ts` there), `pnpm dev` and `pnpm deploy-mods` write its `mods/`,
`herdr-app check` runs against it, `pnpm typecheck` compares its `.d.ts` with `types/`. A mod that misbehaves
there costs nothing. When a mod is good, `pnpm deploy-mods --real <tool>` puts it in your
**real home**.

Both paths are settings, and so is which `herdr-app` program the scripts run (the one on
PATH by default; a path to another build otherwise): copy `.env.example` to `.env`
(git-ignored) and set `HERDR_TOOLS_HOME`, `HERDR_TOOLS_REAL_HOME`, `HERDR_TOOLS_APP_BIN`.
A variable set in the shell wins over the file.

## The three projects

`tsconfig.json` is a solution over three projects. Each one sees only the globals its
runtime really has:

| Project | Files | Sees |
|---|---|---|
| `tsconfig.core.json` | `host.ts`, `lib/`, everything under `tools/` except `cli.ts`, `mod.ts` and tests | ES2022 only: no `console`, no `process`, no `node:*`, no `herdr` |
| `tsconfig.cli.json` | Node host, `cli.ts`, tests and `hosts/testing/`, scripts | + `@types/node` |
| `tsconfig.mod.json` | herdr host, `ui/`, `mod.ts` | + `types/gpui-kit.d.ts`, `herdr` → `types/herdr.d.ts` |

A core file that imports `node:fs` or `herdr`, or calls `console.log` or `process.cwd()`,
fails `tsc` (each case checked by mutation). That is the guarantee that a core runs in both
runtimes. The editor shows the same: it attributes an open file to the first project that
includes it, and the core project comes first.

The guarantee covers your own code, not npm packages. `types: []` only stops the automatic
`@types`; a package's own `/// <reference types="node" />` brings Node's globals back, and a
package that calls `process` or `fs` at run time typechecks and then fails on QuickJS. Keep
cores dependency-free by default; when a mod bundles a package, `pnpm build` names it and
`herdr-app check` is the gate.

`types/` is committed and **follows upstream herdr-app's master**, not a release or a fork:
`herdr.d.ts` is `defaults/herdr.d.ts` of https://github.com/herdrdev/herdr-app, `gpui-kit.d.ts`
is what the app writes (the same across builds so far). A fresh clone typechecks without the
app. `pnpm typecheck` only reports when the throwaway's app writes different files;
`pnpm sync-types` takes them when that is what you want (for example after upgrading the app
past what `types/` holds). After a change, `git diff types/` shows what moved in herdr's API,
and `pnpm test` fails if the theme colors did (`src/lib/theme-colors.ts`). A `Host` feature
that upstream has and a release lacks still typechecks; the app ignores what it doesn't know
(`timeout` in releases up to 0.1.13).

## Rules for a core

- **No I/O except through `Host`.** Pass it in: `recentCommits(host, options)`.
- **No timers.** Mods have no `setTimeout`. Repeating and waiting belong to the entry point
  (`cx.timer.every` in a mod, a loop in a CLI).
- **Pass `now` in** instead of calling `Date.now()` when the output depends on it, so tests
  are deterministic.
- **Throw `Error`s with a readable message.** The CLI prints it, the mod shows it.
- **Test helpers** live in a `testing/` folder or end in `.test.ts`. A plain `.ts` next to a
  core is a core: the core project checks it as pure.

`Host` is the common ground of both runtimes: what only one can do (hc's `--env`, Node's
streams) stays out until herdr offers it too. The Node host copies herdr's `exec` contract,
so a tool behaves the same in both:

- resolves with any exit code and rejects only when the program cannot run (missing
  program or folder, unreachable machine);
- stops after `timeout` ms (30 s by default, at most 600 s) and 8 MiB of output;
- `on: "<machine>"` runs on a herdr-core machine (the CLI goes through `hc exec` /
  `hc file read`).

## herdr-app runtime, in short

The source of truth is the app home's `AGENTS.md` and the `.d.ts` files next to it,
rewritten by the app on each start.

- Mods are ES modules on **QuickJS** inside the app. The UI is **gpui-kit**: JS describes
  GPUI elements, Rust draws them. There's no DOM, CSS or Node API.
- `main.js` default-exports a class extending `View`: `init(props, cx)` once,
  `render(cx)` again after `cx.notify()` and whenever Herdr's live data changes.
- Never keep a `cx`: each callback gets its own. Animate with `.frames()`, `.spin()` or
  `.loop()`, never with a redraw timer.
- `exec` (30 s, 8 MiB), `fetch`, `readTextFile` (1 MiB), `writeTextFile` (only under the
  app folder), `watchFolder`, plus `path`, `url`, `buffer`, `crypto`, `fs/promises`
  and `localStorage`.
- The build leaves herdr's modules (`herdr`, `gpui-*`, `fs/promises`, …) as imports and
  bundles everything else, npm dependencies included. Bundling avoids depending on how
  the app resolves bare imports.

## Developing a mod

`pnpm app` once, to open the throwaway window. Then `pnpm dev <tool>`: it claims
`<throwaway>/mods/<tool>/` the way deploy does (see below), copies `mod.json` and the assets,
rebuilds `main.js` there on every save of a source file and runs `herdr-app check` on the
folder. The window reloads the mod on each write; a build error or a failed check keeps the
previous version on screen and says so in the terminal. Changes to `mod.json` or an asset are
copied too. Ctrl-C stops it.

## Deploying a mod

`pnpm deploy-mods` copies `dist/mods/<tool>/` into the app home's `mods/` folder (the
throwaway; `--real` for the window you work in). Saving there reloads the mod in the running
window; a broken version keeps the old one running, so deploy runs `herdr-app check` on the
copy. Files the build no longer produces are removed from the folder. Deploy refuses:

- a folder named like a mod herdr-app ships (`installed.json`): rename the tool instead;
- an existing folder without the `.herdr-tools` marker, which means this repo didn't create it.

`"place": "none"` in `mod.json` keeps a mod out of the layout until you put it somewhere,
for example as a split next to the focused pane:

```sh
herdr-app do pane.split '{"direction":"right","mod":"recent-commits"}'
```

or as a block in a layout (`<home>/layouts/<name>.json`). Set `place` to `"right"`,
`"left"`, … (with `"size"`) to dock it the first time Herdr sees the folder.

## Adding a tool

`pnpm new-tool <name>` writes `src/tools/<name>/` from `scripts/skeleton/` and adds the `bin`
entry; `pnpm check` then covers it. What it gives you, and what a tool is made of:

1. `core.ts`: the logic, taking a `Host`; `core.test.ts` next to it, with a fake host.
2. `cli.ts` (starts with `#!/usr/bin/env node`) and the `"bin"` entry in `package.json`.
   Delete both if the tool has no command line; `pnpm build` fails when they disagree.
3. `mod.ts` + `mod.json`: the panel. Use `colors()` from `src/ui/theme.ts` for theme colors:
   herdr types them as plain strings, gpui-kit wants `#…`. Delete both if the tool has no panel.

A name is a folder, a `bin` command and a mod name at once: lowercase, digits and dashes, and
not the name of a mod herdr-app ships.

Shared code moves out of a tool when a second one needs it, not before: pure helpers to
`src/lib/`, mod-only ones to `src/ui/`. Candidates in `recent-commits`: `target.ts` (which
repository the focused pane points at) and the check/refresh/loading cycle of `mod.ts` with
its header, spinner, error and empty states.

`recent-commits` is the worked example: the last commits of a repository.

- **CLI:** `recent-commits [folder] [-n 15] [--on machine] [--json]`.
- **Mod:** the commits of the focused terminal's repository, including a space on another
  machine. Click a commit to copy its SHA.
