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

test("asterisks inside a code span stay literal (not italicised)", () => {
  assert.equal(
    renderNarration("Printed `2 * 3 * 4`"),
    "<p>Printed <code>2 * 3 * 4</code></p>",
  );
});

test("emphasis outside a code span still formats when code holds asterisks", () => {
  assert.equal(
    renderNarration("*note* `a*b*c` **done**"),
    "<p><em>note</em> <code>a*b*c</code> <strong>done</strong></p>",
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

// --- emphasis around a code chip -------------------------------------------
// Reported from a live lesson: "**both of them changed `cat.txt`**" rendered the
// asterisks as literal text. Emphasis used to run on the segments BETWEEN code
// spans, so an opening `**` before a chip and its closing `**` after one landed
// in different segments and neither matched.
test("bold can wrap a code chip", () => {
  const html = renderNarration("Read what each commit touched: **both changed `cat.txt`**.");
  assert.match(html, /<strong>both changed <code>cat\.txt<\/code><\/strong>/);
  assert.doesNotMatch(html, /\*\*/, "no raw asterisks reach the page");
});

test("italic can wrap a code chip too", () => {
  assert.match(renderNarration("*see `main`*"), /<em>see <code>main<\/code><\/em>/);
});

test("an asterisk INSIDE a code chip stays literal", () => {
  const html = renderNarration("run `a * b` twice");
  assert.match(html, /<code>a \* b<\/code>/);
  assert.doesNotMatch(html, /<em>/, "a multiplication is not emphasis");
});

test("bold still works with no code chip in sight", () => {
  assert.match(renderNarration("**nothing was added**"), /<strong>nothing was added<\/strong>/);
});

test("two separate chips inside one bold span both survive", () => {
  const html = renderNarration("**`a` and `b`**");
  assert.match(html, /<strong><code>a<\/code> and <code>b<\/code><\/strong>/);
});
