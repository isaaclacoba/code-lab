import { test } from "node:test";
import assert from "node:assert/strict";
import { renderNarration } from "../src/core/narration.ts";

test("a single line stays one paragraph (backward compatible)", () => {
  assert.equal(renderNarration("A plain line."), "<p>A plain line.</p>");
});

test("inline code and bold are formatted and html is escaped", () => {
  assert.equal(
    renderNarration("set `x` to **5** < 6"),
    "<p>set <code>x</code> to <strong>5</strong> &lt; 6</p>",
  );
});

test("blank lines split paragraphs", () => {
  assert.equal(renderNarration("One.\n\nTwo."), "<p>One.</p><p>Two.</p>");
});

test("dash lines become a bullet list", () => {
  assert.equal(
    renderNarration("Regions:\n- stack\n- heap"),
    "<p>Regions:</p><ul><li>stack</li><li>heap</li></ul>",
  );
});

test("a bullet run ends when normal text resumes", () => {
  assert.equal(
    renderNarration("- a\n- b\nAfter."),
    "<ul><li>a</li><li>b</li></ul><p>After.</p>",
  );
});

test("empty input yields empty string", () => {
  assert.equal(renderNarration(""), "");
});
