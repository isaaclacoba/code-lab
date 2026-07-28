// TranscriptView: the AI-track scene that shows what an agent run really is - the
// growing list of role-tagged messages the model re-reads on every call. Each
// message shows its role (system/developer/user/assistant/tool) and, crucially,
// WHO wrote it (you, your app, the model, or your code) - which is how the tools
// lesson can show that a tool result is written by your code, not the model. An
// optional banner + arrow marks an API round-trip. It renders the `transcript`
// field of the current step and knows nothing about the model or other panels.

import type { MsgRole, MsgAuthor, TranscriptScene } from "../core/transcript-model.js";
import { resolveTranscript } from "../core/transcript-model.js";
import { escapeHtml } from "../core/narration.js";
import type { Panel, SyncCtx } from "./panel.js";

/** How each role badge reads. Pure presentation, so the model stays markup-free. */
const ROLE_META: Record<MsgRole, string> = {
  system: "system",
  developer: "developer",
  user: "user",
  assistant: "assistant",
  tool: "tool",
};

/** How each author tag reads - the honest "who wrote this line". */
const AUTHOR_META: Record<MsgAuthor, string> = {
  you: "you wrote this",
  app: "your app wrote this",
  model: "the model wrote this",
  code: "your code wrote this",
};

export class TranscriptView implements Panel {
  readonly el: HTMLElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "cl-tx";
    this.el.innerHTML = `
      <span class="cl-tx-cap" data-cap></span>
      <div class="cl-tx-banner" data-banner hidden></div>
      <div class="cl-tx-list" data-list></div>`;
  }

  sync(ctx: SyncCtx): void {
    const scene = ctx.model.transcript ?? {};
    (this.el.querySelector("[data-cap]") as HTMLElement).textContent =
      scene.caption ?? "The conversation so far";
    this.renderBanner(scene);
    this.renderList(scene);
  }

  private renderBanner(scene: TranscriptScene): void {
    const banner = this.el.querySelector("[data-banner]") as HTMLElement;
    if (!scene.banner) {
      banner.hidden = true;
      banner.textContent = "";
      banner.className = "cl-tx-banner";
      return;
    }
    banner.hidden = false;
    banner.className = "cl-tx-banner" + (scene.flow ? " is-" + scene.flow : "");
    const arrow = scene.flow === "send" ? "\u2193" : scene.flow === "receive" ? "\u2191" : "";
    banner.innerHTML =
      (arrow ? `<span class="cl-tx-arrow">${arrow}</span>` : "") +
      `<span class="cl-tx-banner-t">${escapeHtml(scene.banner)}</span>`;
  }

  private renderList(scene: TranscriptScene): void {
    const host = this.el.querySelector("[data-list]") as HTMLElement;
    host.innerHTML = resolveTranscript(scene)
      .map((m) => {
        const note = m.note
          ? `<div class="cl-tx-note">${escapeHtml(m.note)}</div>`
          : "";
        return (
          `<div class="cl-tx-msg is-${m.role} by-${m.author}${m.hot ? " is-hot" : ""}">` +
          `<div class="cl-tx-head">` +
          `<span class="cl-tx-role">${ROLE_META[m.role]}</span>` +
          `<span class="cl-tx-by">${AUTHOR_META[m.author]}</span>` +
          `</div>` +
          `<div class="cl-tx-text">${escapeHtml(m.text)}</div>` +
          note +
          `</div>`
        );
      })
      .join("");
  }
}
