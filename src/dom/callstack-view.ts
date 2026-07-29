// CallStackView: the level-1 execution panel. It shows the current call stack,
// newest frame first, with value-only local rows and no heap arrows or ids.

import type { Panel, SyncCtx } from "./panel.js";
import type { Frame, ResolvedModel, Slot } from "../core/memory-model.js";

export class CallStackView implements Panel {
  readonly el: HTMLElement;
  private readonly frames: HTMLElement;
  private readonly cardsById = new Map<string, HTMLElement>();
  private newFrameIds = new Set<string>();

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "cl-mv-region cl-mv-callstack";
    this.el.innerHTML =
      `<span class="cl-mv-tag">CALL STACK <span>\u00b7 the calls in progress</span></span>` +
      `<div class="cl-mv-cs-frames" data-csframes></div>`;
    this.frames = this.el.querySelector("[data-csframes]") as HTMLElement;
  }

  sync(ctx: SyncCtx): void {
    const frames = [...(ctx.model.stack ?? [])].reverse();
    const liveIds = new Set(frames.map((frame) => frame.id));
    this.newFrameIds = new Set();

    for (const [id, card] of this.cardsById) {
      if (!liveIds.has(id)) {
        card.remove();
        this.cardsById.delete(id);
      }
    }

    frames.forEach((frame, i) => {
      let card = this.cardsById.get(frame.id);
      if (!card) {
        card = cardEl();
        this.cardsById.set(frame.id, card);
        this.newFrameIds.add(frame.id);
      }
      updateCard(card, frame, i === 0);
      this.frames.appendChild(card);
    });
  }

  animate(_model: ResolvedModel): Promise<void> {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      this.newFrameIds = new Set();
      return Promise.resolve();
    }

    const cards = Array.from(this.newFrameIds)
      .map((id) => this.cardsById.get(id))
      .filter((card): card is HTMLElement => Boolean(card));
    this.newFrameIds = new Set();

    cards.forEach((card) => card.classList.add("enter"));
    if (cards.length) {
      const removeEnter = () => cards.forEach((card) => card.classList.remove("enter"));
      if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(removeEnter);
      else window.setTimeout(removeEnter, 60);
    }
    return Promise.resolve();
  }
}

function cardEl(): HTMLElement {
  const card = document.createElement("div");
  card.className = "cl-mv-cs-frame";
  card.innerHTML =
    `<div class="cl-mv-cs-title"></div>` +
    `<div class="cl-mv-cs-locals" data-cslocals></div>`;
  return card;
}

function updateCard(card: HTMLElement, frame: Frame, active: boolean): void {
  card.classList.toggle("is-active", active);
  card.classList.toggle("is-caller", !active);

  const title = card.querySelector(".cl-mv-cs-title") as HTMLElement | null;
  if (title) title.textContent = frame.name ?? frame.id;

  const locals = card.querySelector("[data-cslocals]") as HTMLElement | null;
  if (locals) renderLocals(locals, frame.vars ?? []);
}

// Rebuild only when the local names change; otherwise keep row nodes stable.
function renderLocals(rows: HTMLElement, vars: Slot[]): void {
  const names = vars.map((v) => v.k ?? v.id).join("\u0001");
  if (rows.dataset.names !== names) {
    rows.dataset.names = names;
    rows.innerHTML = vars.map(rowHtml).join("");
    return;
  }
  const children = Array.from(rows.children) as HTMLElement[];
  vars.forEach((v, i) => updateRow(children[i], v));
}

function valueText(v: Slot): string {
  if (v.empty) return "unassigned";
  return v.v ?? "";
}

function rowHtml(v: Slot): string {
  const cls =
    "cl-mv-cs-row" + (v.empty ? " is-empty" : "") + (v.hot ? " is-changed" : "");
  return (
    `<div class="${cls}">` +
    `<span class="cl-mv-cs-name">${esc(v.k ?? v.id)}</span>` +
    `<span class="cl-mv-cs-val">${esc(valueText(v))}</span>` +
    `</div>`
  );
}

function updateRow(row: HTMLElement | undefined, v: Slot): void {
  if (!row) return;
  row.classList.toggle("is-empty", Boolean(v.empty));
  row.classList.toggle("is-changed", Boolean(v.hot));
  const val = row.querySelector(".cl-mv-cs-val") as HTMLElement | null;
  if (val) val.textContent = valueText(v);
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}
