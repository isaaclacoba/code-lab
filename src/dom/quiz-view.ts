// Quiz: the DOM view + facade for a graded checkpoint. It renders a QuizPlan,
// records answers back into it, and drives grading through the pure core. All
// assessment logic (draw / shuffle / grade / threshold) lives in quiz-model.ts;
// this file only owns DOM and persistence. Mounted like MemoryViz:
//   CodeLab.Quiz.create(host, config)

import type { QuizConfig, QuizPlan } from "../core/quiz-model.js";
import type { KeyValueStore } from "../core/progress-store.js";
import { drawQuiz, firstUnanswered, scoreQuiz } from "../core/quiz-model.js";

/** Persistence + XP hook, injected so the component is testable and reusable. */
export interface QuizStore {
  hasPassed(): boolean;
  markPassed(): void;
  getXP(): number;
  addXP(amount: number): void;
}

function localStore(
  xpKey: string,
  awardedKey: string,
  kv: KeyValueStore = globalThis.localStorage,
): QuizStore {
  const read = (): { passed?: boolean } => {
    try {
      return JSON.parse(kv.getItem(awardedKey) || "{}");
    } catch {
      return {};
    }
  };
  const xp = () => parseInt(kv.getItem(xpKey) || "0", 10);
  return {
    hasPassed: () => Boolean(read().passed),
    markPassed: () => kv.setItem(awardedKey, JSON.stringify({ passed: true })),
    getXP: xp,
    addXP: (amount) => kv.setItem(xpKey, String(xp() + amount)),
  };
}

