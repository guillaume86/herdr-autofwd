import { View, div, svg, type AsyncContext, type Context, type Element } from "gpui-kit";
import { Switch, h_flex, v_flex } from "gpui-base";
import { closeOverlay, nextCommand, notify, openOverlay, props, run, setShared, settings, shared, terminals, watchFolder } from "herdr";
import { herdrHost } from "../../hosts/herdr.ts";
import { type Palette, colors } from "../../ui/theme.ts";
import {
  type Entry,
  type Identities,
  type Machine,
  type Phase,
  type Settings,
  type Tunnel,
  checkAutofwd,
  entries,
  listMachines,
  listTunnels,
  loadSettings,
  phase,
  readStatuses,
  retryTunnel,
  startTunnel,
  statusFileOf,
  stopTunnel,
  summary,
  sweep,
  tunnelsOf,
} from "./core.ts";

// One view, two roles, like Claude Usage: in a status bar it is a compact line (a dot per tunnel),
// and a click opens it again as a popup (`props().overlay`) to switch tunnels and see their ports.
// It only shows and asks: the tunnels are hc terminals that core.ts starts and stops, the same ones
// the CLI sees, and they keep running when the window closes. The bar, always on screen, is the
// copy that starts the remembered tunnels when Herdr starts.

const NAME = "hc-autofwd";
const ICON = `mods/${NAME}/tunnel.svg`;
/** Persisted for every copy: start with Herdr, and the machines switched on in the popup. */
const PREFS_KEY = NAME;
/** When the popup last closed: the press that closes it also reaches the bar (see `toggle`). */
const POPUP_CLOSED = `${NAME}.popup-closed`;
/** The open popup's overlay id, so a command can close it instead of opening a second one. */
const POPUP_OPEN = `${NAME}.popup`;
const SAME_PRESS_MS = 250;
/** The bar's last look at hc, so a copy that just started (a popup opening, the bar after a
 *  restart) draws it at once while it asks hc again. Written only when it changed. */
const CACHE_KEY = `${NAME}.cache`;

/** Reading terminals() runs nothing: it says when a tunnel's terminal starts or ends. */
const CHECK_MS = 2_000;
/** Machines (hc machine ls) and the ages shown move slowly. */
const SLOW_MS = 30_000;
/** A missing status folder (no tunnel yet) is watched again after this. */
const WATCH_RETRY_MS = 5_000;

const PAD = 12;
const POPUP_W = 340;
/** The popup's card around the machine list: padding, header, footer, gaps. */
const POPUP_CHROME = 104;
const GAP = 6;
const INDENT = 34;
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

interface Prefs {
  autostart: boolean;
  machines: string[];
}

interface Snapshot {
  machines: Machine[];
  tunnels: Tunnel[];
  autofwd: string;
  autofwdOk: boolean;
}

function readPrefs(): Prefs {
  const raw = shared(PREFS_KEY) as Partial<Prefs> | null | undefined;
  return {
    autostart: raw?.autostart === true,
    machines: Array.isArray(raw?.machines) ? raw.machines.filter((m): m is string => typeof m === "string") : [],
  };
}

/** Which tunnel terminals exist and how they are: a change means asking hc again. */
function tunnelSignature(): string {
  return terminals()
    .filter((t) => t?.labels?.["hc-autofwd"] === "tunnel" || String(t?.name ?? "").startsWith("autofwd-"))
    .map((t) => `${t.address}:${t.state}`)
    .join(",");
}

function phaseColor(p: Phase, t: Palette) {
  switch (p) {
    case "connected":
      return t.done;
    case "off":
      return t.dim;
    case "failed":
    case "stopped":
      return t.blocked;
    default:
      return t.working;
  }
}

const zoom = () => Number(settings()?.zoom) || 1;

/** What both roles know and do: hc's machines and tunnels, the status files, the actions. */
class Model {
  settings: Settings | null = null;
  /** autofwd's version, or why it can't run tunnels. */
  autofwd = "";
  autofwdOk = false;
  machines: Machine[] = [];
  tunnels: Tunnel[] = [];
  known: Identities = new Map();
  error: string | null = null;
  loading = true;
  refreshing = false;
  dirty = false;
  /** Machines with a start, stop or retry under way. */
  pending = new Set<string>();
  signature = "";
  /** The bar's model: it writes CACHE_KEY after each look at hc. */
  publish = false;
  published = "";

