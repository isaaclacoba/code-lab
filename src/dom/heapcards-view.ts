// HeapCardsView: the level-2 execution panel. It shows the running frames with
// their locals on the left - primitives inline (`count : 5`), references as a
// small dot, an explicit `null` in red - and the heap objects as rounded cards
// on the right, with a curved arrow drawn from each reference dot to the object
// it points to. It is self-contained: it owns both ends of every arrow (the dot
// and the card), so no cross-panel geometry is needed - the same approach the
// hardware die view uses. Value vs reference is taught by one picture.
//
// Frames and objects are reconciled by id (not re-created each step) so a call
// being pushed slides in and a call returning fades out - the call stack visibly
// grows and shrinks. Each frame names what kind of call it is (entry / instance
// method / static method / constructor) and, for an instance call, which object
// it runs on ("on Cart #1"); each object card carries its own "#n" so several
// instances of one type stay tellable apart.

import type { Panel, SyncCtx } from "./panel.js";
import type {
  Frame,
  GlobalSlot,
  HeapObject,
  Ref,
  ResolvedModel,
  Slot,
} from "../core/memory-model.js";
import { DEFAULT_VIZ_LABELS, slotKind } from "../core/memory-model.js";
import type { VizLabels } from "../core/memory-model.js";
import { fill } from "../core/template.js";
import { reconcile } from "./reconcile.js";
import { svgEl } from "./svg.js";

type FrameVM = Frame & { active: boolean };

export class HeapCardsView implements Panel {
  readonly el: HTMLElement;
  private readonly statics: HTMLElement;
  private readonly roots: HTMLElement;
  private readonly objs: HTMLElement;
  private readonly arrows: SVGSVGElement;
  private readonly markerId: string;
  // Arrow paths reused across renders (keyed "from->to"), so a reference that
  // stays put keeps its path and only its geometry updates - no flicker.
  private readonly refPaths = new Map<string, SVGElement>();
  // Bumped each render; the redraw loop stops once its generation is stale.
  private arrowGen = 0;

  private readonly labels: VizLabels;

  constructor(uid: number, labels: VizLabels = DEFAULT_VIZ_LABELS) {
    this.labels = labels;
    this.markerId = `clmv-hp-ah-${uid}`;
    this.el = document.createElement("div");
    this.el.className = "cl-mv-region cl-mv-heapcards";
    this.el.innerHTML =
      `<span class="cl-mv-tag">${esc(labels.hpMemory)} <span>\u00b7 ${esc(labels.hpMemoryNote)}</span></span>` +
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
    this.statics.innerHTML = staticsHtml(model.globals ?? [], model.rodata ?? [], this.labels);

    // Frames are reconciled in push order (caller first) and shown bottom-up via
    // column-reverse, so the active call is the top card and a freshly pushed
    // frame enters at the top. The last frame is the active one.
    const stack = model.stack ?? [];
    const frames: FrameVM[] = stack.map((f, i) => ({ ...f, active: i === stack.length - 1 }));
    reconcile(this.roots, frames, (f, existing) => frameNode(f, this.labels, existing));

    reconcile(this.objs, (model.heap ?? []).map((o) => ({ ...o })), objNode);

    (model.heap ?? []).forEach((o) => {
      const card = this.el.querySelector(`[data-obj="${o.id}"]`);
      if (card) card.classList.toggle("glow", model.glow === o.id);
    });

    // Frames and cards enter/leave over ~300ms; keep the arrows glued to their
    // moving dots for that whole window instead of drawing once on a stale layout.
    this.animateArrows(model.refs);
  }

  private animateArrows(refs: Ref[]): void {
    const gen = ++this.arrowGen;
    const start = now();
    const tick = () => {
      if (gen !== this.arrowGen) return; // a newer render took over
      this.drawArrows(refs);
      if (now() - start < 340) raf(tick);
    };
    raf(tick);
  }

  private drawArrows(refs: Ref[]): void {
    const box = this.arrows.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) return;

