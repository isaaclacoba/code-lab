// DOM-free model for the Quiz component. Pure data + pure functions so the
// draw / shuffle / grade logic can be unit-tested without a browser, exactly
// like the MemoryViz core. The DOM view (quiz-view.ts) renders a QuizPlan and
// reports answers back into it; it owns no assessment logic of its own.

export interface QuizQuestion {
  concept?: string;
  stem: string;
  options: string[];
  /** Index into `options` of the correct answer (pre-shuffle). */
  correct: number;
  why?: string;
}

export interface QuizConfig {
  prefix?: string;
  metaLabel?: string;
  title?: string;
  intro?: string;
  /** localStorage keys + XP for course progress integration (optional). */
  xpKey?: string;
  awardedKey?: string;
  awardAmount?: number;
  /** How many questions to draw from the bank per attempt (default: all). */
  askCount?: number;
  /** Fraction of the drawn questions needed to pass (default 0.7). */
  passRatio?: number;
  /** Shown on a pass. */
  nextHref?: string;
  nextLabel?: string;
  questions: QuizQuestion[];
}

export interface DrawnOption {
  text: string;
  correct: boolean;
}

/** One question as presented in an attempt: options shuffled, answer tracked. */
export interface DrawnQuestion {
  concept: string;
  stem: string;
  why: string;
  options: DrawnOption[];
  /** Index into the shuffled `options`; -1 = unanswered. */
  chosen: number;
}

export interface QuizPlan {
  questions: DrawnQuestion[];
  askCount: number;
  needed: number;
}

export interface QuizResult {
  score: number;
  total: number;
  passed: boolean;
}

export type Rng = () => number;

/** Fisher-Yates on a copy; deterministic when given a seeded rng. Pure. */
export function shuffle<T>(arr: T[], rng: Rng = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

export function neededToPass(askCount: number, passRatio: number): number {
  return Math.max(1, Math.ceil(askCount * passRatio));
}

/** Draw a random subset of the bank and shuffle each question's options. Pure. */
export function drawQuiz(config: QuizConfig, rng: Rng = Math.random): QuizPlan {
  const bank = config.questions ?? [];
  const askCount = Math.max(1, Math.min(config.askCount ?? bank.length, bank.length));
  const passRatio = typeof config.passRatio === "number" ? config.passRatio : 0.7;
  const questions: DrawnQuestion[] = shuffle(bank, rng)
    .slice(0, askCount)
    .map((q) => ({
      concept: q.concept ?? "",
      stem: q.stem,
      why: q.why ?? "",
      chosen: -1,
      options: shuffle(
        (q.options ?? []).map((text, i) => ({ text, correct: i === q.correct })),
        rng,
      ),
    }));
  return { questions, askCount, needed: neededToPass(askCount, passRatio) };
}

/** Index of the first still-unanswered question, or -1 if all answered. Pure. */
export function firstUnanswered(plan: QuizPlan): number {
  return plan.questions.findIndex((q) => q.chosen < 0);
}

/** Grade the current answers against the pass threshold. Pure. */
export function scoreQuiz(plan: QuizPlan): QuizResult {
  let score = 0;
  for (const q of plan.questions) {
    if (q.chosen >= 0 && q.options[q.chosen] && q.options[q.chosen].correct) score += 1;
  }
  return { score, total: plan.questions.length, passed: score >= plan.needed };
}
