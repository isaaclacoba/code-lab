// Quiz: the DOM view + facade for a graded checkpoint. It renders a QuizPlan,
// records answers back into it, and drives grading through the pure core. All
// assessment logic (draw / shuffle / grade / threshold) lives in quiz-model.ts;
// this file only owns DOM and persistence. Mounted like MemoryViz:
//   CodeLab.Quiz.create(host, config)

import type { QuizConfig, QuizPlan, QuizLabels } from "../core/quiz-model.js";
import type { KeyValueStore } from "../core/progress-store.js";
import { drawQuiz, firstUnanswered, scoreQuiz, conceptResults } from "../core/quiz-model.js";

/** English defaults for every UI string; a QuizConfig.labels overrides any key. */
const DEFAULT_QUIZ_LABELS: QuizLabels = {
  knowledgeCheck: "Knowledge check",
  submit: "Submit answers",
  retry: "Try a fresh set",
  continue: "Continue",
  progressPassed: "Passed before \u00b7 {n} questions",
  progressFresh: "{n} questions \u00b7 {m} to pass",
  progressScored: "Scored {score}/{total}",
  answerAll: "Answer every question",
  stillNeeds: "Question {n} still needs an answer.",
  correctPrefix: "Correct. ",
  notQuitePrefix: "Not quite. ",
  passTitle: "Checkpoint passed",
  failTitle: "Not passed yet",
  scoredLine: "You scored <strong>{score} / {total}</strong> - {needed} needed to pass.",
  passTail: " The explanations below cover anything you missed.",
  failTail: " Read the explanations below, then try a fresh set of questions.",
  xpLine: " +{xp} XP.",
  courseXp: "Course XP: {xp}",
};

/** Substitute {name} placeholders from vars; unknown names are left intact. */
function fill(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_m, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

/** Shared localStorage key holding every concept the learner has answered
 *  correctly in any checkpoint: `{ [conceptId]: true }`. The glossary and the
 *  in-lesson agenda read it to show per-concept "covered" state. */
const CONCEPT_PROGRESS_KEY = "course_concept_progress";

/** Persistence + XP hook, injected so the component is testable and reusable. */
export interface QuizStore {
  hasPassed(): boolean;
  markPassed(): void;
  getXP(): number;
  addXP(amount: number): void;
  /** Merge this attempt's per-concept passes into shared course progress. */
  saveConceptResults(results: Record<string, boolean>): void;
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
    saveConceptResults: (results) => {
      try {
        const prev = JSON.parse(kv.getItem(CONCEPT_PROGRESS_KEY) || "{}");
        for (const [id, passed] of Object.entries(results)) {
          if (passed) prev[id] = true; // monotonic: once covered, stays covered
        }
        kv.setItem(CONCEPT_PROGRESS_KEY, JSON.stringify(prev));
      } catch {
        /* storage unavailable - progress simply is not saved */
      }
    },
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
  private readonly labels: QuizLabels;

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
      store ?? localStore(config.xpKey || "course_global_xp", config.awardedKey || `${config.prefix || "quiz"}_awarded`);
    this.labels = { ...DEFAULT_QUIZ_LABELS, ...(config.labels || {}) };

    this.root = document.createElement("section");
    this.root.className = "cl-quiz";
    this.root.setAttribute("aria-live", "polite");
    this.root.innerHTML = `
      <header class="cl-quiz-head">
        <p class="cl-quiz-meta">${escapeHtml(config.metaLabel || "")}</p>
        <h2 class="cl-quiz-title">${escapeHtml(config.title || this.labels.knowledgeCheck)}</h2>
        <p class="cl-quiz-intro">${inline(config.intro || "")}</p>
        <span class="cl-quiz-progress" data-progress></span>
      </header>
      <div class="cl-quiz-questions" data-questions></div>
      <div class="cl-quiz-actions">
        <button type="button" class="cl-quiz-btn cl-quiz-primary" data-submit>${escapeHtml(this.labels.submit)}</button>
        <button type="button" class="cl-quiz-btn" data-retry hidden>${escapeHtml(this.labels.retry)}</button>
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
      ? fill(this.labels.progressPassed, { n: this.plan.questions.length })
      : fill(this.labels.progressFresh, { n: this.plan.questions.length, m: this.plan.needed });
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
      this.els.resultTitle.textContent = this.labels.answerAll;
      this.els.resultBody.textContent = fill(this.labels.stillNeeds, { n: missing + 1 });
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
        why.innerHTML = (right ? this.labels.correctPrefix : this.labels.notQuitePrefix) + inline(question.why);
        why.classList.toggle("is-good", right);
        why.classList.toggle("is-bad", !right);
      }
    });
    this.graded = true;
    this.store.saveConceptResults(conceptResults(this.plan));
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
    this.els.resultTitle.textContent = passed ? this.labels.passTitle : this.labels.failTitle;
    const xpLine = passed && this.awardAmount ? fill(this.labels.xpLine, { xp: this.awardAmount }) : "";
    this.els.resultBody.innerHTML =
      fill(this.labels.scoredLine, { score, total, needed: this.plan.needed }) +
      (passed ? xpLine + this.labels.passTail : this.labels.failTail);
    this.els.continue.innerHTML = "";
    if (passed && this.cfg.nextHref) {
      const link = document.createElement("a");
      link.className = "cl-quiz-btn cl-quiz-primary";
      link.href = this.cfg.nextHref;
      link.textContent = this.cfg.nextLabel || this.labels.continue;
      this.els.continue.appendChild(link);
    }
    this.els.submit.hidden = true;
    this.els.retry.hidden = false;
    this.els.progress.textContent = fill(this.labels.progressScored, { score, total });
    this.els.result.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /** Report the current XP to the host, which owns any XP label. */
  private refreshXpLabel(): void {
    this.cfg.onXpChange?.(this.store.getXP());
    const label = document.getElementById("courseXpLabel");
    if (label) label.textContent = fill(this.labels.courseXp, { xp: this.store.getXP() });
  }
}
