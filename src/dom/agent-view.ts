// AgentView: the AI-track scene - the text so far as a strip of tokens, the model
// core that reads it, and the probability of the next token. It renders the
// `agent` field of the current step and knows nothing about the model, the memory
// panels, or the controls. Colours and structure reuse the course's own look
// (dark-green board chips, a light data panel, amber for the just-chosen token).

import type { AgentCore, AgentScene, AgentToken, AgentTool } from "../core/agent-model.js";
import { agentFanRows } from "../core/agent-model.js";
import { escapeHtml } from "../core/narration.js";
import type { Panel, SyncCtx } from "./panel.js";
import type { VizLabels } from "../core/memory-model.js";
import { DEFAULT_VIZ_LABELS } from "../core/memory-model.js";

export class AgentView implements Panel {
  readonly el: HTMLElement;
  private readonly showFan: boolean;
  private readonly fanCaption: string;

  constructor(showFan = true, labels: VizLabels = DEFAULT_VIZ_LABELS) {
    this.showFan = showFan;
    this.fanCaption = labels.fanCaption;
    this.el = document.createElement("div");
    this.el.className = "cl-ag";
    this.el.innerHTML = `
      <div class="cl-ag-strip">
        <span class="cl-ag-cap" data-stripcap></span>
        <div class="cl-ag-tokens" data-tokens></div>
      </div>
      <div class="cl-ag-core-row">
        <span class="cl-ag-wire"></span>
        <div class="cl-ag-core" data-core>
          <div class="cl-ag-core-name" data-corename>LLM</div>
          <div class="cl-ag-core-sub" data-coresub>next-token model</div>
          <div class="cl-ag-core-dots" aria-hidden="true">
            <span></span><span></span><span></span><span></span><span></span>
          </div>
        </div>
        <span class="cl-ag-wire" data-rwire></span>
        <div class="cl-ag-tool" data-tool hidden>
          <div class="cl-ag-tool-name" data-toolname></div>
          <div class="cl-ag-tool-io" data-toolcall></div>
          <div class="cl-ag-tool-io" data-toolresult></div>
        </div>
      </div>
      ${showFan ? `<div class="cl-ag-fan is-empty" data-fan></div>` : ""}`;
  }

  sync(ctx: SyncCtx): void {
    const scene = ctx.model.agent ?? {};
    this.renderStrip(scene);
    this.renderCore(scene.core);
    this.renderTool(scene.tool);
    if (this.showFan) this.renderFan(scene);
  }

  private renderStrip(scene: AgentScene): void {
    const cap = this.el.querySelector("[data-stripcap]") as HTMLElement;
    cap.textContent = scene.stripCaption ?? "Text so far \u2014 everything the model reads";

    const host = this.el.querySelector("[data-tokens]") as HTMLElement;
    host.innerHTML = "";
    const tokens = scene.tokens ?? [];
    let prevDropped = false;
    tokens.forEach((tok: AgentToken, i: number) => {
      const dropped = tok.kind === "dropped";
      // Mark the edge of the context window: where dropped tokens give way to
      // the tokens the model can still see.
      if (prevDropped && !dropped) host.appendChild(this.windowDivider(scene.windowLabel));
      const span = document.createElement("span");
      span.className = "cl-ag-tok is-" + (tok.kind ?? "given") + (tok.hot ? " is-hot" : "");
      span.textContent = tok.t;
      host.appendChild(span);
      prevDropped = dropped;
      void i;
    });
    if (scene.caret) {
      const caret = document.createElement("span");
      caret.className = "cl-ag-caret";
      host.appendChild(caret);
    }
  }

  private windowDivider(label?: string): HTMLElement {
    const div = document.createElement("span");
    div.className = "cl-ag-winmark";
    div.innerHTML = `<span class="cl-ag-winmark-line"></span><span class="cl-ag-winmark-label"></span>`;
    (div.querySelector(".cl-ag-winmark-label") as HTMLElement).textContent = label ?? "context window";
    return div;
  }

  private renderCore(core?: AgentCore): void {
    (this.el.querySelector("[data-corename]") as HTMLElement).textContent = core?.label ?? "LLM";
    (this.el.querySelector("[data-coresub]") as HTMLElement).textContent = core?.sub ?? "next-token model";
    (this.el.querySelector("[data-core]") as HTMLElement).classList.toggle("is-live", Boolean(core?.live));
  }

  private renderTool(tool?: AgentTool | null): void {
    const card = this.el.querySelector("[data-tool]") as HTMLElement;
    const rwire = this.el.querySelector("[data-rwire]") as HTMLElement;
    if (!tool) {
      card.hidden = true;
      rwire.className = "cl-ag-wire";
      return;
    }
    card.hidden = false;
    const state = tool.state ?? "idle";
    // The wire between the model and the tool lights up while a call is on its way.
    rwire.className = "cl-ag-wire" + (state === "calling" ? " is-hot" : "");
    card.className = "cl-ag-tool is-" + state;
    (this.el.querySelector("[data-toolname]") as HTMLElement).textContent = tool.name;

    const callEl = this.el.querySelector("[data-toolcall]") as HTMLElement;
    if (tool.call) {
      callEl.hidden = false;
      callEl.className = "cl-ag-tool-io cl-ag-tool-call";
      callEl.innerHTML =
        `<span class="cl-ag-tool-dir">call \u2192</span>` +
        `<code class="cl-ag-tool-chip">${escapeHtml(tool.call)}</code>`;
    } else {
      callEl.hidden = true;
    }

    const resEl = this.el.querySelector("[data-toolresult]") as HTMLElement;
    if (tool.result && state === "returned") {
      resEl.hidden = false;
      resEl.className = "cl-ag-tool-io cl-ag-tool-result";
      resEl.innerHTML =
        `<span class="cl-ag-tool-dir">\u2190 result</span>` +
        `<code class="cl-ag-tool-chip">${escapeHtml(tool.result)}</code>`;
    } else {
      resEl.hidden = true;
    }
  }

  private renderFan(scene: AgentScene): void {
    const host = this.el.querySelector("[data-fan]") as HTMLElement;
    const rows = agentFanRows(scene.fan);
    const caption = scene.fan?.caption ?? this.fanCaption;
    if (rows.length === 0) {
      host.className = "cl-ag-fan is-empty";
      host.innerHTML = `<span class="cl-ag-cap">${escapeHtml(caption)}</span>`;
      return;
    }
    host.className = "cl-ag-fan";
    let html = `<span class="cl-ag-cap">${escapeHtml(caption)}</span>`;
    for (const row of rows) {
      const cls = "cl-ag-row" + (row.chosen ? " is-chosen" : "") + (row.dim ? " is-dim" : "");
      html +=
        `<div class="${cls}">` +
        `<span class="cl-ag-tok-name">${escapeHtml(row.t)}</span>` +
        `<span class="cl-ag-track"><span class="cl-ag-fill" style="width:${row.pct}%"></span></span>` +
        `<span class="cl-ag-val">${row.pct}%</span>` +
        `</div>`;
    }
    host.innerHTML = html;
  }
}
