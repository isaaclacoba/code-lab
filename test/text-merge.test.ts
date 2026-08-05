import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitLines,
  joinLines,
  lcsLines,
  diffHunks,
  merge3,
} from "../src/core/text-merge.ts";

const F = (...lines: string[]) => lines.join("\n");

// --- line alignment --------------------------------------------------------

test("lcs matches lines by content, not by position", () => {
  const a = ["one", "two", "three"];
  const b = ["inserted", "one", "two", "three"];
  const m = lcsLines(a, b);
  assert.deepEqual(
    m.map((x) => [x.ai, x.bi]),
    [
      [0, 1],
      [1, 2],
      [2, 3],
    ],
    "every original line is still found, one lower down",
  );
});

test("an insertion is one hunk, not a rewrite of the whole file", () => {
  const base = ["one", "two", "three"];
  const side = ["one", "NEW", "two", "three"];
  const hunks = diffHunks(base, side);
  assert.equal(hunks.length, 1);
  assert.deepEqual(hunks[0], { start: 1, end: 1, lines: ["NEW"] });
});

test("splitLines and joinLines round-trip, and a trailing newline is not a line", () => {
  assert.deepEqual(splitLines("a\nb\n"), ["a", "b"]);
  assert.deepEqual(splitLines("a\nb"), ["a", "b"]);
  assert.deepEqual(splitLines(""), []);
  assert.equal(joinLines(["a", "b"]), "a\nb");
});

// --- the bug the design named ---------------------------------------------

test("a one-line insertion does NOT conflict with an edit further down", () => {
  // This is the exact failure a by-index comparison would ship: inserting a line
  // shifts every line below it, so index-matching calls the rest of the file
  // changed and conflicts with any other edit.
  const base = F("line one", "line two", "line three", "line four");
  const ours = F("inserted at top", "line one", "line two", "line three", "line four");
  const theirs = F("line one", "line two", "line three", "line four EDITED");

  const r = merge3(base, ours, theirs);
  assert.equal(r.clean, true, "no conflict: the two sides touched different places");
  assert.equal(r.conflicts, 0);
  assert.equal(r.text, F("inserted at top", "line one", "line two", "line three", "line four EDITED"));
});

test("two sides editing different lines merge cleanly", () => {
  const base = F("a", "b", "c");
  const ours = F("a CHANGED", "b", "c");
  const theirs = F("a", "b", "c CHANGED");
  const r = merge3(base, ours, theirs);
  assert.equal(r.clean, true);
  assert.equal(r.text, F("a CHANGED", "b", "c CHANGED"));
});

test("the same edit made on both sides is taken once, not called a conflict", () => {
  const base = F("a", "b");
  const same = F("a", "b CHANGED");
  const r = merge3(base, same, same);
  assert.equal(r.clean, true);
  assert.equal(r.text, same);
});

// --- what a conflict actually is ------------------------------------------

test("both sides changing the same line IS a conflict", () => {
  const base = F("a", "shared line", "c");
  const ours = F("a", "ours wins", "c");
  const theirs = F("a", "theirs wins", "c");
  const r = merge3(base, ours, theirs);
  assert.equal(r.clean, false);
  assert.equal(r.conflicts, 1);
});

test("conflict markers are diff3 - they show the ancestor too", () => {
  const base = F("keep", "shared line", "keep too");
  const ours = F("keep", "ours wins", "keep too");
  const theirs = F("keep", "theirs wins", "keep too");
  const r = merge3(base, ours, theirs, { ours: "main", base: "ancestor", theirs: "feature" });

  assert.equal(
    r.text,
    F(
      "keep",
      "<<<<<<< main",
      "ours wins",
      "||||||| ancestor",
      "shared line",
      "=======",
      "theirs wins",
      ">>>>>>> feature",
      "keep too",
    ),
    "the middle section is what the line WAS - that is what explains the conflict",
  );
});

test("unconflicted lines outside the conflict survive untouched", () => {
  const base = F("first", "middle", "last");
  const ours = F("first", "ours", "last");
  const theirs = F("first", "theirs", "last");
  const r = merge3(base, ours, theirs);
  const lines = splitLines(r.text);
  assert.equal(lines[0], "first");
  assert.equal(lines[lines.length - 1], "last");
});

test("two different insertions at the same point conflict", () => {
  const base = F("a", "b");
  const ours = F("a", "ours line", "b");
  const theirs = F("a", "theirs line", "b");
  const r = merge3(base, ours, theirs);
  assert.equal(r.clean, false, "both sides wrote something different in the same gap");
});

test("a side that changed nothing lets the other side through", () => {
  const base = F("a", "b");
  const theirs = F("a", "b", "added");
  const r = merge3(base, base, theirs);
  assert.equal(r.clean, true);
  assert.equal(r.text, theirs);
});
