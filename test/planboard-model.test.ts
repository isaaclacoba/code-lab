import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePlan, planProgress } from "../src/core/planboard-model.ts";

test("no scene yields an empty plan and zero progress", () => {
  assert.deepEqual(resolvePlan(null), []);
  assert.deepEqual(resolvePlan(undefined), []);
  assert.deepEqual(planProgress({}), { done: 0, total: 0 });
});

test("steps are numbered from 1 and default to pending", () => {
  const steps = resolvePlan({ steps: [{ text: "first" }, { text: "second" }] });
  assert.deepEqual(steps.map((s) => s.n), [1, 2]);
  assert.deepEqual(steps.map((s) => s.state), ["pending", "pending"]);
});

test("an explicit state and note are carried through", () => {
  const [step] = resolvePlan({ steps: [{ text: "search", state: "done", note: "3 found" }] });
  assert.equal(step.state, "done");
  assert.equal(step.note, "3 found");
});

test("planProgress counts done over total", () => {
  const scene = {
    steps: [
      { text: "a", state: "done" as const },
      { text: "b", state: "active" as const },
      { text: "c", state: "pending" as const },
      { text: "d", state: "done" as const },
    ],
  };
  assert.deepEqual(planProgress(scene), { done: 2, total: 4 });
});
