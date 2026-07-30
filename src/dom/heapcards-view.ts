// HeapCardsView: the level-2 execution panel. It shows the running frames with
// their locals on the left - primitives inline (`count : 5`), references as a
// small dot, an explicit `null` in red - and the heap objects as rounded cards
// on the right, with a curved arrow drawn from each reference dot to the object
// it points to. It is self-contained: it owns both ends of every arrow (the dot
// and the card), so no cross-panel geometry is needed - the same approach the
// hardware die view uses. Value vs reference is taught by one picture.

import type { Panel, SyncCtx } from "./panel.js";
import type {
  Frame,
  GlobalSlot,
  HeapObject,
  Ref,
  ResolvedModel,
  Slot,
} from "../core/memory-model.js";
import { slotKind } from "../core/memory-model.js";
import { svgEl } from "./svg.js";

export class HeapCardsView implements Panel {
  readonly el: HTMLElement;
  private readonly statics: HTMLElement;
  private readonly roots: HTMLElement;
  private readonly objs: HTMLElement;
  private readonly arrows: SVGSVGElement;
  private readonly markerId: string;

  constructor(uid: number) {
    this.markerId = `clmv-hp-ah-${uid}`;
    this.el = document.createElement("div");
    this.el.className = "cl-mv-region cl-mv-heapcards";
    this.el.innerHTML =
      `<span class="cl-mv-tag">MEMORY <span>\u00b7 names on the left, objects on the right</span></span>` +
      `<div class="cl-mv-hp-statics" data-hpstatics></div>` +
      `<div class="cl-mv-hp-cols">` +
      `<div class="cl-mv-hp-roots" data-hproots></div>` +
      `<div class="cl-mv-hp-objs" data-hpobjs></div>` +
      `<svg class="cl-mv-hp-arrows"><defs>` +
      `<marker id="${this.markerId}" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">` +
      `<path d="M0,0 L9,4.5 L0,9 z" fill="#2563eb" stroke="none" /></marker>` +
      `</defs></svg>` +
      `</div>`;
    this.statics = this.el.querySelector("[data-hpstatics]") as HTMLElement;
    this.roots = this.el.querySelector("[data-hproots]") as HTMLElement;
    this.objs = this.el.querySelector("[data-hpobjs]") as HTMLElement;
    this.arrows = this.el.querySelector(".cl-mv-hp-arrows") as SVGSVGElement;
  }

  sync(ctx: SyncCtx): void {
    this.render(ctx.model);
  }

  onResize(model: ResolvedModel): void {
    this.drawArrows(model.refs);
  }

  private render(model: ResolvedModel): void {
    this.statics.innerHTML = staticsHtml(model.globals ?? [], model.rodata ?? []);
    this.roots.innerHTML = framesHtml(model.stack ?? []);
    this.objs.innerHTML = (model.heap ?? []).map((o) => objHtml(o, model.glow)).join("");
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => this.drawArrows(model.refs));
    } else {
      this.drawArrows(model.refs);
    }
  }

  private drawArrows(refs: Ref[]): void {
    this.arrows.querySelectorAll("path.cl-mv-hp-ref").forEach((p) => p.remove());
    const box = this.arrows.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) return;
    (refs ?? []).forEach((r) => {
      const from = this.el.querySelector(`[data-dot="${r.from}"]`);
      const to = this.el.querySelector(`[data-obj="${r.to}"]`);
      if (!from || !to) return;
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      const x1 = a.left + a.width / 2 - box.left;
      const y1 = a.top + a.height / 2 - box.top;
      const x2 = b.left - box.left - 2;
      const y2 = b.top + Math.min(b.height / 2, 18) - box.top;
      const dx = Math.max(36, (x2 - x1) * 0.5);
      const path = svgEl("path", {
        class: "cl-mv-hp-ref",
        d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
        "marker-end": `url(#${this.markerId})`,
      });
      this.arrows.appendChild(path);
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => path.classList.add("show"));
      } else {
        path.classList.add("show");
      }
    });
  }
}

