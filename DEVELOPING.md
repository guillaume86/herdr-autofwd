# Developing herdr-autofwd

This repo was made from the herdr-tools template: each tool has **one TypeScript core** and up
to two entry points:

- a **standalone CLI** (Node), and
- a **herdr-app mod** (here, a status-bar item and its popup).

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
Developed on Node 26.) After `pnpm build`, `pnpm add -g .` puts the `bin` entries on PATH (linked to this folder).


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
herdr-app do pane.split '{"direction":"right","mod":"hc-autofwd"}'
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
`src/lib/`, mod-only ones to `src/ui/`.
