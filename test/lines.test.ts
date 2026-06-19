import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeLineFlags,
  normalizeLines,
  splitCodeLines,
} from "../src/core/lines.ts";

test("normalizeLines wraps a single number", () => {
  assert.deepEqual(normalizeLines(3), [3]);
});

test("normalizeLines sorts and de-duplicates a list", () => {
  assert.deepEqual(normalizeLines([3, 1, 3, 2]), [1, 2, 3]);
});

test("normalizeLines treats undefined/null as no lines", () => {
  assert.deepEqual(normalizeLines(undefined), []);
  assert.deepEqual(normalizeLines(null), []);
});

test("normalizeLines drops non-positive and non-finite entries", () => {
  assert.deepEqual(normalizeLines([0, -1, 2, NaN]), [2]);
});

test("splitCodeLines trims trailing blank lines only", () => {
  assert.deepEqual(splitCodeLines("a\nb\n\n"), ["a", "b"]);
  assert.deepEqual(splitCodeLines("\na\n"), ["", "a"]);
});

test("computeLineFlags marks active lines and dims the rest", () => {
  const flags = computeLineFlags([2], 3);
  assert.deepEqual(flags, [
    { active: false, dim: true },
    { active: true, dim: false },
    { active: false, dim: true },
  ]);
});

test("computeLineFlags dims nothing when no line is active", () => {
  const flags = computeLineFlags([], 2);
  assert.deepEqual(flags, [
    { active: false, dim: false },
    { active: false, dim: false },
  ]);
});
