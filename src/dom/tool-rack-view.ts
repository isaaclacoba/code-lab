// ToolRackView: the AI-track scene that shows an agent working with several tools.
// A rack of tool cards, each showing its schema (name + typed parameters) and a
// state colour, sits above an input/output area with the call the model emits and
// the result - or the error it must recover from. It renders the `toolRack` field
// of the current step and knows nothing about the model, the other panels, or the
// controls.

import type { ToolIoKind, ToolRackScene } from "../core/tool-rack-model.js";
import { resolveRackTools, toolRackRows } from "../core/tool-rack-model.js";
import { escapeHtml } from "../core/narration.js";
import type { Panel, SyncCtx } from "./panel.js";

/** How each I/O row reads: its CSS class and its direction label. Pure
 *  presentation, so the model stays free of markup. */
const IO_META: Record<ToolIoKind, { cls: string; dir: string }> = {
  call: { cls: "cl-tr-call", dir: "call \u2192" },
  error: { cls: "cl-tr-error", dir: "\u2190 error" },
  result: { cls: "cl-tr-result", dir: "\u2190 result" },
};

export class ToolRackView implements Panel {
  readonly el: HTMLElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "cl-tr";
    this.el.innerHTML = `
      <span class="cl-tr-cap" data-cap></span>
      <div class="cl-tr-rack" data-rack></div>
      <div class="cl-tr-io" data-io hidden></div>`;
  }

  sync(ctx: SyncCtx): void {
    const scene = ctx.model.toolRack ?? {};
    (this.el.querySelector("[data-cap]") as HTMLElement).textContent =
      scene.caption ?? "Tools the agent can call";
    this.renderRack(scene);
    this.renderIo(scene);
  }

  private renderRack(scene: ToolRackScene): void {
    const host = this.el.querySelector("[data-rack]") as HTMLElement;
    host.innerHTML = resolveRackTools(scene)
      .map((tool) => {
        const desc = tool.desc ? `<div class="cl-tr-tool-desc">${escapeHtml(tool.desc)}</div>` : "";
        return (
          `<div class="cl-tr-tool is-${tool.state}">` +
          `<code class="cl-tr-tool-sig">${escapeHtml(tool.signature)}</code>` +
          desc +
          `</div>`
        );
      })
      .join("");
  }

  private renderIo(scene: ToolRackScene): void {
    const io = this.el.querySelector("[data-io]") as HTMLElement;
    const rows = toolRackRows(scene);
    io.hidden = rows.length === 0;
    io.innerHTML = rows
      .map((row) => {
        const meta = IO_META[row.kind];
        return (
          `<div class="cl-tr-line ${meta.cls}">` +
          `<span class="cl-tr-dir">${meta.dir}</span>` +
          `<code class="cl-tr-chip">${escapeHtml(row.text)}</code></div>`
        );
      })
      .join("");
  }
}