  /** Draws the cached look, if any, until `open` has a fresh one ("Refreshing…" meanwhile). */
  seed(): void {
    const c = shared(CACHE_KEY) as Partial<Snapshot> | null | undefined;
    if (!c || !Array.isArray(c.machines) || !Array.isArray(c.tunnels)) return;
    this.machines = c.machines;
    this.tunnels = c.tunnels;
    this.autofwd = typeof c.autofwd === "string" ? c.autofwd : "";
    this.autofwdOk = c.autofwdOk === true;
    this.loading = false;
    this.refreshing = true;
  }

  /** Settings, the autofwd check, the first load. */
  async open(): Promise<void> {
    try {
      this.settings = await loadSettings(herdrHost);
    } catch (error) {
      this.error = message(error);
      this.loading = this.refreshing = false;
      return;
    }
    try {
      this.autofwd = await checkAutofwd(herdrHost, this.settings);
      this.autofwdOk = true;
    } catch (error) {
      this.autofwd = message(error);
      this.autofwdOk = false;
    }
    await this.load();
    this.loading = this.refreshing = false;
  }

  /** Shares what the bar saw, without what changes every few seconds (open connections, keepalives). */
  share(): void {
    const snapshot: Snapshot = {
      machines: this.machines,
      tunnels: this.tunnels.map((t) => ({
        ...t,
        status: t.status && { ...t.status, lastKeepalive: null, forwards: t.status.forwards.map((f) => ({ ...f, conns: 0 })) },
      })),
      autofwd: this.autofwd,
      autofwdOk: this.autofwdOk,
    };
    const text = JSON.stringify(snapshot);
    if (text === this.published) return;
    this.published = text;
    setShared(CACHE_KEY, snapshot);
  }

  /** Asks hc for the machines and tunnels, and sweeps status files nobody owns. */
  async load(): Promise<void> {
    const settings = this.settings;
    if (!settings) return;
    try {
      const [machines, list] = await Promise.all([listMachines(herdrHost), listTunnels(herdrHost, settings, this.known)]);
      this.machines = machines;
      this.tunnels = list.tunnels;
      this.error = null;
      if (this.publish) this.share();
      await sweep(herdrHost, settings, list);
    } catch (error) {
      this.error = message(error);
    }
    this.signature = tunnelSignature();
  }

  refresh(cx: Context): void {
    if (!this.settings) return;
    if (this.refreshing) {
      this.dirty = true;
      return;
    }
    this.refreshing = true;
    cx.notify();
    cx.spawn(async (cx) => {
      do {
        this.dirty = false;
        await this.load();
      } while (this.dirty);
      this.refreshing = false;
      cx.notify();
    });
  }

  /** The cheap check a timer runs: a tunnel terminal came or went, or it's time for a full look (ages too). */
  tick(cx: Context, slow: boolean): void {
    if (slow || tunnelSignature() !== this.signature) this.refresh(cx);
  }

  /** autofwd rewrites its file on every change: reread them, and ask hc when one is new. */
  watch(cx: AsyncContext): void {
    const settings = this.settings;
    if (!settings) return;
    cx.spawn(async (cx) => {
      for (;;) {
        let changed: string[];
        try {
          changed = await watchFolder(settings.statusDir);
        } catch {
          await cx.sleep(WATCH_RETRY_MS); // no folder before the first tunnel
          continue;
        }
        const files = new Set(this.tunnels.map((t) => t.file));
        const unknown = changed.some((path) => {
          const file = statusFileOf(path.split(/[\\/]/).pop() ?? "");
          return file !== null && !files.has(file);
        });
        if (unknown) this.refresh(cx);
        else await readStatuses(herdrHost, settings, this.tunnels).catch(() => {});
        cx.notify();
      }
    });
  }

  /** Runs one machine's action, showing it as under way; a failure becomes a toast. */
  async act(cx: AsyncContext, name: string, action: () => Promise<unknown>, reload = true): Promise<void> {
    this.pending.add(name);
    cx.notify();
    try {
      await action();
    } catch (error) {
      notify({ title: `Tunnel to ${name}`, body: message(error), level: "error", timeout: 8000 });
    }
    if (reload) await this.load();
    this.pending.delete(name);
    cx.notify();
  }

  start(m: Machine): Promise<unknown> {
    const settings = this.settings;
    if (!settings) return Promise.reject(new Error("no settings"));
    return startTunnel(herdrHost, settings, m, this.tunnels);
  }

