import { test } from "node:test";
import assert from "node:assert/strict";
import { diffLines, formatFileDiff } from "../src/core/text-diff.ts";
import { splitLines } from "../src/core/text-merge.ts";

const F = (...lines: string[]) => lines.join("\n");

test("an unchanged file produces no diff at all", () => {
  assert.equal(formatFileDiff("a.txt", "same", "same"), "");
});

test("a changed line reads as one removal and one addition", () => {
  const d = diffLines(splitLines(F("one", "two", "three")), splitLines(F("one", "TWO", "three")));
  assert.deepEqual(
    d.map((l) => l.kind + l.text),
    [" one", "-two", "+TWO", " three"],
  );
});

test("an inserted line is ONE addition, not a rewrite of the rest", () => {
  // Same reason the merge uses LCS: by-index comparison would call every line
  // below the insertion changed.
  const d = diffLines(splitLines(F("one", "two")), splitLines(F("NEW", "one", "two")));
  assert.deepEqual(
    d.map((l) => l.kind + l.text),
    ["+NEW", " one", " two"],
  );
});

test("the diff header names the file the way git does", () => {
  const out = formatFileDiff("notes.md", F("one", "two"), F("one", "TWO"));
  const lines = out.split("\n");
  assert.equal(lines[0], "diff --git a/notes.md b/notes.md");
  assert.equal(lines[1], "--- a/notes.md");
  assert.equal(lines[2], "+++ b/notes.md");
  assert.match(lines[3], /^@@ -\d+,\d+ \+\d+,\d+ @@$/);
});

test("a whole small file shows as context around the change", () => {
  const out = formatFileDiff("notes.md", F("one", "two", "three"), F("one", "TWO", "three"));
  assert.equal(
    out,
    F(
      "diff --git a/notes.md b/notes.md",
      "--- a/notes.md",
      "+++ b/notes.md",
      "@@ -1,3 +1,3 @@",
      " one",
      "-two",
      "+TWO",
      " three",
    ),
  );
});

test("adding to an empty file counts the old side as zero", () => {
  const out = formatFileDiff("new.txt", "", F("first line"));
  assert.match(out, /@@ -0,0 \+1,1 @@/);
  assert.match(out, /^\+first line$/m);
});

test("far-apart changes make two hunks, not one giant one", () => {
  const before = F("a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l");
  const after = F("A", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "L");
  const out = formatFileDiff(before === after ? "x" : "long.txt", before, after);
  const headers = out.split("\n").filter((l) => l.startsWith("@@"));
  assert.equal(headers.length, 2, "the untouched middle is not printed");
});
