import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRetrieval } from "../src/core/retrieval-model.ts";

test("no scene yields an empty list", () => {
  assert.deepEqual(resolveRetrieval(null), []);
  assert.deepEqual(resolveRetrieval(undefined), []);
  assert.deepEqual(resolveRetrieval({}), []);
});

test("state defaults to idle and score to null", () => {
  const [doc] = resolveRetrieval({ docs: [{ text: "a chunk" }] });
  assert.equal(doc.state, "idle");
  assert.equal(doc.score, null);
  assert.equal(doc.scorePct, null);
});

test("a score becomes a clamped value and a whole percent", () => {
  const rows = resolveRetrieval({
    docs: [
      { text: "close", score: 0.91 },
      { text: "far", score: 0.12 },
    ],
  });
  assert.deepEqual(rows.map((d) => d.scorePct), [91, 12]);
  assert.deepEqual(rows.map((d) => d.score), [0.91, 0.12]);
});

test("out-of-range scores clamp to 0..1", () => {
  const rows = resolveRetrieval({
    docs: [
      { text: "over", score: 1.4 },
      { text: "under", score: -0.3 },
    ],
  });
  assert.deepEqual(rows.map((d) => d.scorePct), [100, 0]);
});