  async stop(name: string): Promise<void> {
    const settings = this.settings;
    if (!settings) return;
    for (const t of tunnelsOf(this.tunnels, name)) await stopTunnel(herdrHost, settings, t);
  }

  /** Starts the remembered machines that have no running tunnel. */
  async resume(cx: AsyncContext): Promise<void> {
    if (!this.autofwdOk || !readPrefs().autostart) return;
    const { machines } = readPrefs();
    const down = this.machines.filter((m) => m.target && machines.includes(m.name) && !tunnelsOf(this.tunnels, m.name).some((t) => t.live));
    for (const m of down) await this.act(cx, m.name, () => this.start(m), false);
    if (down.length > 0) await this.load();
    cx.notify();
  }

  toggle(cx: Context, e: Entry, on: boolean): void {
    if (this.pending.has(e.name)) return;
    const machine = e.machine;
    const prefs = readPrefs();
    const machines = prefs.machines.filter((m) => m !== e.name);
    if (on) machines.push(e.name);
    setShared(PREFS_KEY, { ...prefs, machines });
    cx.spawn((cx) => this.act(cx, e.name, () => (on && machine ? this.start(machine) : this.stop(e.name))));
  }

  setAutostart(cx: Context, on: boolean): void {
    const prefs = readPrefs();
    // Switching it on also remembers what runs now, so the next start brings that back.
    const running = on ? this.tunnels.filter((t) => t.live).map((t) => t.machine) : [];
    setShared(PREFS_KEY, { autostart: on, machines: [...new Set([...prefs.machines, ...running])] });
    cx.notify();
  }

  /** The machine list's height, estimated: a popup can't be measured before it opens. */
  listHeight(expanded: Set<string> = new Set()): number {
    const rows = entries(this.machines, this.tunnels);
    const lines = rows.reduce((n, e) => {
      const s = e.tunnel?.live ? e.tunnel.status : null;
      const skipped = s?.skipped.length ? 1 + (expanded.has(e.name) ? s.skipped.length : 0) : 0;
      return n + 2 + (s?.forwards.length ?? 0) + (s?.busy.length ?? 0) + skipped;
    }, 0);
    return rows.length * 20 + lines * 21;
  }

  popupHeight(): number {
    return POPUP_CHROME + this.listHeight();
  }
}

export default class Tunnels extends View {
  model!: Model;
  popup!: boolean;
  /** Machines whose skipped ports are listed (popup). */
  expanded!: Set<string>;
  /** The bar's last press: where to open the popup, and when (see `toggle`). */
  anchor!: { x: number; y: number; width: number; height: number } | null;
  pressed!: number;
  fitted!: number;
  ticks!: number;

  override init(_props: unknown, cx: AsyncContext): void {
    this.model = new Model();
    this.popup = Boolean(props()?.overlay);
    this.model.publish = !this.popup;
    this.model.seed();
    this.expanded = new Set();
    this.anchor = null;
    this.pressed = 0;
    this.fitted = 0;
    this.ticks = 0;

    cx.spawn(async (cx) => {
      await this.model.open();
      cx.notify();
      if (!this.popup) await this.model.resume(cx);
      this.model.watch(cx);
    });
    if (this.popup) {
      setShared(POPUP_OPEN, props()?.overlay ?? null);
    } else {
      // `hc-autofwd.toggle` (keys.json, the palette, `herdr-app do`) opens the popup without a
      // click, or closes the open one. `open` is the same.
      cx.spawn(async (cx) => {
        for (;;) {
          const command = await nextCommand();
          if (command !== "toggle" && command !== "open") continue;
          const open = shared(POPUP_OPEN);
          if (typeof open === "string" && open !== "") {
            closeOverlay(open);
            setShared(POPUP_OPEN, null); // also when it was left over from a crash
          } else this.open(true);
          cx.notify();
        }
      });
    }
    cx.timer.every(CHECK_MS, (cx) => {
      this.ticks++;
      this.model.tick(cx, this.ticks % (SLOW_MS / CHECK_MS) === 0);
    });
  }

  override close(): void {
    if (!this.popup) return;
    setShared(POPUP_CLOSED, Date.now());
    if (shared(POPUP_OPEN) === props()?.overlay) setShared(POPUP_OPEN, null);
  }

