import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTraceOutcome, tracerFailedOutcome } from "../src/core/viz-trace-outcome.ts";
import type { ExecTrace } from "../src/core/exec-tracer-model.ts";

// test/viz-trace-outcome.test.ts - what a host is told after a Visualize press.
//
// WHY THIS EXISTS
// A lab card grades from the trace, so this classification IS the grade's input.
// The distinction it has to protect is between "the learner's code ran and did
// not do the thing" and "nothing ran at all". Collapsing those hands a learner a
// red goal for a compiler that failed to load, with no way to tell.

const TRACE: ExecTrace = {
  code: ["class Program", "{", "    static void Main() { }", "}"],
  steps: [{ line: 3, frames: [{ id: "f0", name: "Main", kind: "entry", vars: [] }], heap: [] }],
};

test("a clean run is `traced`, and carries the trace to grade", () => {
  const o = classifyTraceOutcome({ compiled: true, trace: TRACE, errors: [] });
  assert.equal(o.status, "traced");
  assert.equal(o.trace, TRACE);
  assert.equal(o.truncated, false);
  assert.equal(o.runtimeError, undefined);
  assert.deepEqual(o.errors, []);
});

test("code that did not compile carries its errors and NO trace", () => {
  const errors = [{ raw: "CS1002: ; expected", line: 3 }];
  const o = classifyTraceOutcome({ compiled: false, errors });
  assert.equal(o.status, "did-not-compile");
  assert.equal(o.trace, undefined);
  assert.deepEqual(o.errors, errors);
});

test("a program that threw is `threw`, and still hands over what ran first", () => {
  const o = classifyTraceOutcome({
    compiled: true,
    trace: TRACE,
    runtimeError: "System.NullReferenceException",
    errors: [],
  });
  assert.equal(o.status, "threw");
  assert.equal(o.runtimeError, "System.NullReferenceException");
  // The partial trace is the point: a goal that was met BEFORE the throw is met.
  assert.equal(o.trace, TRACE);
});

test("hitting the step budget is `budget`, not a clean run", () => {
  const o = classifyTraceOutcome({ compiled: true, trace: { ...TRACE, truncated: true }, errors: [] });
  assert.equal(o.status, "budget");
  assert.equal(o.truncated, true);
});

test("a run that both threw AND was cut short reports both facts", () => {
  // `status` can only say one thing, so `truncated` has to stay readable next to
  // it - otherwise one of the two failures is silently lost.
  const o = classifyTraceOutcome({
    compiled: true,
    trace: { ...TRACE, truncated: true },
    runtimeError: "boom",
    errors: [],
  });
  assert.equal(o.status, "threw");
  assert.equal(o.truncated, true);
  assert.equal(o.runtimeError, "boom");
});

test("compiled but no steps is `empty`, which is not the same as failing", () => {
  const o = classifyTraceOutcome({ compiled: true, trace: { code: [], steps: [] }, errors: [] });
  assert.equal(o.status, "empty");
  assert.deepEqual(o.errors, []);
});

test("compiled with no trace at all is `empty`, not a crash", () => {
  const o = classifyTraceOutcome({ compiled: true, errors: [] });
  assert.equal(o.status, "empty");
  assert.equal(o.trace, undefined);
});

test("a tracer that never loaded is `failed` - not the learner's fault", () => {
  const o = tracerFailedOutcome("The code took too long to trace.");
  assert.equal(o.status, "failed");
  assert.equal(o.failure, "The code took too long to trace.");
  assert.equal(o.trace, undefined);
  assert.equal(o.truncated, false);
});

test("`null` runtimeError from the wire is not read as a throw", () => {
  const o = classifyTraceOutcome({ compiled: true, trace: TRACE, runtimeError: null, errors: [] });
  assert.equal(o.status, "traced");
  assert.equal(o.runtimeError, undefined);
});

test("every status is reachable, so no branch is dead", () => {
  const seen = new Set([
    classifyTraceOutcome({ compiled: true, trace: TRACE, errors: [] }).status,
    classifyTraceOutcome({ compiled: false, errors: [] }).status,
    classifyTraceOutcome({ compiled: true, trace: TRACE, runtimeError: "x", errors: [] }).status,
    classifyTraceOutcome({ compiled: true, trace: { ...TRACE, truncated: true }, errors: [] }).status,
    classifyTraceOutcome({ compiled: true, errors: [] }).status,
    tracerFailedOutcome("x").status,
  ]);
  assert.deepEqual(
    [...seen].sort(),
    ["budget", "did-not-compile", "empty", "failed", "threw", "traced"],
  );
});
