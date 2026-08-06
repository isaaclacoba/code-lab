import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findConflicts,
  resolveConflicts,
  hasConflictMarkers,
} from "../src/core/conflict-file.ts";

const F = (...l: string[]) => l.join("\n");

/** What the model writes when a merge stops: diff3, ancestor included. */
const MARKED = F(
  "the cat",
  "<<<<<<< main",
  "sleeps in the sun",
  "||||||| ancestor",
  "sleeps",
  "=======",
  "sleeps on the keyboard",
  ">>>>>>> fix",
  "and eats at seven",
);

test("a file with no markers has nothing to settle", () => {
  assert.deepEqual(findConflicts(F("one", "two")), []);
  assert.equal(hasConflictMarkers(F("one", "two")), false);
});

test("a diff3 region is read out in three parts, with its labels", () => {
  const [r] = findConflicts(MARKED);
  assert.equal(r.ourLabel, "main");
  assert.equal(r.theirLabel, "fix");
  assert.deepEqual(r.ours, ["sleeps in the sun"]);
  assert.deepEqual(r.base, ["sleeps"], "the ancestor is kept - it is why git could not choose");
  assert.deepEqual(r.theirs, ["sleeps on the keyboard"]);
});

test("keeping one side drops the markers and the other side with them", () => {
  assert.equal(
    resolveConflicts(MARKED, "ours"),
    F("the cat", "sleeps in the sun", "and eats at seven"),
  );
  assert.equal(
    resolveConflicts(MARKED, "theirs"),
    F("the cat", "sleeps on the keyboard", "and eats at seven"),
  );
});

test("keeping both puts ours first, then theirs, and no ancestor", () => {
  assert.equal(
    resolveConflicts(MARKED, "both"),
    F("the cat", "sleeps in the sun", "sleeps on the keyboard", "and eats at seven"),
  );
});

test("resolving leaves nothing for git to refuse", () => {
  for (const choice of ["ours", "theirs", "both"] as const) {
    assert.equal(hasConflictMarkers(resolveConflicts(MARKED, choice)), false, choice);
  }
});

test("two regions in one file are both settled", () => {
  const two = F(
    "<<<<<<< main", "A1", "=======", "B1", ">>>>>>> fix",
    "middle",
    "<<<<<<< main", "A2", "=======", "B2", ">>>>>>> fix",
  );
  assert.equal(findConflicts(two).length, 2);
  assert.equal(resolveConflicts(two, "ours"), F("A1", "middle", "A2"));
});

test("2-way markers work too - the ancestor is simply absent", () => {
  const twoWay = F("<<<<<<< main", "ours", "=======", "theirs", ">>>>>>> fix");
  const [r] = findConflicts(twoWay);
  assert.deepEqual(r.base, []);
  assert.equal(resolveConflicts(twoWay, "theirs"), "theirs");
});

test("a half-edited file is left alone rather than half-resolved", () => {
  // Someone deleting markers by hand passes through states like this. Acting on
  // one would rewrite the file underneath them mid-edit.
  const unterminated = F("<<<<<<< main", "ours", "=======", "theirs");
  assert.deepEqual(findConflicts(unterminated), []);
  assert.equal(resolveConflicts(unterminated, "ours"), unterminated);
});