function escapeHtml(text: string): string {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function inline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

// Options must never carry emphasis that could single out the correct answer,
// so bold is stripped to plain text here; inline code is still allowed.
function inlineOption(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

export class Quiz {
  private readonly root: HTMLElement;
  private readonly cfg: QuizConfig;
  private readonly store: QuizStore;
  private readonly awardAmount: number;

  private plan!: QuizPlan;
  private graded = false;

  private readonly els: {
    questions: HTMLElement;
    submit: HTMLButtonElement;
    retry: HTMLButtonElement;
    result: HTMLElement;
    resultTitle: HTMLElement;
    resultBody: HTMLElement;
    continue: HTMLElement;
    progress: HTMLElement;
  };

  private constructor(host: HTMLElement, config: QuizConfig, store?: QuizStore) {
    this.cfg = config;
    this.awardAmount = typeof config.awardAmount === "number" ? config.awardAmount : 40;
    this.store =
      store ?? localStore(config.xpKey || "codelab_xp", config.awardedKey || `${config.prefix || "quiz"}_awarded`);

    this.root = document.createElement("section");
    this.root.className = "cl-quiz";
    this.root.setAttribute("aria-live", "polite");
    this.root.innerHTML = `
      <header class="cl-quiz-head">
        <p class="cl-quiz-meta">${escapeHtml(config.metaLabel || "")}</p>
        <h2 class="cl-quiz-title">${escapeHtml(config.title || "Knowledge check")}</h2>
        <p class="cl-quiz-intro">${inline(config.intro || "")}</p>
        <span class="cl-quiz-progress" data-progress></span>
      </header>
      <div class="cl-quiz-questions" data-questions></div>
      <div class="cl-quiz-actions">
        <button type="button" class="cl-quiz-btn cl-quiz-primary" data-submit>Submit answers</button>
        <button type="button" class="cl-quiz-btn" data-retry hidden>Try a fresh set</button>
      </div>
      <section class="cl-quiz-result" data-result hidden>
        <h3 data-result-title></h3>
        <p data-result-body></p>
        <div class="cl-quiz-continue" data-continue></div>
      </section>`;

    const q = <T extends HTMLElement>(sel: string): T => this.root.querySelector(sel) as T;
    this.els = {
      questions: q("[data-questions]"),
      submit: q<HTMLButtonElement>("[data-submit]"),
      retry: q<HTMLButtonElement>("[data-retry]"),
      result: q("[data-result]"),
      resultTitle: q("[data-result-title]"),
      resultBody: q("[data-result-body]"),
      continue: q("[data-continue]"),
      progress: q("[data-progress]"),
    };

    this.els.submit.addEventListener("click", () => this.onSubmit());
    this.els.retry.addEventListener("click", () => this.start());

    host.appendChild(this.root);
    this.refreshXpLabel();
    this.start();
  }

  static create(host: HTMLElement, config: QuizConfig, store?: QuizStore): Quiz {
    return new Quiz(host, config, store);
  }

  destroy(): void {
    this.root.remove();
  }

  // ---- attempt lifecycle -------------------------------------------------
  private start(): void {
    this.plan = drawQuiz(this.cfg);
    this.graded = false;
    this.renderQuestions();
    this.els.result.hidden = true;
    this.els.result.classList.remove("is-pass", "is-fail");
    this.els.submit.hidden = false;
    this.els.retry.hidden = true;
    this.els.progress.textContent = this.store.hasPassed()
      ? `Passed before \u00b7 ${this.plan.questions.length} questions`
      : `${this.plan.questions.length} questions \u00b7 ${this.plan.needed} to pass`;
  }

  private renderQuestions(): void {
    this.els.questions.innerHTML = "";
    this.plan.questions.forEach((question, qi) => {
      const block = document.createElement("fieldset");
      block.className = "cl-quiz-q";
      block.innerHTML =
        `<legend class="cl-quiz-stem"><span class="cl-quiz-num">${qi + 1}</span>` +
        `<span>${inline(question.stem)}</span></legend>` +
        `<div class="cl-quiz-opts"></div>` +
        `<p class="cl-quiz-why" hidden></p>`;
      const opts = block.querySelector(".cl-quiz-opts") as HTMLElement;
      question.options.forEach((opt, oi) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cl-quiz-opt";
        btn.innerHTML = inlineOption(opt.text);
        btn.addEventListener("click", () => {
          if (this.graded) return;
          question.chosen = oi;
          Array.prototype.forEach.call(opts.children, (c: Element) => c.classList.remove("is-chosen"));
          btn.classList.add("is-chosen");
        });
        opts.appendChild(btn);
      });
      this.els.questions.appendChild(block);
    });
  }

  private onSubmit(): void {
    const missing = firstUnanswered(this.plan);
    if (missing >= 0) {
      this.els.result.hidden = false;
      this.els.result.classList.remove("is-pass", "is-fail");
      this.els.resultTitle.textContent = "Answer every question";
      this.els.resultBody.textContent = `Question ${missing + 1} still needs an answer.`;
      this.els.continue.innerHTML = "";
      const block = this.els.questions.children[missing] as HTMLElement | undefined;
      if (block) block.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    this.grade();
  }

  private grade(): void {
    const blocks = this.els.questions.children;
    this.plan.questions.forEach((question, qi) => {
      const block = blocks[qi] as HTMLElement;
      const opts = block.querySelector(".cl-quiz-opts") as HTMLElement;
      const why = block.querySelector(".cl-quiz-why") as HTMLElement;
      question.options.forEach((opt, oi) => {
        const btn = opts.children[oi] as HTMLButtonElement;
        btn.disabled = true;
        if (opt.correct) btn.classList.add("is-correct");
        if (oi === question.chosen && !opt.correct) btn.classList.add("is-wrong");
      });
      const right = question.chosen >= 0 && question.options[question.chosen].correct;
      if (question.why) {
        why.hidden = false;
        why.innerHTML = (right ? "Correct. " : "Not quite. ") + inline(question.why);
        why.classList.toggle("is-good", right);
        why.classList.toggle("is-bad", !right);
      }
    });
    this.graded = true;
    this.showResult();
  }

  private showResult(): void {
    const { score, total, passed } = scoreQuiz(this.plan);
    if (passed && !this.store.hasPassed()) {
      this.store.markPassed();
      if (this.awardAmount) this.store.addXP(this.awardAmount);
      this.refreshXpLabel();
    }
    this.els.result.hidden = false;
    this.els.result.classList.toggle("is-pass", passed);
    this.els.result.classList.toggle("is-fail", !passed);
    this.els.resultTitle.textContent = passed ? "Checkpoint passed" : "Not passed yet";
    const xpLine = passed && this.awardAmount ? ` +${this.awardAmount} XP.` : "";
    this.els.resultBody.innerHTML =
      `You scored <strong>${score} / ${total}</strong> - ${this.plan.needed} needed to pass.` +
      (passed
        ? xpLine + " The explanations below cover anything you missed."
        : " Read the explanations below, then try a fresh set of questions.");
    this.els.continue.innerHTML = "";
    if (passed && this.cfg.nextHref) {
      const link = document.createElement("a");
      link.className = "cl-quiz-btn cl-quiz-primary";
      link.href = this.cfg.nextHref;
      link.textContent = this.cfg.nextLabel || "Continue";
      this.els.continue.appendChild(link);
    }
    this.els.submit.hidden = true;
    this.els.retry.hidden = false;
    this.els.progress.textContent = `Scored ${score}/${total}`;
    this.els.result.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /** Report the current XP to the host, which owns any XP label. */
  private refreshXpLabel(): void {
    this.cfg.onXpChange?.(this.store.getXP());
  }
}
