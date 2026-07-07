// MemoryDieView: the opened RAM die only - a configurable subset of the four
// memory areas (Code / Global / Stack / Heap) and the reference arrows between
// stack slots and heap objects. It renders a resolved model; it owns no board
// pieces and no controls. Which regions appear is a scene decision passed in.

import type { Frame, GlobalSlot, HeapObject, Ref, RegionName, ResolvedModel, Slot } from "../core/memory-model.js";
import type { Panel, SyncCtx } from "./panel.js";
import { markedLineHtml, spansForLine } from "../core/code-marks.js";
import { reconcile } from "./reconcile.js";
import { svgEl } from "./svg.js";

export interface DieLabels {
  chipName: string;
  chipAddr: string;
}

interface RegionDef {
  cls: string;
  weight: number;
  friendly: string;
  tag: string;
  body: string;
  regionAttr?: string;
}

const REGIONS: Record<RegionName, RegionDef> = {
  code: {
    cls: "cl-mv-code",
    weight: 0.8,
    friendly: "code",
    tag: `CODE / TEXT <span>· read-only</span>`,
    body: `<ol data-codelist></ol>`,
    regionAttr: "data-codepanel",
  },
  rodata: {
    cls: "cl-mv-rodata",
    weight: 0.66,
    friendly: "rodata",
    tag: `RODATA <span>· constants</span>`,
    body: `<div class="cl-mv-glob" data-slots="rodata"></div>`,
  },
  data: {
    cls: "cl-mv-data",
    weight: 0.7,
    friendly: "data",
    tag: `DATA <span>· set globals</span>`,
    body: `<div class="cl-mv-glob" data-slots="data"></div>`,
  },
  bss: {
    cls: "cl-mv-bss",
    weight: 0.7,
    friendly: "BSS",
    tag: `BSS <span>· zeroed globals</span>`,
    body: `<div class="cl-mv-glob" data-slots="bss"></div>`,
  },
  global: {
    cls: "cl-mv-global",
    weight: 0.72,
    friendly: "globals",
    tag: `GLOBAL <span>· whole-run values</span>`,
    body: `<div class="cl-mv-glob" data-slots="global"></div>`,
  },
  heap: {
    cls: "cl-mv-heap",
    weight: 1.05,
    friendly: "heap",
    tag: `HEAP <span>· long-lived · grows up ↑</span>`,
    body: `<div class="cl-mv-objs" data-heap></div>`,
  },
  stack: {
    cls: "cl-mv-stack",
    weight: 1,
    friendly: "stack",
    tag: `STACK <span>· per call · grows down ↓</span>`,
    body: `<div class="cl-mv-frames" data-stack></div>`,
  },
  mmap: {
    cls: "cl-mv-mmap",
    weight: 0.72,
    friendly: "mapped",
    tag: `MAPPED <span>· shared libraries</span>`,
    body: `<div class="cl-mv-glob" data-slots="mmap"></div>`,
  },
};

/** Regions that render a simple list of key/value slots, and the model field each reads. */
const SLOT_LIST_REGIONS: Array<[RegionName, "globals" | "rodata" | "data" | "bss" | "mmap"]> = [
  ["global", "globals"],
  ["rodata", "rodata"],
  ["data", "data"],
  ["bss", "bss"],
  ["mmap", "mmap"],
];

function friendlyList(regions: RegionName[]): string {
  const names = regions.map((r) => REGIONS[r].friendly);
  if (names.length <= 1) return names[0] ?? "";
  return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}

export class MemoryDieView implements Panel {
  readonly el: HTMLElement;
  private readonly arrows: SVGSVGElement;
  private readonly codeList: HTMLElement | null;

  constructor(
    private readonly uid: number,
    private readonly code: string[],
    labels: DieLabels,
    private readonly regions: RegionName[],
    showZoomTab: boolean,
    tagOverrides: Partial<Record<RegionName, string>> = {},
  ) {
    const regionHtml = regions
      .map((name) => {
        const d = REGIONS[name];
        const tag = tagOverrides[name] ?? d.tag;
        return `<div class="cl-mv-region ${d.cls}" data-region="${name}"${d.regionAttr ? " " + d.regionAttr : ""}><span class="cl-mv-tag">${tag}</span>${d.body}</div>`;
      })
      .join("");
    const cols = regions.map((name) => `${REGIONS[name].weight}fr`).join(" ");

    this.el = document.createElement("div");
    this.el.innerHTML = `
      ${showZoomTab ? `<div class="cl-mv-zoom-tab">▼ zoom into the <b>${labels.chipName}</b> chip - one address space, opened up. ${friendlyList(regions)} are all areas of <b>this same chip</b>.</div>` : ""}
      <div class="cl-mv-chip">
        <div class="cl-mv-chip-head"><span class="cl-mv-chip-name">${labels.chipName}</span><span class="cl-mv-chip-addr">${labels.chipAddr}</span></div>
        <div class="cl-mv-pins"></div>
        <div class="cl-mv-die" style="grid-template-columns: ${cols};">
          ${regionHtml}
          <svg class="cl-mv-arrows"><defs>
            <marker id="clmv-ah-${uid}" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
              <path d="M0,0 L9,4.5 L0,9 z" fill="#2fa98d" stroke="none" /></marker>
          </defs></svg>
        </div>
        <div class="cl-mv-pins"></div>
      </div>`;

    this.arrows = this.el.querySelector(".cl-mv-arrows") as SVGSVGElement;
    this.codeList = this.el.querySelector("[data-codelist]");
    if (this.codeList) {
      code.forEach((line) => {
        const li = document.createElement("li");
        li.textContent = line;
        this.codeList!.appendChild(li);
      });
    }
  }

