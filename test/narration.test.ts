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

test("single asterisks become italic", () => {
  assert.equal(renderNarration("it is *just* true"), "<p>it is <em>just</em> true</p>");
});

test("bold wins over italic when both are present on a line", () => {
  assert.equal(
    renderNarration("**memory** is one box, kept *where* it matters"),
    "<p><strong>memory</strong> is one box, kept <em>where</em> it matters</p>",
  );
});

test("several italic spans on one line each format independently", () => {
  assert.equal(
    renderNarration("*what happened*, *what stays true*, *how to act*"),
    "<p><em>what happened</em>, <em>what stays true</em>, <em>how to act</em></p>",
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
