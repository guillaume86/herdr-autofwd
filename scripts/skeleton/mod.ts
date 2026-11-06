import { View, div, type AsyncContext, type Context, type Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { herdrHost } from "../../hosts/herdr.ts";
import { colors } from "../../ui/theme.ts";
import { formatInfo, info } from "./core.ts";

/** The __Title__ panel: loads once, and again on the ↻ button. */
export default class __Name__ extends View {
  lines!: string[];
  error!: string | null;
  loading!: boolean;

  override init(_props: unknown, cx: AsyncContext): void {
    this.lines = [];
    this.error = null;
    this.loading = false;
    this.refresh(cx);
  }

  refresh(cx: Context): void {
    if (this.loading) return;
    this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        this.lines = formatInfo(await info(herdrHost));
        this.error = null;
      } catch (error) {
        this.lines = [];
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.loading = false;
      }
      cx.notify();
    });
  }

  override render(): Element {
    const t = colors();

    const header = h_flex()
      .justify_between()
      .items_center()
      .px(10)
      .py(6)
      .border_b(1)
      .border_color(t.border)
      .child(div().text_color(t.muted).child("__Title__"))
      .child(
        div()
          .id("refresh")
          .px(6)
          .rounded(4)
          .text_color(t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_event, cx) => this.refresh(cx))
          .child(this.loading ? "…" : "↻"),
      );

    const body = this.error
      ? div().p(10).text_color(t.muted).child(this.error)
      : v_flex().p(10).gap(4).children(this.lines.map((line, i) => div().id(`line-${i}`).text_color(t.foreground).child(line)));

    return v_flex().size_full().bg(t.surface).text_size(13).child(header).child(body);
  }
}
