import { test } from "node:test";
import assert from "node:assert/strict";
import { bootWait, traceWait } from "../src/core/wait-progress.js";
import { DEFAULT_VIZ_LABELS } from "../src/core/memory-model.js";

// test/wait-progress.test.ts - what a learner reads while they wait.
//
// WHY THIS EXISTS
// The Visualize button used to show one frozen word for the whole wait, so a
// slow connection and a dead compiler looked identical. These are the decisions
// behind the fix, kept out of the DOM so they can be checked: which phases carry
// a real number, which honestly carry none, and when the seconds start counting.

const L = DEFAULT_VIZ_LABELS;

test("the download reports the real percentage, because it has one", () => {
  const wait = bootWait(L, "download", 42);
  assert.equal(wait.percent, 42, "the bar fills to what was actually downloaded");
  assert.match(wait.label, /42%/, "and the learner can read the number");
});

test("a percentage out of range is clamped rather than drawn off the end", () => {
  assert.equal(bootWait(L, "download", -5).percent, 0);
  assert.equal(bootWait(L, "download", 140).percent, 100);
});

test("starting and warming up admit they have nothing to measure", () => {
  // These two phases are the host running code, not fetching bytes. A number
  // here would be invented, and an invented number that stops at 90% is what
  // teaches a learner to distrust the bar.
  for (const phase of ["start", "warm"] as const) {
    const wait = bootWait(L, phase, 100);
    assert.equal(wait.percent, null, `${phase} claims no progress it cannot see`);
    assert.notEqual(wait.label, "", `${phase} still says what it is doing`);
  }
  assert.notEqual(bootWait(L, "start", 0).label, bootWait(L, "warm", 0).label,
    "and the two are told apart, which is the whole point of naming the phase");
});

test("a trace counts the seconds, since it has no percentage to give", () => {
  assert.equal(traceWait(L, 0).label, L.vlTracing, "under a second there is nothing to count");
  assert.equal(traceWait(L, 990).label, L.vlTracing);
  assert.match(traceWait(L, 1000).label, /\b1s\b/, "then the count starts");
  assert.match(traceWait(L, 7400).label, /\b7s\b/, "and keeps up with the wait");
  assert.equal(traceWait(L, 7400).percent, null, "never a fake bar");
});

test("every label the wait can show is a real VizLabels field, so a translation reaches it", () => {
  // code-lab silently ignores an unknown label key, so a name invented here
  // would render English on a translated page with nothing reported.
  for (const key of ["vlBootDownload", "vlBootStart", "vlBootWarm", "vlTracing", "vlTracingSecs"]) {
    assert.equal(typeof (DEFAULT_VIZ_LABELS as unknown as Record<string, unknown>)[key], "string", key);
  }
});
