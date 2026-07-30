// ConsoleView: what the program has printed so far. The tracer captures stdout
// and the adapter puts the cumulative text on each step (`output`) plus the tail
// printed by that step (`printed`), so this panel is stateless - it just shows
// the whole transcript for the current step and highlights the freshly printed
// line. That closes the loop for a learner: they see `Console.WriteLine(...)`
// run AND see the text land in the console, instead of it vanishing.

import type { Panel, SyncCtx } from "./panel.js";

export class ConsoleView implements Panel {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "cl-mv-console";
    this.el.innerHTML =
      `<div class="cl-mv-console-head">Console</div>` +
      `<pre class="cl-mv-console-body" data-out></pre>`;
    this.body = this.el.querySelector("[data-out]") as HTMLElement;
  }

  sync(ctx: SyncCtx): void {
    const output = ctx.model.output ?? "";
    const printed = ctx.model.printed ?? "";
    if (output === "") {
      this.body.innerHTML = `<span class="cl-mv-console-idle">Nothing printed yet.</span>`;
      return;
    }
    // Highlight only the tail this step printed, so the learner's eye follows the
    // newest line as they step. `output` ends with `printed` on a printing step;
    // on a non-printing step (or after stepping back) nothing is highlighted.
    if (printed && output.endsWith(printed)) {
      const head = output.slice(0, output.length - printed.length);
      this.body.innerHTML = esc(head) + `<span class="cl-mv-console-new">${esc(printed)}</span>`;
    } else {
      this.body.textContent = output;
    }
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
