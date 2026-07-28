// MemoryShelfView: the AI-track scene that splits an agent's memory into kinds.
// A working-memory strip on top (the context read right now) sits above three
// long-term stores - episodic, semantic and procedural - drawn from
// DEFAULT_MEMORY_STORES so the taxonomy lives in one place. It renders the
// `memoryShelf` field of the current step and knows nothing about the model, the
// other panels, or the controls.

import type { MemoryShelfScene, ShelfItem } from "../core/memory-shelf-model.js";
import { shelfStores } from "../core/memory-shelf-model.js";
import { escapeHtml } from "../core/narration.js";
import type { Panel, SyncCtx } from "./panel.js";

export class MemoryShelfView implements Panel {
  readonly el: HTMLElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "cl-ms";
    this.el.innerHTML = `
      <div class="cl-ms-working" data-working>
        <span class="cl-ms-cap" data-workingcap></span>
        <div class="cl-ms-strip" data-workingitems></div>
      </div>
      <div class="cl-ms-wire" aria-hidden="true"></div>
      <div class="cl-ms-stores" data-stores></div>`;
  }

  sync(ctx: SyncCtx): void {
    const scene = ctx.model.memoryShelf ?? {};
    this.renderWorking(scene);
    this.renderStores(scene);
  }

  private chip(item: ShelfItem): string {
    return `<span class="cl-ms-item${item.hot ? " is-hot" : ""}">${escapeHtml(item.text)}</span>`;
  }

  private items(list: ShelfItem[]): string {
    return list.length ? list.map((it) => this.chip(it)).join("") : `<span class="cl-ms-empty">empty</span>`;
  }

  private renderWorking(scene: MemoryShelfScene): void {
    (this.el.querySelector("[data-workingcap]") as HTMLElement).textContent =
      scene.workingCaption ?? "Working memory \u2014 the context read right now";
    (this.el.querySelector("[data-working]") as HTMLElement).classList.toggle(
      "is-active",
      Boolean(scene.workingActive),
    );
    (this.el.querySelector("[data-workingitems]") as HTMLElement).innerHTML = this.items(scene.working ?? []);
  }

  private renderStores(scene: MemoryShelfScene): void {
    const host = this.el.querySelector("[data-stores]") as HTMLElement;
    host.innerHTML = shelfStores(scene)
      .map(
        (s) =>
          `<div class="cl-ms-store is-${s.meta.id}${s.active ? " is-active" : ""}">` +
          `<div class="cl-ms-store-head">` +
          `<span class="cl-ms-store-name">${escapeHtml(s.meta.name)}</span>` +
          `<span class="cl-ms-store-blurb">${escapeHtml(s.meta.blurb)}</span>` +
          `</div>` +
          `<div class="cl-ms-store-items">${this.items(s.items)}</div>` +
          `</div>`,
      )
      .join("");
  }
}
