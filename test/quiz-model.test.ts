import { test } from "node:test";
import assert from "node:assert/strict";
import {
  drawQuiz,
  firstUnanswered,
  neededToPass,
  scoreQuiz,
  conceptResults,
  shuffle,
} from "../src/core/quiz-model.ts";
import type { QuizConfig } from "../src/core/quiz-model.ts";

// Deterministic rng so draws/shuffles are reproducible in tests.
function seeded(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const cfg: QuizConfig = {
  askCount: 3,
  passRatio: 0.7,
  questions: [
    { stem: "q1", options: ["a", "b", "c"], correct: 0, why: "w1" },
    { stem: "q2", options: ["a", "b", "c"], correct: 1, why: "w2" },
    { stem: "q3", options: ["a", "b", "c"], correct: 2, why: "w3" },
    { stem: "q4", options: ["a", "b", "c"], correct: 0, why: "w4" },
    { stem: "q5", options: ["a", "b", "c"], correct: 1, why: "w5" },
  ],
};

test("neededToPass rounds up and is at least 1", () => {
  assert.equal(neededToPass(5, 0.7), 4);
  assert.equal(neededToPass(3, 0.7), 3);
  assert.equal(neededToPass(1, 0.1), 1);
});

test("shuffle preserves the multiset", () => {
  const src = [1, 2, 3, 4, 5];
  const out = shuffle(src, seeded(7));
  assert.deepEqual([...out].sort(), [...src].sort());
  assert.notEqual(out, src); // returns a copy
});

test("drawQuiz draws askCount questions and marks exactly one correct option each", () => {
  const plan = drawQuiz(cfg, seeded(42));
  assert.equal(plan.questions.length, 3);
  assert.equal(plan.askCount, 3);
  assert.equal(plan.needed, 3);
  for (const q of plan.questions) {
    assert.equal(q.options.filter((o) => o.correct).length, 1);
    assert.equal(q.chosen, -1);
  }
});

test("drawQuiz caps askCount at the bank size", () => {
  const plan = drawQuiz({ ...cfg, askCount: 99 }, seeded(1));
  assert.equal(plan.questions.length, cfg.questions.length);
});

test("firstUnanswered finds the first gap, then -1 once all answered", () => {
  const plan = drawQuiz(cfg, seeded(3));
  assert.equal(firstUnanswered(plan), 0);
  plan.questions.forEach((q) => (q.chosen = 0));
  assert.equal(firstUnanswered(plan), -1);
});

test("scoreQuiz counts correct picks and applies the threshold", () => {
  const plan = drawQuiz(cfg, seeded(9));
  plan.questions.forEach((q) => {
    q.chosen = q.options.findIndex((o) => o.correct);
  });
  const all = scoreQuiz(plan);
  assert.equal(all.score, 3);
  assert.equal(all.passed, true);

  plan.questions[0].chosen = plan.questions[0].options.findIndex((o) => !o.correct);
  const one = scoreQuiz(plan);
  assert.equal(one.score, 2);
  assert.equal(one.passed, false); // needed 3
});

test("conceptResults maps each tagged concept to whether it was answered right", () => {
  const conceptCfg: QuizConfig = {
    askCount: 4,
    questions: [
      { conceptId: "c-a", stem: "qa", options: ["a", "b"], correct: 0 },
      { conceptId: "c-b", stem: "qb", options: ["a", "b"], correct: 0 },
      { conceptId: "c-a", stem: "qa2", options: ["a", "b"], correct: 0 },
      { stem: "q-untagged", options: ["a", "b"], correct: 0 },
    ],
  };
  const plan = drawQuiz(conceptCfg, seeded(5));
  // Answer only c-a's questions correctly; c-b wrong; untagged correct.
  for (const q of plan.questions) {
    const rightIdx = q.options.findIndex((o) => o.correct);
    const wrongIdx = q.options.findIndex((o) => !o.correct);
    q.chosen = q.conceptId === "c-b" ? wrongIdx : rightIdx;
  }
  const res = conceptResults(plan);
  assert.equal(res["c-a"], true); // at least one right
  assert.equal(res["c-b"], false); // its one question was wrong
  assert.equal("" in res, false); // untagged questions are ignored
  assert.equal(Object.keys(res).length, 2);
});

test("conceptResults ignores an unanswered plan's untagged questions and is empty when nothing is tagged", () => {
  const plan = drawQuiz(cfg, seeded(9)); // cfg questions have no conceptId
  assert.deepEqual(conceptResults(plan), {});
});
