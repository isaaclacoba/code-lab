// RetrievalView: the AI-track scene that shows retrieval-augmented generation - an
// agent grounding its answer in outside knowledge. A query chip sits above a list
// of document chunks; once the query is embedded, each chunk shows a similarity
// bar, and the closest ones (state "match") light up as the chunks pulled into
// the context. A grounded-answer box appears once they are in. It renders the
// `retrieval` field of the current step and knows nothing about the model, the
// other panels, or the controls.

import type { RetrievalScene } from "../core/retrieval-model.js";
import { resolveRetrieval } from "../core/retrieval-model.js";
import { escapeHtml } from "../core/narration.js";
import type { Panel, SyncCtx } from "./panel.js";

export class RetrievalView implements Panel {
  readonly el: HTMLElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "cl-rg";
    this.el.innerHTML = `
      <span class="cl-rg-cap" data-cap></span>
      <div class="cl-rg-query" data-query hidden></div>
      <div class="cl-rg-docs" data-docs></div>
      <div class="cl-rg-answer" data-answer hidden></div>`;
  }

  sync(ctx: SyncCtx): void {
    const scene = ctx.model.retrieval ?? {};
    (this.el.querySelector("[data-cap]") as HTMLElement).textContent =
      scene.caption ?? "The knowledge store";
    this.renderQuery(scene);
    this.renderDocs(scene);
    this.renderAnswer(scene);
  }

  private renderQuery(scene: RetrievalScene): void {
    const host = this.el.querySelector("[data-query]") as HTMLElement;
    if (!scene.query) {
      host.hidden = true;
      host.innerHTML = "";
      return;
    }
    host.hidden = false;
    host.innerHTML =
      `<span class="cl-rg-tag">${escapeHtml(scene.queryLabel ?? "query")}</span>` +
      `<code class="cl-rg-qtext">${escapeHtml(scene.query)}</code>`;
  }

  private renderDocs(scene: RetrievalScene): void {
    const host = this.el.querySelector("[data-docs]") as HTMLElement;
    host.innerHTML = resolveRetrieval(scene)
      .map((doc) => {
        const bar =
          doc.scorePct === null
            ? ""
            : `<div class="cl-rg-bar"><span class="cl-rg-fill" style="width:${doc.scorePct}%"></span></div>` +
              `<span class="cl-rg-score">${doc.scorePct}%</span>`;
        return (
          `<div class="cl-rg-doc is-${doc.state}">` +
          `<div class="cl-rg-doc-text">${escapeHtml(doc.text)}</div>` +
          `<div class="cl-rg-doc-meter">${bar}</div>` +
          `</div>`
        );
      })
      .join("");
  }

  private renderAnswer(scene: RetrievalScene): void {
    const host = this.el.querySelector("[data-answer]") as HTMLElement;
    if (!scene.answer) {
      host.hidden = true;
      host.innerHTML = "";
      return;
    }
    host.hidden = false;
    host.innerHTML =
      `<span class="cl-rg-tag">${escapeHtml(scene.answerLabel ?? "grounded answer")}</span>` +
      `<div class="cl-rg-atext">${escapeHtml(scene.answer)}</div>`;
  }
}
