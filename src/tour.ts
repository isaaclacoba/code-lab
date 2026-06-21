import type { Highlighter, TourStep } from "./types.js";
import { defaultHighlighter } from "./highlighter.js";
import { computeLineFlags, normalizeLines, splitCodeLines } from "./core/lines.js";
import {
  atFirst,
  atLast,
  counterLabel,
  goTo,
  makeTour,
} from "./core/tour-state.js";

interface TourState {
  steps: TourStep[];
  index: number;
  lineEls: HTMLElement[];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Render plain narration, turning `backtick` spans into inline <code> so a
 *  programming term reads as code. Text without backticks is unchanged. */
function renderInline(text: string): string {
  return text
    .split(/(`[^`]+`)/)
    .map((seg) =>
      seg.length > 1 && seg.startsWith("`") && seg.endsWith("`")
        ? `<code class="cl-inline-code">${escapeHtml(seg.slice(1, -1))}</code>`
        : escapeHtml(seg)
    )
    .join("");
}

export interface TourConfig {
  highlighter?: Highlighter;
  language?: string;
}

/** A focused, line-by-line code walkthrough modal. Renders code as per-line
 *  elements so highlighting is a class toggle and scrolling stays contained -
 *  no page-scroll fighting, no clip-path hole to misalign. Instance-based so
 *  multiple labs on one page do not collide. */
export class Tour {
  private highlighter: Highlighter;
  private language: string;
  private titleId = `cl-tour-title-${Math.random().toString(36).slice(2)}`;

  private overlay?: HTMLDivElement;
  private modal?: HTMLDivElement;
  private titleEl?: HTMLHeadingElement;
  private codePane?: HTMLDivElement;
  private narration?: HTMLParagraphElement;
  private counter?: HTMLSpanElement;
  private dots?: HTMLDivElement;
  private prevBtn?: HTMLButtonElement;
  private nextBtn?: HTMLButtonElement;

  private state: TourState | null = null;
  private lastFocused: Element | null = null;
  private onKey = (e: KeyboardEvent) => this.handleKey(e);

  constructor(config: TourConfig = {}) {
    this.highlighter = config.highlighter ?? defaultHighlighter();
    this.language = config.language ?? "csharp";
  }

  open(opts: { title?: string; code: string; steps: TourStep[] }): void {
    this.buildDom();
    this.lastFocused = document.activeElement;
    const safeSteps =
      Array.isArray(opts.steps) && opts.steps.length
        ? opts.steps
        : [{ text: "", lines: [] }];
    this.state = { steps: safeSteps, index: 0, lineEls: [] };
    this.titleEl!.textContent = opts.title || "Walk me through the code";
    this.renderCode(opts.code || "");
    this.codePane!.scrollTop = 0;
    this.applyStep();
    this.overlay!.hidden = false;
    this.modal!.hidden = false;
    document.addEventListener("keydown", this.onKey);
    const focusables = this.focusableEls();
    if (focusables.length) focusables[focusables.length - 1].focus();
  }

  close(): void {
    if (!this.overlay) return;
    this.overlay.hidden = true;
    this.modal!.hidden = true;
    document.removeEventListener("keydown", this.onKey);
    if (this.lastFocused instanceof HTMLElement) this.lastFocused.focus();
    this.lastFocused = null;
  }

  destroy(): void {
    document.removeEventListener("keydown", this.onKey);
    this.overlay?.remove();
    this.modal?.remove();
    this.overlay = undefined;
    this.modal = undefined;
  }

  private normalizeLines(lines: number | number[] | undefined): number[] {
    return normalizeLines(lines);
  }

  private buildDom(): void {
    if (this.overlay) return;

    this.overlay = document.createElement("div");
    this.overlay.className = "cl-tour-overlay";
    this.overlay.hidden = true;
    this.overlay.addEventListener("click", () => this.close());

    this.modal = document.createElement("div");
    this.modal.className = "cl-tour-modal";
    this.modal.hidden = true;
    this.modal.setAttribute("role", "dialog");
    this.modal.setAttribute("aria-modal", "true");
    this.modal.setAttribute("aria-labelledby", this.titleId);
    this.modal.addEventListener("click", (e) => e.stopPropagation());

    const header = document.createElement("div");
    header.className = "cl-tour-header";
    this.titleEl = document.createElement("h4");
    this.titleEl.className = "cl-tour-title";
    this.titleEl.id = this.titleId;
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "cl-btn cl-tour-close";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", () => this.close());
    header.append(this.titleEl, closeBtn);

    this.codePane = document.createElement("div");
    this.codePane.className = "cl-tour-code-pane";

    this.narration = document.createElement("p");
    this.narration.className = "cl-tour-narration";

    const footer = document.createElement("div");
    footer.className = "cl-tour-footer";
    this.prevBtn = document.createElement("button");
    this.prevBtn.type = "button";
    this.prevBtn.className = "cl-btn";
    this.prevBtn.textContent = "Previous";
    this.prevBtn.addEventListener("click", () => this.go(this.state!.index - 1));
    this.dots = document.createElement("div");
    this.dots.className = "cl-tour-dots";
    this.counter = document.createElement("span");
    this.counter.className = "cl-tour-counter";
    this.nextBtn = document.createElement("button");
    this.nextBtn.type = "button";
    this.nextBtn.className = "cl-btn cl-primary";
    this.nextBtn.textContent = "Next";
    this.nextBtn.addEventListener("click", () => this.go(this.state!.index + 1));
    footer.append(this.prevBtn, this.dots, this.counter, this.nextBtn);

    this.modal.append(header, this.codePane, this.narration, footer);
    document.body.append(this.overlay, this.modal);
  }

  private renderCode(code: string): void {
    const lines = splitCodeLines(code);
    this.codePane!.innerHTML = "";
    this.state!.lineEls = lines.map((text, i) => {
      const row = document.createElement("div");
      row.className = "cl-tour-line";

      const num = document.createElement("span");
      num.className = "cl-tour-ln";
      num.textContent = String(i + 1);

      const codeEl = document.createElement("code");
      codeEl.className = `cl-tour-code language-${this.language}`;
      codeEl.innerHTML = text.length
        ? this.highlighter.highlight(text, this.language)
        : "&nbsp;";

      row.append(num, codeEl);
      this.codePane!.appendChild(row);
      return row;
    });
  }

  private renderDots(): void {
    this.dots!.innerHTML = "";
    this.state!.steps.forEach((_, i) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "cl-tour-dot" + (i === this.state!.index ? " is-active" : "");
      dot.setAttribute("aria-label", `Step ${i + 1}`);
      dot.addEventListener("click", () => this.go(i));
      this.dots!.appendChild(dot);
    });
  }

  private scrollWithin(el: HTMLElement): void {
    const c = this.codePane!.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    if (e.top < c.top) {
      this.codePane!.scrollBy({ top: e.top - c.top - 14, behavior: "smooth" });
    } else if (e.bottom > c.bottom) {
      this.codePane!.scrollBy({ top: e.bottom - c.bottom + 14, behavior: "smooth" });
    }
  }

  private pulseNarration(): void {
    this.narration!.classList.remove("is-changing");
    // force reflow so the animation restarts on every step change
    void this.narration!.offsetWidth;
    this.narration!.classList.add("is-changing");
  }

  private applyStep(): void {
    const step = this.state!.steps[this.state!.index];
    const active = this.normalizeLines(step.lines);
    const flags = computeLineFlags(active, this.state!.lineEls.length);

    this.state!.lineEls.forEach((el, i) => {
      el.classList.toggle("is-active", flags[i].active);
      el.classList.toggle("is-dim", flags[i].dim);
    });

    const model = makeTour(this.state!.steps.length, this.state!.index);
    this.narration!.innerHTML = renderInline(step.text || "");
    this.pulseNarration();
    this.counter!.textContent = counterLabel(model);
    this.prevBtn!.disabled = atFirst(model);
    this.nextBtn!.disabled = atLast(model);
    this.renderDots();

    if (active.length) this.scrollWithin(this.state!.lineEls[active[0] - 1]);
  }

  private go(index: number): void {
    if (!this.state) return;
    const current = makeTour(this.state.steps.length, this.state.index);
    const target = goTo(current, index);
    if (target === current) return;
    this.state.index = target.index;
    this.applyStep();
  }

  private focusableEls(): HTMLElement[] {
    return [
      ...this.modal!.querySelectorAll<HTMLElement>("button:not([disabled])"),
    ];
  }

  private trapTab(e: KeyboardEvent): void {
    const els = this.focusableEls();
    if (!els.length) return;
    const first = els[0];
    const last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  private handleKey(e: KeyboardEvent): void {
    if (e.key === "Escape") this.close();
    else if (e.key === "Tab") this.trapTab(e);
    else if (e.key === "ArrowRight") this.go(this.state!.index + 1);
    else if (e.key === "ArrowLeft") this.go(this.state!.index - 1);
  }
}
