// VizControls: the transport UI only - Prev/Play/Next/Reset, per-lesson action
// buttons, a draggable step scrubber, the text-size control and the legend. It
// emits intent through handlers and renders the state it is given.

import type { Panel, SyncCtx } from "./panel.js";
import type { LegendItem } from "../core/memory-model.js";

export interface VizControlsHandlers {
  onPrev(): void;
  onNext(): void;
  onPlay(): void;
  onReset(): void;
  onAction(index: number): void;
  onFontSize(scale: number): void;
  onSeek(index: number): void;
}

export interface TransportState {
  index: number;
  total: number;
  atStart: boolean;
  atEnd: boolean;
}

const DEFAULT_LEGEND: LegendItem[] = [
  { sw: "#37d3a6", label: "data in RAM" },
  { sw: "#2b6a5b", label: "active CPU core" },
  { sw: "#ffd479", label: "signal on the bus", round: true },
  { sw: "#2563eb", label: "stack frame (a call)" },
  { sw: "#1f6f5f", label: "reference to an object", round: true },
];

function legendHtml(items: LegendItem[]): string {
  return items
    .map((i) => {
      const round = i.round ? ";border-radius:50%" : "";
      return `<span><i class="cl-mv-sw" style="background:${i.sw}${round}"></i>${i.label}</span>`;
    })
    .join("");
}

export class VizControls implements Panel {
  readonly el: HTMLElement;

  constructor(
    actions: Array<{ label: string }>,
    handlers: VizControlsHandlers,
    private readonly nextHref?: string,
    legend?: LegendItem[],
  ) {
    this.el = document.createElement("div");
    this.el.innerHTML = `
      <div class="cl-mv-controls">
        <button data-c="prev">◀ Prev</button>
        <button data-c="play" class="cl-mv-primary">▶ Play</button>
        <button data-c="next" class="cl-mv-primary">Next ▶</button>
        <button data-c="reset">Reset</button>
        <span class="cl-mv-spacer"></span>
        <div class="cl-mv-textsize" role="group" aria-label="Text size">
          <span class="cl-mv-aa" aria-hidden="true">Aa</span>
          <button data-size="0.9" title="Small text" aria-label="Small text">S</button>
          <button data-size="1" title="Default text" aria-label="Default text">M</button>
          <button data-size="1.2" title="Large text" aria-label="Large text">L</button>
        </div>
      </div>
      <input type="range" class="cl-mv-scrub" data-scrub min="0" value="0" step="1" aria-label="Step" />
      <div class="cl-mv-legend">${legendHtml(legend && legend.length ? legend : DEFAULT_LEGEND)}</div>`;

    const controls = this.el.querySelector(".cl-mv-controls") as HTMLElement;
    actions.forEach((a, i) => {
      const b = document.createElement("button");
      b.className = "cl-mv-action";
      b.textContent = a.label;
      b.dataset.action = String(i);
      controls.appendChild(b);
    });

    this.el.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest("button");
      if (!btn) return;
      if (btn.dataset.size != null) return handlers.onFontSize(Number(btn.dataset.size));
      switch (btn.dataset.c) {
        case "prev": return handlers.onPrev();
        case "next": return handlers.onNext();
        case "play": return handlers.onPlay();
        case "reset": return handlers.onReset();
        default:
          if (btn.dataset.action != null) handlers.onAction(Number(btn.dataset.action));
      }
    });

    const scrub = this.el.querySelector("[data-scrub]") as HTMLInputElement;
    scrub.addEventListener("input", () => handlers.onSeek(Number(scrub.value)));
  }

  sync(ctx: SyncCtx): void {
    this.update(ctx);
  }

  setActiveSize(scale: number): void {
    this.el.querySelectorAll<HTMLButtonElement>(".cl-mv-textsize button").forEach((b) => {
      b.classList.toggle("is-active", Number(b.dataset.size) === scale);
    });
  }

  update(state: TransportState): void {
    (this.el.querySelector('[data-c="prev"]') as HTMLButtonElement).disabled = state.atStart;
    const next = this.el.querySelector('[data-c="next"]') as HTMLButtonElement;
    if (state.atEnd && this.nextHref) {
      next.disabled = false;
      next.textContent = "Next lesson \u25b6";
    } else {
      next.disabled = state.atEnd;
      next.textContent = "Next \u25b6";
    }
    const scrub = this.el.querySelector("[data-scrub]") as HTMLInputElement;
    scrub.max = String(Math.max(0, state.total - 1));
    scrub.value = String(state.index);
  }

  setPlaying(playing: boolean): void {
    (this.el.querySelector('[data-c="play"]') as HTMLElement).textContent = playing ? "⏸ Pause" : "▶ Play";
  }

  resetActions(): void {
    this.el.querySelectorAll<HTMLButtonElement>("button.cl-mv-action").forEach((b) => (b.disabled = false));
  }

  disableAction(index: number): void {
    const btn = this.el.querySelector<HTMLButtonElement>(`button[data-action="${index}"]`);
    if (btn) btn.disabled = true;
  }
}
