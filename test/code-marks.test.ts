import { test } from "node:test";
import assert from "node:assert/strict";
import {
  markedLineHtml,
  resolveMarks,
  spansForLine,
} from "../src/core/code-marks.ts";

test("resolveMarks finds every occurrence of a text needle", () => {
  const spans = resolveMarks("total = total + 1", { text: "total" });
  assert.deepEqual(spans.map((s) => [s.start, s.end]), [
    [0, 5],
    [8, 13],
  ]);
});

test("resolveMarks supports multiple needles and a kind", () => {
  const spans = resolveMarks("a + b - c", { text: ["+", "-"], kind: "op" });
  assert.deepEqual(spans.map((s) => [s.start, s.end, s.kind]), [
    [2, 3, "op"],
    [6, 7, "op"],
  ]);
});

test("resolveMarks uses explicit ranges when given", () => {
  const spans = resolveMarks("int total = 2 + 3", { ranges: [[12, 17]], kind: "expr" });
  assert.deepEqual(spans, [{ start: 12, end: 17, kind: "expr" }]);
});

test("spansForLine defaults the target line to pc and filters by line", () => {
  const mark = { text: "x" };
  assert.equal(spansForLine(2, "x = x", mark, 2).length, 2); // pc line
  assert.equal(spansForLine(0, "x = x", mark, 2).length, 0); // not pc line
  assert.equal(spansForLine(1, "x", { line: 1, text: "x" }, 5).length, 1); // explicit line
});

test("markedLineHtml wraps spans and escapes html", () => {
  const html = markedLineHtml("a < b", [{ start: 2, end: 3, kind: "op" }]);
  assert.equal(html, 'a <span class="cl-mv-cmark" data-kind="op">&lt;</span> b');
});

test("markedLineHtml returns escaped plain text when there are no spans", () => {
  assert.equal(markedLineHtml("a & b", []), "a &amp; b");
});

test("markedLineHtml skips overlapping spans", () => {
  const html = markedLineHtml("abcdef", [
    { start: 0, end: 3 },
    { start: 1, end: 4 },
  ]);
  assert.equal(html, '<span class="cl-mv-cmark">abc</span>def');
});