  private has(region: RegionName): boolean {
    return this.regions.includes(region);
  }

  sync(ctx: SyncCtx): void {
    this.render(ctx.model);
  }

  onResize(model: ResolvedModel): void {
    this.redrawArrows(model.refs);
  }

  render(model: ResolvedModel): void {
    if (this.codeList) {
      const lines = model.code ?? this.code;
      const pc = model.pc ?? -1;
      (this.el.querySelector("[data-codepanel]") as HTMLElement).classList.toggle("dimmed", !model.codeLive);
      if (this.codeList.children.length !== lines.length) {
        this.codeList.innerHTML = "";
        for (let i = 0; i < lines.length; i++) this.codeList.appendChild(document.createElement("li"));
      }
      Array.from(this.codeList.children).forEach((li, i) => {
        const line = lines[i] ?? "";
        li.innerHTML = markedLineHtml(line, spansForLine(i, line, model.codeMark, pc));
        li.classList.toggle("pc", i === pc);
      });
    }
    for (const [name, field] of SLOT_LIST_REGIONS) {
      if (!this.has(name)) continue;
      reconcile(
        this.el.querySelector(`[data-slots="${name}"]`) as HTMLElement,
        model[field] ?? [],
        this.globalNode,
      );
    }
    if (this.has("stack")) {
      reconcile(this.el.querySelector("[data-stack]") as HTMLElement, model.stack ?? [], this.frameNode);
    }
    this.setRegionHighlight(model.highlight);
    if (this.has("heap")) {
      reconcile(
        this.el.querySelector("[data-heap]") as HTMLElement,
        model.heap.map((o) => ({ ...o })),
        this.objNode,
      );
    }

    requestAnimationFrame(() => {
      model.heap.forEach((o) => {
        const el = this.el.querySelector(`[data-obj="${o.id}"]`);
        if (el) el.classList.toggle("glow", model.glow === o.id);
      });
      this.drawArrows(model.refs);
    });
  }

  redrawArrows(refs: Ref[]): void {
    this.drawArrows(refs);
  }

  /** Spotlight the memory region(s) named in a step's `highlight`. Board parts
   *  in the same list are ignored here (the board view handles those). */
  private setRegionHighlight(targets?: string | string[]): void {
    const wanted = new Set(targets == null ? [] : Array.isArray(targets) ? targets : [targets]);
    const anyRegion = this.regions.some((r) => wanted.has(r));
    this.el.querySelectorAll<HTMLElement>("[data-region]").forEach((node) => {
      const on = wanted.has(node.getAttribute("data-region") ?? "");
      node.classList.toggle("hl", on);
      node.classList.toggle("dim", anyRegion && !on);
    });
  }

  private frameNode = (f: Frame, existing?: HTMLElement): HTMLElement => {
    const el = existing ?? document.createElement("div");
    el.className = "cl-mv-frame" + (f.accent ? " is-accent" : "");
    if (f.accent) el.style.setProperty("--frame-accent", f.accent);
    else el.style.removeProperty("--frame-accent");
    el.innerHTML =
      (f.name ? `<div class="cl-mv-fname">${f.name}</div>` : "") +
      (f.vars ?? [])
        .map((v: Slot) =>
          `<div class="cl-mv-slot${v.empty ? " is-empty" : ""}${v.hot ? " is-hot" : ""}">` +
          (v.addr ? `<span class="cl-mv-addr">${v.addr}</span>` : "") +
          (v.k ? `<span class="cl-mv-k">${v.k}</span>` : "") +
          (v.ref
            ? `<span class="cl-mv-v">→</span><span class="cl-mv-refdot" data-dot="${v.id}"></span>`
            : `<span class="cl-mv-v">${v.empty ? "(free)" : v.v ?? ""}</span>`) +
          `</div>`,
        )
        .join("");
    return el;
  };

  private globalNode = (g: GlobalSlot, existing?: HTMLElement): HTMLElement => {
    const el = existing ?? document.createElement("div");
    el.className = "cl-mv-slot";
    el.innerHTML = `<span class="cl-mv-k">${g.k}</span><span class="cl-mv-v">${g.v}</span>`;
    return el;
  };

  private objNode = (o: HeapObject, existing?: HTMLElement): HTMLElement => {
    const el = existing ?? document.createElement("div");
    el.className = "cl-mv-obj" + (o.dim ? " is-dim" : "");
    el.setAttribute("data-obj", o.id);
    el.innerHTML =
      `<div class="cl-mv-oname">${o.type} <span style="color:#94a3b8">@${o.at ?? "heap"}</span></div>` +
      (o.fields ?? [])
        .map((field) => {
          const hot = (o.hotFields ?? []).includes(field[0]);
          return `<div class="cl-mv-field${hot ? " is-hot" : ""}">${field[0]} = ${field[1]}</div>`;
        })
        .join("");
    return el;
  };

  private drawArrows(refs: Ref[]): void {
    this.arrows.querySelectorAll("path.cl-mv-ref").forEach((p) => p.remove());
    if (!this.has("stack") || !this.has("heap")) return;
    const box = this.arrows.getBoundingClientRect();
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
      const dx = Math.max(40, (x2 - x1) * 0.5);
      const path = svgEl("path", {
        class: "cl-mv-ref",
        d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
        "marker-end": `url(#clmv-ah-${this.uid})`,
      });
      this.arrows.appendChild(path);
      requestAnimationFrame(() => path.classList.add("show"));
    });
  }
}
