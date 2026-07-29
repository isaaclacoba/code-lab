import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveTrace } from "../src/core/exec-trace.ts";
import type { Frame, Slot, Step } from "../src/core/memory-model.ts";

function step(partial: Omit<Partial<Step>, "narr"> = {}): Step {
  return { narr: "", ...partial };
}

function frame(id: string, vars: Slot[]): Frame {
  return { id, vars };
}

function slot(id: string, k: string | undefined, value: string | null): Slot {
  const result: Slot = { id };
  if (k !== undefined) result.k = k;
  if (value === null) result.empty = true;
  else result.v = value;
  return result;
}

test("derives assignment changes, call depth, line heat and value history", () => {
  const steps: Step[] = [
    step({ pc: 0, stack: [frame("main", [slot("a-slot", "a", "1")])] }),
    step({ pc: 1, stack: [frame("main", [slot("a-slot", "a", "1"), slot("b-slot", "b", "2")])] }),
    step({
      pc: 1,
      stack: [frame("main", [slot("a-slot", "a", "1"), slot("b-slot", "b", "2"), slot("total-slot", "total", "3")])],
    }),
  ];

  const trace = deriveTrace(steps);

  assert.deepEqual(trace.callDepth, [1, 1, 1]);
  assert.deepEqual([...trace.lineHeatmap.entries()], [
    [0, 1],
    [1, 2],
  ]);
  assert.deepEqual(trace.changes, [
    [{ name: "a", kind: "created", from: null, to: "1" }],
    [
      { name: "a", kind: "unchanged", from: "1", to: "1" },
      { name: "b", kind: "created", from: null, to: "2" },
    ],
    [
      { name: "a", kind: "unchanged", from: "1", to: "1" },
      { name: "b", kind: "unchanged", from: "2", to: "2" },
      { name: "total", kind: "created", from: null, to: "3" },
    ],
  ]);
  assert.deepEqual(trace.valueHistory, [
    { name: "a", values: ["1", "1", "1"] },
    { name: "b", values: [null, "2", "2"] },
    { name: "total", values: [null, null, "3"] },
  ]);
  assert.deepEqual(trace.notables, []);
});

test("marks an unassigned slot as created when it receives a value", () => {
  const trace = deriveTrace([
    step({ stack: [frame("main", [slot("pet-slot", "pet", null)])] }),
    step({ stack: [frame("main", [slot("pet-slot", "pet", "otter")])] }),
  ]);

  assert.deepEqual(trace.changes, [
    [{ name: "pet", kind: "unchanged", from: null, to: null }],
    [{ name: "pet", kind: "created", from: null, to: "otter" }],
  ]);
  assert.deepEqual(trace.valueHistory, [{ name: "pet", values: [null, "otter"] }]);
});

test("marks a different assigned value as changed", () => {
  const trace = deriveTrace([
    step({ stack: [frame("main", [slot("count-slot", "count", "0")])] }),
    step({ stack: [frame("main", [slot("count-slot", "count", "1")])] }),
  ]);

  assert.deepEqual(trace.changes[1], [{ name: "count", kind: "changed", from: "0", to: "1" }]);
});

test("detects call and return notable steps", () => {
  const main = frame("main", [slot("animal-slot", "animal", "cat")]);
  const helper = frame("Feed", [slot("snack-slot", "snack", "fish")]);
  const trace = deriveTrace([
    step({ stack: [main] }),
    step({ stack: [main, helper] }),
    step({ stack: [main] }),
  ]);

  assert.deepEqual(trace.callDepth, [1, 2, 1]);
  assert.deepEqual(trace.notables, [
    { step: 1, kind: "call" },
    { step: 2, kind: "return" },
  ]);
});

test("detects when the heap object id set grows", () => {
  const trace = deriveTrace([
    step({ heap: [] }),
    step({ heap: [{ id: "cat-1", type: "Cat", fields: [] }] }),
  ]);

  assert.deepEqual(trace.notables, [{ step: 1, kind: "new-object" }]);
});

test("handles undefined pc, empty stack, missing stack, and missing slot name", () => {
  const trace = deriveTrace([
    step({ pc: undefined }),
    step({ pc: 4, stack: [] }),
    step({ pc: -1, stack: [frame("main", [slot("fallback-id", undefined, "ready")])] }),
  ]);

  assert.deepEqual(trace.callDepth, [0, 0, 1]);
  assert.deepEqual([...trace.lineHeatmap.entries()], [[4, 1]]);
  assert.deepEqual(trace.changes[0], []);
  assert.deepEqual(trace.changes[1], []);
  assert.deepEqual(trace.changes[2], [{ name: "fallback-id", kind: "created", from: null, to: "ready" }]);
  assert.deepEqual(trace.valueHistory, [{ name: "fallback-id", values: [null, null, "ready"] }]);
});
