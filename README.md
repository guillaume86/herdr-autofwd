# herdr-autofwd

Your remote dev servers on `localhost`, for every machine
[herdr-core](https://herdr.dev) knows. **hc-autofwd** runs
[autofwd](https://github.com/guillaume86/autofwd) to each of your `hc` machines: every TCP port
a process starts listening on over there opens on the same port here, and closes again when it
stops. It comes in two parts that share one library:

- **`hc-autofwd`**, a command line tool. It needs `hc` and `autofwd`, not the Herdr window.
- **Tunnels**, a [Herdr](https://herdr.dev) status-bar item: a dot per tunnel with its machine
  and port count. Click it for a popup to switch tunnels on and off per machine, see each
  forwarded port with the remote process and folder behind it, open a port in the browser, and
  start your tunnels again when Herdr starts.

Both start, show and stop the same tunnels: start one from the CLI and the bar shows it; switch
it off in the popup and `hc-autofwd ls` says so.

## What you need

- **herdr-core** (`hc`) with your machines added over ssh: `hc machine add <host>`, then
  `hc machine ls`. Machines added with `--via <command>` can't get a tunnel: autofwd needs ssh.
- **autofwd 0.3.0 or later** on your PATH: a [release](https://github.com/guillaume86/autofwd/releases),
  `mise use -g github:guillaume86/autofwd`, or
  `go install github.com/guillaume86/autofwd/cmd/autofwd@latest`. It reads `~/.ssh/config` and
  your ssh-agent; see its README for what the remote side needs (Linux, public-key login).
- **Node 22.18 or later and pnpm**, to build this repo.
- For the status-bar item, **herdr-app** and a layout you own (see below).

## Install

```sh
git clone https://github.com/guillaume86/herdr-autofwd
cd herdr-autofwd
pnpm install
pnpm build
```

### The command line

```sh
pnpm add -g .          # from the repo folder: puts hc-autofwd on your PATH
hc-autofwd ls
```

The global install is a link to this folder, so a `git pull` and `pnpm build` update it.

### The status-bar item

Quickest: ask your agent in Herdr

```text
Read ~/.config/herdr-app/AGENTS.md, then install the hc-autofwd mod from
https://github.com/guillaume86/herdr-autofwd (build it with pnpm) and put its bar in my status bar.
```

By hand:

1. **Copy the built mod** into your app home's `mods/` folder. The app home is `$HERDR_APP_HOME`,
   else `~/.config/herdr-app`.

   ```sh
   cp -r dist/mods/hc-autofwd ~/.config/herdr-app/mods/                        # macOS, Linux, Git Bash
   Copy-Item -Recurse dist/mods/hc-autofwd "$HOME/.config/herdr-app/mods/"     # PowerShell
   ```

2. **Put the bar in a status row** of a layout you own. Herdr's own layouts are read-only, so
   clone one first if you haven't: `herdr-app do layout.clone '{"name":"main","as":"my-layout"}'`.
   In `<app home>/layouts/my-layout.json`, the shipped status bar is one block,
   `{ "id": "status", "type": "block", "size": { "px": 28 }, "content": { "mod": "workspace-status" } }`.
   Make it a row with the bar beside it:

   ```json
   { "id": "status-bar", "type": "row", "size": { "px": 28 }, "resizable": false,
     "children": [
       { "id": "status", "type": "block", "content": { "mod": "workspace-status" } },
       { "id": "hc-autofwd", "type": "block", "size": { "px": 120 },
         "content": { "mod": "hc-autofwd", "props": { "border": "top" } } } ] }
   ```

   If your status bar is already a row, add just the `hc-autofwd` block to its `children`.

3. **Check it:** `herdr-app check ~/.config/herdr-app/mods/hc-autofwd`, then look at the bar.
   `herdr-app status` lists any error.

From a clone, `pnpm deploy-mods --real hc-autofwd` does step 1 and step 3. It deploys to
`~/.config/herdr-app`; set `HERDR_TOOLS_REAL_HOME` in `.env` if your window uses another home.

## Use

### Command line

```
hc-autofwd [ls]                 machines and their tunnels, with ports (--json)
hc-autofwd up <machine...>      start tunnels (--all: every machine reached over ssh)
hc-autofwd down [machine...]    stop tunnels (none named: all of them)
hc-autofwd restart <machine...> stop, then start again
hc-autofwd retry <machine...>   look for new remote ports now, retry busy ones
hc-autofwd attach <machine>     autofwd's own screen, to type a passphrase or watch (Ctrl+\ detaches)
```

Machines are named as in `hc machine ls`. `up` waits up to 15 seconds for each tunnel to connect
and prints where it stands:

```
$ hc-autofwd up desk
desk: started in t12 (autofwd gui-desktop)
desk: connected 2s · 9 ports
$ hc-autofwd ls
● desk  gui-desktop  connected 3m · 9 ports
    3000   http://localhost:3000    node  ~/src/shop
    8189   http://localhost:8189    python  ~/dev/comfy/ComfyUI
    skipped: 22 53 631 8443
· nas   herdr        off
```

Open the URLs as they are: same port numbers, on `localhost`, so secure cookies and OAuth
callbacks work as they do on the remote machine.

### In Herdr

- **The bar** shows a dot per tunnel, in your theme's agent-status colors: "done" when
  connected, "working" while connecting or reconnecting, "blocked" when stopped on an error.
  Next to it are the machine and its number of forwarded ports, and its tooltip has each
  tunnel's state. It sizes itself to what it shows.
- **The popup** opens with a click on the bar. It lists every machine with a switch and its
  state, then each forwarded port with the remote process and folder; click a port to open it
  in your browser. Ports already taken on this computer show as busy; ports autofwd filters out
  (system daemons, other users', below 1024) are folded under "skipped". Per machine, `⟳`
  looks for new ports now, `▶` starts a stopped tunnel again, and `›_` shows autofwd's own
  terminal.
- **Start with Herdr**, in the popup's footer, remembers the machines you switch on there and
  starts them when Herdr starts, if they aren't running. Tunnels already running are reused, not
  restarted.
- **A key:** the `hc-autofwd.toggle` command opens or closes the popup. To bind it, add it to
  `<app home>/keys.json`, for example `"global": { "ctrl-alt-t": "hc-autofwd.toggle" }`.

Bar props: `border` (`"top"` or `"bottom"`: a 1px line matching the bar beside it), `block` (the
block's id, which the bar resizes; default `"hc-autofwd"`), `fit: false` (keep the layout's
width).

## Settings

Optional, at `~/.config/hc-autofwd/config.json` on every platform:

```json
{ "autofwd": "C:/tools/autofwd.exe", "args": ["--min-port", "3000"] }
```

- `autofwd`: the program to run, a path or a name on PATH (default `autofwd`). The CLI also takes
  `--autofwd <path>`.
- `args`: more autofwd flags for every tunnel.

Which ports to forward, and settings per host, belong to autofwd's own
`config.toml` ([its README](https://github.com/guillaume86/autofwd#config-file)), keyed by the
ssh target `hc machine ls` shows.

## How it works

- **A tunnel is an hc terminal.** Each one is `autofwd <ssh target>` in a terminal of the local
  `hc`, started without a parent. It keeps running when the CLI, the Herdr window or the shell
  that started it ends, including across Herdr restarts. `hc ls` shows it as `autofwd-<machine>`.
  hc is the only record of what runs: the CLI and the bar find tunnels by their labels,
  `hc-autofwd=tunnel` and `hc-autofwd.machine=<name>`.
- **The ssh target** is the one `hc machine ls --json` gives, usually a `Host` from
  `~/.ssh/config`, which autofwd resolves the same way.
- **State:** autofwd keeps a JSON snapshot in `~/.cache/hc-autofwd/status/`, through its
  `--status-file` option. The file name is unique to each start and recorded in the terminal's
  `hc-autofwd.file` label, so it can't be mistaken for another tunnel's. A file no terminal names
  (from an autofwd that was killed) is deleted the next time the CLI or the bar looks.
- **Stopping** sends Ctrl+C through `hc keys`: autofwd closes its ports and deletes its file. One
  that hasn't ended after 5 seconds (for example at a passphrase prompt) is killed. Then the
  terminal is removed.
- **A tunnel that stops by itself** on an error autofwd can't retry (an unknown host key, an
  invalid `ssh_config`) stays as a finished terminal with the reason, until you start it again or
  switch it off. Network trouble isn't one: autofwd reconnects by itself.

## Troubleshooting

- **"has no --status-file"**: the `autofwd` found is older than 0.3.0. Update it, or point
  `autofwd` in the settings at a newer one.
- **Stuck on "connecting"**: autofwd may be asking for a key's passphrase. Type it with
  `hc-autofwd attach <machine>` or the popup's `›_`, or load the key into your ssh-agent.
- **A port shows as busy**: something on this computer already listens on it. autofwd never
  remaps a port; it tries again after 30 seconds, or right away with `retry` or `⟳`.
- **Two machines serve the same port**: the first tunnel to get it keeps it, and the other shows
  it as busy.
- **The bar is missing**: `herdr-app status` names the error, if any. The bar only shows where a
  layout puts it, and "Start with Herdr" only works while it does.

## Uninstall

1. **Stop the tunnels:** `hc-autofwd down`, or switch them off in the popup.
2. **Remove the bar:** take the `hc-autofwd` block out of your layout, then delete
   `<app home>/mods/hc-autofwd/`. The popup's preferences stay in `<app home>/shared.json` under
   `hc-autofwd` keys; they do nothing once the mod is gone.
3. **Remove the command:** `pnpm rm -g herdr-autofwd`.
4. **Remove what it left:** `~/.cache/hc-autofwd/` and, if you made one,
   `~/.config/hc-autofwd/`. Then delete the clone.

autofwd stays installed; remove it the way you installed it.

## Development

`pnpm check` runs the typecheck, the tests, the build and `herdr-app check`.
[DEVELOPING.md](DEVELOPING.md) covers how the repo is organized and how to develop and deploy
the mod against a throwaway Herdr window.
