// CodePanel: a standalone code listing with a moving program-counter highlight,
// for scenes that want the code beside the board without the full RAM die.

import type { Panel, SyncCtx } from "./panel.js";
import { markedLineHtml, spansForLine } from "../core/code-marks.js";

export class CodePanel implements Panel {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly code: string[];

  constructor(code: string[]) {
    this.code = code;
    this.el = document.createElement("div");
    this.el.className = "cl-mv-region cl-mv-code cl-mv-codepanel";
    this.el.innerHTML = `<span class="cl-mv-tag">CODE <span>· the program</span></span><ol data-codelist></ol>`;
    this.list = this.el.querySelector("[data-codelist]") as HTMLElement;
    code.forEach((line) => {
      const li = document.createElement("li");
      li.textContent = line;
      this.list.appendChild(li);
    });
  }

  sync(ctx: SyncCtx): void {
    const lines = ctx.model.code ?? this.code;
    const pc = ctx.model.pc ?? -1;
    this.el.classList.toggle("dimmed", !ctx.model.codeLive);
    if (this.list.children.length !== lines.length) {
      this.list.innerHTML = "";
      for (let i = 0; i < lines.length; i++) this.list.appendChild(document.createElement("li"));
    }
    Array.from(this.list.children).forEach((li, i) => {
      const line = lines[i] ?? "";
      li.innerHTML = markedLineHtml(line, spansForLine(i, line, ctx.model.codeMark, pc));
      li.classList.toggle("pc", i === pc);
    });
  }
}