  override render(): Element {
    return this.popup ? this.details() : this.bar();
  }

  // ── The bar ───────────────────────────────────────────────────────────────────────────

  /**
   * Above the bar, right-aligned with it, the card pinned to the bottom of a generous box. From a
   * command (no press to anchor on) it is a dialog in the middle of the window instead.
   */
  open(fromCommand = false): void {
    const b = fromCommand ? null : this.anchor;
    const z = zoom();
    const want = this.model.popupHeight();
    const height = b ? Math.min(want, b.y / z - GAP) : want;
    const at = b ? { x: Math.max(0, b.x + b.width - (POPUP_W + GAP) * z), y: b.y - (height + GAP) * z } : undefined;
    openOverlay({ mod: NAME, kind: b ? "popup" : "dialog", frame: "none", width: POPUP_W, height, ...(at && { at }), props: { details: true, height } });
  }

  /** The press that closes the popup also reaches the bar, whose click would open it straight away. */
  toggle(): void {
    const closed = Number(shared(POPUP_CLOSED)) || 0;
    if (Math.abs(closed - this.pressed) >= SAME_PRESS_MS) this.open();
  }

  /** The block takes the content's width (measured zoomed; the layout is at zoom 1). `fit: false` keeps it. */
  fit(width: number): void {
    if (props()?.fit === false) return;
    const px = Math.ceil(width / zoom()) + 2 * PAD;
    if (px === this.fitted) return;
    this.fitted = px;
    run("layout.resize", { id: String(props()?.block ?? NAME), px });
  }

  bar(): Element {
    const t = colors();
    const m = this.model;
    const now = Date.now();
    const shown = entries(m.machines, m.tunnels).filter((e) => e.tunnel !== null);
    const edge = props()?.border;
    const worst = shown.some((e) => ["failed", "stopped"].includes(phase(e.tunnel)));

    const tip = m.error
      ? m.error
      : !m.loading && !m.autofwdOk
        ? m.autofwd
        : shown.length === 0
          ? "No tunnels: click to start one"
          : shown.map((e) => `${e.name}: ${summary(e.tunnel, now)}`).join("\n");

    const items = shown.map((e) => {
      const p = phase(e.tunnel);
      const ports = e.tunnel?.live ? (e.tunnel.status?.forwards.length ?? 0) : 0;
      return h_flex()
        .gap(5)
        .items_center()
        .flex_none()
        .child(m.pending.has(e.name) ? div().text_color(t.working).frames(SPINNER, 90) : div().size(7).rounded(4).bg(phaseColor(p, t)))
        .child(div().text_color(t.muted).child(e.name))
        .when(ports > 0, (s) => s.child(div().text_color(t.dim).child(String(ports))));
    });

    return h_flex()
      .id("root")
      .size_full()
      .px(PAD)
      .items_center()
      .bg(t.chrome)
      .text_size(11.8)
      .cursor_pointer()
      .when(edge === "top", (s) => s.border_t(1).border_color(t.border))
      .when(edge === "bottom", (s) => s.border_b(1).border_color(t.border))
      .on_mouse_down("left", (e, cx) => {
        // gpui-shell declares ElementBounds through an import TypeScript doesn't follow: x and y go missing.
        this.anchor = e.bounds ? (e.bounds as unknown as { x: number; y: number; width: number; height: number }) : null;
        this.pressed = Date.now();
        cx.stop_propagation(); // a window_drag status bar would take the press
      })
      .on_click(() => this.toggle())
      .tooltip(tip)
      .child(
        h_flex()
          .id("content")
          .flex_none()
          .gap(10)
          .items_center()
          .on_size_change((size) => this.fit(size.width))
          .child(svg(ICON).size(13).flex_none().text_color(worst || m.error || (!m.loading && !m.autofwdOk) ? t.blocked : shown.length ? t.muted : t.dim))
          .when(m.loading, (s) => s.child(div().text_color(t.dim).child("…")))
          .when(!m.loading && shown.length === 0, (s) => s.child(div().text_color(t.dim).child(m.autofwdOk ? "tunnels" : "autofwd?")))
          .children(items),
      );
  }

  // ── The popup ─────────────────────────────────────────────────────────────────────────

