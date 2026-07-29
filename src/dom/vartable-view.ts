// VarTableView: the level-0 execution panel. A flat Name | Value table of the
// active (top) stack frame's locals - no stack/heap split, no arrows, no
// addresses. This is the whole point of level 0: a beginner sees only the boxes
// that have names and the values in them. An unassigned slot reads "unassigned";
// a slot the current step marks `hot` gets a static "changed" highlight (motion
// is deferred to a later phase, so this doubles as the reduced-motion path).

import type { Panel, SyncCtx } from "./panel.js";
import type { Frame, Slot } from "../core/memory-model.js";

export class VarTableView implements Panel {
  readonly el: HTMLElement;
  private readonly rows: HTMLElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "cl-mv-region cl-mv-vartable";
    this.el.innerHTML =
      `<span class="cl-mv-tag">VARIABLES <span>\u00b7 what each name holds now</span></span>` +
      `<div class="cl-mv-vt-rows" data-vtrows></div>`;
    this.rows = this.el.querySelector("[data-vtrows]") as HTMLElement;
  }

  sync(ctx: SyncCtx): void {
    this.render(activeFrame(ctx.model.stack)?.vars ?? []);
  }

  // Rebuild only when the set of names changes; otherwise update rows in place so
  // a later phase can animate the changed value without re-creating the node.
  private render(vars: Slot[]): void {
    const names = vars.map((v) => v.k ?? v.id).join("\u0001");
    if (this.rows.dataset.names !== names) {
      this.rows.dataset.names = names;
      this.rows.innerHTML = vars.length
        ? vars.map(rowHtml).join("")
        : `<div class="cl-mv-vt-empty">no variables yet</div>`;
      return;
    }
    const children = Array.from(this.rows.children) as HTMLElement[];
    vars.forEach((v, i) => updateRow(children[i], v));
  }
}

/** The active frame is the newest call - the top of the stack. */
function activeFrame(stack: Frame[] | undefined): Frame | undefined {
  const frames = stack ?? [];
  return frames[frames.length - 1];
}

function valueText(v: Slot): string {
  if (v.empty) return "unassigned";
  if (v.ref) return "\u2192 " + v.ref;
  return v.v ?? "";
}

function rowHtml(v: Slot): string {
  const cls =
    "cl-mv-vt-row" + (v.empty ? " is-empty" : "") + (v.hot ? " is-changed" : "");
  return (
    `<div class="${cls}">` +
    `<span class="cl-mv-vt-name">${esc(v.k ?? v.id)}</span>` +
    `<span class="cl-mv-vt-val">${esc(valueText(v))}</span>` +
    `</div>`
  );
}

function updateRow(row: HTMLElement | undefined, v: Slot): void {
  if (!row) return;
  row.classList.toggle("is-empty", Boolean(v.empty));
  row.classList.toggle("is-changed", Boolean(v.hot));
  const val = row.querySelector(".cl-mv-vt-val") as HTMLElement | null;
  if (val) val.textContent = valueText(v);
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}
