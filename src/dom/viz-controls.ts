// VizControls: the transport UI only - Prev/Play/Next/Reset, per-lesson action
// buttons, a draggable step scrubber, the text-size control and the legend. It
// emits intent through handlers and renders the state it is given.

import type { Panel, SyncCtx } from "./panel.js";
import type { LegendItem, VizLabels } from "../core/memory-model.js";
import { DEFAULT_VIZ_LABELS } from "../core/memory-model.js";
import type { DerivedTrace, NotableKind } from "../core/exec-trace.js";

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

const SVG_NS = "http://www.w3.org/2000/svg";

function legendHtml(items: LegendItem[]): string {
  return items
    .map((i) => {
      const round = i.round ? ";border-radius:50%" : "";
      return `<span><i class="cl-mv-sw" style="background:${i.sw}${round}"></i>${i.label}</span>`;
    })
    .join("");
}

function stepPercent(step: number, total: number): number {
  return total <= 1 ? 0 : (step / (total - 1)) * 100;
}

function notableLabel(kind: NotableKind): string {
  return kind === "new-object" ? "new object" : kind;
}

export class VizControls implements Panel {
  readonly el: HTMLElement;

  constructor(
    actions: Array<{ label: string }>,
    handlers: VizControlsHandlers,
    private readonly nextHref?: string,
    legend?: LegendItem[],
    private readonly nextLabel: string = DEFAULT_VIZ_LABELS.nextLesson,
    private readonly labels: VizLabels = DEFAULT_VIZ_LABELS,
  ) {
    this.el = document.createElement("div");
    this.el.innerHTML = `
      <div class="cl-mv-controls">
        <button data-c="prev">${labels.prev}</button>
        <button data-c="play" class="cl-mv-primary">${labels.play}</button>
        <button data-c="next" class="cl-mv-primary">${labels.next}</button>
        <button data-c="reset">${labels.reset}</button>
        <span class="cl-mv-spacer"></span>
        <div class="cl-mv-textsize" role="group" aria-label="${labels.textSize}">
          <span class="cl-mv-aa" aria-hidden="true">Aa</span>
          <button data-size="0.9" title="${labels.textSmall}" aria-label="${labels.textSmall}">S</button>
          <button data-size="1" title="${labels.textDefault}" aria-label="${labels.textDefault}">M</button>
          <button data-size="1.2" title="${labels.textLarge}" aria-label="${labels.textLarge}">L</button>
        </div>
      </div>
      <div class="cl-mv-scrubwrap">
        <svg class="cl-mv-depth" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg>
        <input type="range" class="cl-mv-scrub" data-scrub min="0" value="0" step="1" aria-label="${labels.step}" />
        <div class="cl-mv-marks" data-marks></div>
      </div>
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

  setDerived(derived: DerivedTrace, onJump: (step: number) => void): void {
    const depth = this.el.querySelector(".cl-mv-depth") as SVGSVGElement;
    const marks = this.el.querySelector("[data-marks]") as HTMLElement;
    const total = derived.callDepth.length;

    depth.textContent = "";
    marks.textContent = "";

    if (total > 0) {
      const maxDepth = Math.max(1, ...derived.callDepth);
      const points = derived.callDepth
        .map((d, i) => {
          const x = stepPercent(i, total);
          const y = 90 - (Math.max(0, d) / maxDepth) * 75;
          return `${x},${y}`;
        })
        .join(" ");
      const line = document.createElementNS(SVG_NS, "polyline");
      line.setAttribute("points", points);
      line.setAttribute("fill", "none");
      line.setAttribute("vector-effect", "non-scaling-stroke");
      depth.appendChild(line);
    }

    derived.notables.forEach((notable) => {
      const label = notableLabel(notable.kind);
      const mark = document.createElement("button");
      mark.type = "button";
      mark.className = `cl-mv-mark is-${notable.kind}`;
      mark.style.left = `${stepPercent(notable.step, total)}%`;
      mark.setAttribute("aria-label", `Jump to ${label} at step ${notable.step}`);
      mark.title = `Jump to ${label} at step ${notable.step}`;
      mark.addEventListener("click", () => onJump(notable.step));
      marks.appendChild(mark);
    });
  }

  update(state: TransportState): void {
    (this.el.querySelector('[data-c="prev"]') as HTMLButtonElement).disabled = state.atStart;
    const next = this.el.querySelector('[data-c="next"]') as HTMLButtonElement;
    if (state.atEnd && this.nextHref) {
      next.disabled = false;
      next.textContent = this.nextLabel;
    } else {
      next.disabled = state.atEnd;
      next.textContent = this.labels.next;
    }
    const scrub = this.el.querySelector("[data-scrub]") as HTMLInputElement;
    scrub.max = String(Math.max(0, state.total - 1));
    scrub.value = String(state.index);
  }

  setPlaying(playing: boolean): void {
    (this.el.querySelector('[data-c="play"]') as HTMLElement).textContent = playing ? this.labels.pause : this.labels.play;
  }

  resetActions(): void {
    this.el.querySelectorAll<HTMLButtonElement>("button.cl-mv-action").forEach((b) => (b.disabled = false));
  }

  disableAction(index: number): void {
    const btn = this.el.querySelector<HTMLButtonElement>(`button[data-action="${index}"]`);
    if (btn) btn.disabled = true;
  }
}