function staticsHtml(globals: GlobalSlot[], rodata: GlobalSlot[]): string {
  return [
    globals.length ? staticGroupHtml("STATICS", "values shared across the program", globals, true) : "",
    rodata.length ? staticGroupHtml("CONSTANTS", "fixed at compile time", rodata, false) : "",
  ].join("");
}

function staticGroupHtml(title: string, note: string, slots: GlobalSlot[], allowHot: boolean): string {
  const rows = slots.map((slot) => staticRowHtml(slot, allowHot)).join("");
  return (
    `<div class="cl-mv-hp-sgroup">` +
    `<span class="cl-mv-tag">${esc(title)} <span>&#183; ${esc(note)}</span></span>` +
    `<div class="cl-mv-hp-srows">${rows}</div>` +
    `</div>`
  );
}

function staticRowHtml(slot: GlobalSlot, allowHot: boolean): string {
  const hot = allowHot && slot.hot ? " is-changed" : "";
  return (
    `<div class="cl-mv-hp-row${hot}">` +
    `<span class="cl-mv-hp-name">${esc(slot.k)}</span>` +
    `<span class="cl-mv-hp-val">${esc(slot.v)}</span>` +
    `</div>`
  );
}

// Frames newest-first, so a called function sits above its caller - the active
// frame is the top card.
function framesHtml(stack: Frame[]): string {
  const frames = [...stack].reverse();
  return frames
    .map((frame, i) => {
      const active = i === 0;
      const cls = "cl-mv-hp-frame" + (active ? " is-active" : " is-caller");
      const title = frame.name ?? frame.id;
      const rows = (frame.vars ?? []).map(rowHtml).join("");
      return (
        `<div class="${cls}">` +
        `<div class="cl-mv-hp-fname">${esc(title)}</div>` +
        `<div class="cl-mv-hp-rows">${rows}</div>` +
        `</div>`
      );
    })
    .join("");
}

function rowHtml(v: Slot): string {
  const kind = slotKind(v);
  const hot = v.hot ? " is-changed" : "";
  const name = `<span class="cl-mv-hp-name">${esc(v.k ?? v.id)}</span>`;
  if (kind === "ref") {
    return (
      `<div class="cl-mv-hp-row is-ref${hot}">` +
      name +
      `<span class="cl-mv-hp-ref-cell"><span class="cl-mv-hp-arrowglyph">\u2192</span>` +
      `<span class="cl-mv-hp-dot" data-dot="${esc(v.id)}"></span></span>` +
      `</div>`
    );
  }
  if (kind === "null") {
    return (
      `<div class="cl-mv-hp-row is-null${hot}">` +
      name +
      `<span class="cl-mv-hp-val">null</span>` +
      `</div>`
    );
  }
  const text = kind === "empty" ? "unassigned" : v.v ?? "";
  const emptyCls = kind === "empty" ? " is-empty" : "";
  return (
    `<div class="cl-mv-hp-row${emptyCls}${hot}">` +
    name +
    `<span class="cl-mv-hp-val">${esc(text)}</span>` +
    `</div>`
  );
}

function objHtml(o: HeapObject, glow?: string): string {
  const cls =
    "cl-mv-hp-card" + (o.dim ? " is-dim" : "") + (glow === o.id ? " glow" : "");
  const fields = (o.fields ?? [])
    .map((field) => {
      const isHot = (o.hotFields ?? []).includes(field[0]);
      return (
        `<div class="cl-mv-hp-field${isHot ? " is-hot" : ""}">` +
        `<span class="cl-mv-hp-fkey">${esc(field[0])}</span>` +
        `<span class="cl-mv-hp-fval">${esc(field[1])}</span>` +
        `</div>`
      );
    })
    .join("");
  return (
    `<div class="${cls}" data-obj="${esc(o.id)}">` +
    `<div class="cl-mv-hp-type">${esc(o.type)}</div>` +
    fields +
    `</div>`
  );
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}
