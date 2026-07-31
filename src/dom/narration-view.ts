// NarrationView: the step number + narration text. Kept as its own tiny view so
// the facade can place it right next to the active visual (between the board and
// the RAM die), where it is easy to read while the animation plays.

import type { Panel, SyncCtx } from "./panel.js";
import { renderNarration } from "../core/narration.js";
import type { VizLabels } from "../core/memory-model.js";
import { DEFAULT_VIZ_LABELS } from "../core/memory-model.js";

export class NarrationView implements Panel {
  readonly el: HTMLElement;
  private readonly stepWord: string;

  constructor(labels: VizLabels = DEFAULT_VIZ_LABELS) {
    this.stepWord = labels.step;
    this.el = document.createElement("div");
    this.el.className = "cl-mv-narr";
    this.el.innerHTML = `<span class="cl-mv-stepno" data-stepno></span><div class="cl-mv-narr-body" data-narr></div>`;
  }

  sync(ctx: SyncCtx): void {
    this.set(ctx.model.narr ?? "", `${this.stepWord.toUpperCase()} ${ctx.index + 1} / ${ctx.total}`);
  }

  set(text: string, stepLabel: string): void {
    (this.el.querySelector("[data-narr]") as HTMLElement).innerHTML = renderNarration(text);
    (this.el.querySelector("[data-stepno]") as HTMLElement).textContent = stepLabel;
  }
}