  details(): Element {
    const t = colors();
    const m = this.model;
    const now = Date.now();
    const prefs = readPrefs();
    const height = Number(props()?.height) || this.model.popupHeight();

    const button = (id: string, label: string, tip: string, onClick: (cx: Context) => void) =>
      div()
        .id(id)
        .px(5)
        .rounded(4)
        .text_color(t.dim)
        .cursor_pointer()
        .tooltip(tip)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_event, cx) => onClick(cx))
        .child(label);

    // A Switch takes no tooltip (the shell owns hover only on div/flex/Button): the wrapper has it.
    const toggle = (id: string, on: boolean, disabled: boolean, tip: string, onChange: (cx: Context, on: boolean) => void) =>
      div()
        .id(`${id}-tip`)
        .flex_none()
        .tooltip(tip)
        .child(
          Switch.new(id)
            .checked(on)
            .disabled(disabled)
            .on_change((checked, cx) => onChange(cx, checked))
            .child(
              h_flex()
                .w(26)
                .h(14)
                .px(2)
                .rounded(7)
                .items_center()
                .bg(on ? t.accent : t.border)
                .opacity(disabled ? 0.5 : 1)
                .cursor_pointer()
                .when(on, (s) => s.justify_end())
                .child(div().size(10).rounded(5).bg(on ? t.accent_foreground : t.surface)),
            ),
        );

    const header = h_flex()
      .justify_between()
      .items_center()
      .child(
        h_flex()
          .gap(8)
          .items_center()
          .child(svg(ICON).size(15).text_color(t.foreground))
          .child(div().text_size(13).font_semibold().text_color(t.foreground).child("Tunnels")),
      )
      .child(
        m.loading || m.refreshing
          ? div().px(6).py(2).text_color(t.dim).child("Refreshing…")
          : div()
              .id("refresh")
              .px(6)
              .py(2)
              .rounded(5)
              .text_color(t.dim)
              .cursor_pointer()
              .hover((s) => s.bg(t.hover).text_color(t.foreground))
              .on_click((_e, cx) => m.refresh(cx))
              .child("Refresh"),
      );

    const rows = entries(m.machines, m.tunnels).map((e) => {
      const tun = e.tunnel;
      const p = phase(tun);
      const busy = m.pending.has(e.name);
      const on = tun !== null;
      const canStart = m.autofwdOk && !!e.machine?.target;
      const remembered = prefs.autostart && prefs.machines.includes(e.name);
      const status = tun?.live ? tun.status : null;

      const tip = !e.machine ? "hc no longer has this machine" : !e.machine.target ? "Reached through a command (--via): autofwd needs ssh" : on ? "Stop the tunnel" : "Start the tunnel";
      let line = summary(tun, now);
      if (p === "off" && e.machine && !e.machine.target) line = "off · reached --via, autofwd needs ssh";
      else if (p === "off" && e.machine?.why) line = "off · unreachable";

      const title = h_flex()
        .gap(8)
        .items_center()
        .child(toggle(`switch-${e.name}`, on, busy || (!on && !canStart), tip, (cx, value) => m.toggle(cx, e, value)))
        .child(div().text_color(t.foreground).child(e.name))
        .child(div().flex_1().min_w_0().truncate().text_color(t.dim).child(e.machine?.target ?? ""))
        .when(remembered, (s) => s.child(div().id(`auto-${e.name}`).text_color(t.dim).tooltip("Starts with Herdr").child("↺")))
        .when(tun?.live === true, (s) =>
          s.child(button(`retry-${e.name}`, "⟳", "Look for new ports now, retry busy ones", (cx) => cx.spawn((cx) => m.act(cx, e.name, () => retryTunnel(herdrHost, tun as Tunnel))))),
        )
        .when(tun !== null && !tun.live && canStart, (s) =>
          s.child(button(`restart-${e.name}`, "▶", "Start it again", (cx) => cx.spawn((cx) => m.act(cx, e.name, () => m.start(e.machine as Machine))))),
        )
        .when(tun !== null, (s) => s.child(button(`term-${e.name}`, "›_", "autofwd's own screen (passphrase, log)", () => run("terminal.peek", { terminal: (tun as Tunnel).address }))));

      const state = h_flex()
        .gap(6)
        .items_center()
        .pl(INDENT)
        .child(busy ? div().text_color(t.working).frames(SPINNER, 90) : div().size(7).rounded(4).flex_none().bg(phaseColor(p, t)))
        .child(div().id(`state-${e.name}`).flex_1().min_w_0().truncate().text_color(p === "failed" || p === "stopped" ? t.blocked : t.muted).tooltip(line).child(line));

      const forwards = (status?.forwards ?? []).map((f) =>
        h_flex()
          .id(`port-${e.name}-${f.port}`)
          .gap(8)
          .pl(INDENT)
          .pr(6)
          .rounded(4)
          .cursor_pointer()
          .tooltip(`Open ${f.url}${f.conns ? ` · ${f.conns} open` : ""}`)
          .hover((s) => s.bg(t.hover))
          .on_click((_event, cx) => cx.open_url(f.url))
          .child(div().w(44).flex_none().text_color(t.accent).child(String(f.port)))
          .child(div().flex_none().text_color(t.foreground).child(f.process || "?"))
          .child(div().flex_1().min_w_0().truncate().text_color(t.dim).child(f.dir)),
      );

      const busyPorts = (status?.busy ?? []).map((b) =>
        h_flex()
          .id(`busy-${e.name}-${b.port}`)
          .gap(8)
          .pl(INDENT)
          .tooltip(b.reason)
          .child(div().w(44).flex_none().text_color(t.blocked).child(String(b.port)))
          .child(div().flex_1().min_w_0().truncate().text_color(t.dim).child(`busy here: ${b.reason}`)),
      );

      const skipped = status?.skipped ?? [];
      const open = this.expanded.has(e.name);
      const skippedRows = skipped.length === 0
        ? []
        : [
            div()
              .id(`skipped-${e.name}`)
              .pl(INDENT)
              .text_color(t.dim)
              .cursor_pointer()
              .hover((s) => s.text_color(t.muted))
              .on_click((_event, cx) => {
                if (open) this.expanded.delete(e.name);
                else this.expanded.add(e.name);
                cx.notify();
              })
              .child(`${open ? "▾" : "▸"} ${skipped.length} skipped`),
            ...(open
              ? skipped.map((k) =>
                  h_flex()
                    .id(`skip-${e.name}-${k.port}`)
                    .gap(8)
                    .pl(INDENT)
                    .child(div().w(44).flex_none().text_color(t.dim).child(String(k.port)))
                    .child(div().flex_1().min_w_0().truncate().text_color(t.dim).child([k.process, k.reason].filter(Boolean).join(" · "))),
                )
              : []),
          ];

      return v_flex()
        .id(`machine-${e.name}`)
        .gap(3)
        .pt(10)
        .border_t(1)
        .border_color(t.border)
        .child(title)
        .child(state)
        .children(forwards)
        .children(busyPorts)
        .children(skippedRows);
    });

    const notes: Element[] = [];
    if (m.error) notes.push(div().text_size(11).text_color(t.blocked).child(m.error));
    if (!m.loading && m.settings && !m.autofwdOk) notes.push(div().text_size(11).text_color(t.blocked).child(m.autofwd));
    if (!m.loading && rows.length === 0 && !m.error) notes.push(div().text_color(t.dim).child("No machines in hc (hc machine add)"));

    const footer = h_flex()
      .gap(8)
      .items_center()
      .pt(10)
      .border_t(1)
      .border_color(t.border)
      .text_size(11)
      .child(toggle("autostart", prefs.autostart, false, "When Herdr starts, start the machines switched on here", (cx, on) => m.setAutostart(cx, on)))
      .child(div().text_color(t.muted).child("Start with Herdr"))
      .child(div().flex_1())
      .child(div().truncate().text_color(t.dim).child(m.autofwdOk ? m.autofwd : ""));

    return v_flex()
      .w_full()
      .h(height)
      .justify_end()
      .child(
        v_flex()
          .w_full()
          .max_h(height)
          .p(14)
          .gap(10)
          .text_size(12)
          .text_color(t.muted)
          .bg(t.popover)
          .border(1)
          .border_color(t.border)
          .rounded(8)
          .child(header)
          .children(notes)
          // A scroll area in an auto-height column measures as nothing, so the list is a scroll area
          // with a fixed height only when it doesn't fit; otherwise it simply takes its content's height.
          .child(
            m.listHeight(this.expanded) > height - POPUP_CHROME
              ? v_flex().id("machines").h(Math.max(60, height - POPUP_CHROME)).gap(10).overflow_y_scrollbar().children(rows)
              : v_flex().id("machines").gap(10).children(rows),
          )
          .child(footer),
      );
  }
}