    const wanted = new Map<string, Ref>();
    (refs ?? []).forEach((r) => wanted.set(`${r.from}\u2192${r.to}`, r));

    // Drop paths whose reference is gone.
    for (const [key, path] of this.refPaths) {
      if (!wanted.has(key)) {
        path.remove();
        this.refPaths.delete(key);
      }
    }

    wanted.forEach((r, key) => {
      const from = this.el.querySelector(`[data-dot="${r.from}"]`);
      const to = this.el.querySelector(`[data-obj="${r.to}"]`);
      const existing = this.refPaths.get(key);
      if (!from || !to) {
        if (existing) { existing.remove(); this.refPaths.delete(key); }
        return;
      }
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      const x1 = a.left + a.width / 2 - box.left;
      const y1 = a.top + a.height / 2 - box.top;
      const x2 = b.left - box.left - 2;
      const y2 = b.top + Math.min(b.height / 2, 18) - box.top;
      const dx = Math.max(36, (x2 - x1) * 0.5);
      const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
      if (existing) {
        existing.setAttribute("d", d);
      } else {
        const path = svgEl("path", {
          class: "cl-mv-hp-ref",
          d,
          "marker-end": `url(#${this.markerId})`,
        });
        this.arrows.appendChild(path);
        this.refPaths.set(key, path);
        raf(() => path.classList.add("show"));
      }
    });
  }
}

function raf(fn: () => void): void {
  if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(fn);
  else fn();
}

function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function staticsHtml(globals: GlobalSlot[], rodata: GlobalSlot[], labels: VizLabels): string {
  return [
    globals.length ? staticGroupHtml(labels.hpStatics, labels.hpStaticsNote, globals, true) : "",
    rodata.length ? staticGroupHtml(labels.hpConstants, labels.hpConstantsNote, rodata, false) : "",
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

// A plain-language label for the kind of call a frame is, so it reads as what it
// is rather than just a bare name.
function kindLabel(kind: string | undefined, labels: VizLabels): string {
  switch (kind) {
    case "entry": return labels.hpKindEntry;
    case "static": return labels.hpKindStatic;
    case "method": return labels.hpKindMethod;
    case "ctor": return labels.hpKindCtor;
    default: return "";
  }
}

function frameNode(f: FrameVM, labels: VizLabels, existing?: HTMLElement): HTMLElement {
  const el = existing ?? document.createElement("div");
  el.className = "cl-mv-hp-frame" + (f.active ? " is-active" : " is-caller");
  const label = kindLabel(f.kind, labels);
  const badge = label ? `<span class="cl-mv-hp-fkind">${esc(label)}</span>` : "";
  const recv = f.recv
    ? `<div class="cl-mv-hp-frecv">${esc(fill(labels.hpOn, { recv: f.recv }))}</div>`
    : "";
  // A caller is paused on the line that made the call; the active frame's line is
  // already lit in the editor, so only callers show it here.
  const paused = !f.active && typeof f.line === "number"
    ? `<div class="cl-mv-hp-fpaused">${esc(fill(labels.hpPaused, { line: f.line }))}</div>`
    : "";
  const rows = (f.vars ?? []).map(rowHtml).join("");
  el.innerHTML =
    `<div class="cl-mv-hp-fname"><span class="cl-mv-hp-fn">${esc(f.name ?? f.id)}</span>${badge}</div>` +
    recv +
    paused +
    `<div class="cl-mv-hp-rows">${rows}</div>`;
  return el;
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

function objNode(o: HeapObject, existing?: HTMLElement): HTMLElement {
  const el = existing ?? document.createElement("div");
  el.className = "cl-mv-hp-card" + (o.dim ? " is-dim" : "");
  el.setAttribute("data-obj", o.id);
  const no = typeof o.no === "number" ? ` <span class="cl-mv-hp-no">#${o.no}</span>` : "";
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
  el.innerHTML =
    `<div class="cl-mv-hp-type">${esc(o.type)}${no}</div>` + fields;
  return el;
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}
