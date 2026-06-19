import { test } from "node:test";
import assert from "node:assert/strict";
import "./setup-dom.ts";
import {
  PlainHighlighter,
  PrismHighlighter,
  defaultHighlighter,
} from "../src/highlighter.ts";

test("PlainHighlighter escapes HTML metacharacters", () => {
  const out = new PlainHighlighter().highlight("a < b && c > d");
  assert.equal(out, "a &lt; b &amp;&amp; c &gt; d");
});

test("PrismHighlighter escapes when no grammar is available", () => {
  delete (window as unknown as { Prism?: unknown }).Prism;
  const out = new PrismHighlighter().highlight("<x>", "csharp");
  assert.equal(out, "&lt;x&gt;");
});

test("PrismHighlighter delegates to Prism when a grammar exists", () => {
  (window as unknown as { Prism: unknown }).Prism = {
    languages: { csharp: {} },
    highlight: (code: string) => `<span>${code}</span>`,
  };
  const out = new PrismHighlighter().highlight("int x", "csharp");
  assert.equal(out, "<span>int x</span>");
  delete (window as unknown as { Prism?: unknown }).Prism;
});

test("defaultHighlighter picks Plain without Prism and Prism with it", () => {
  delete (window as unknown as { Prism?: unknown }).Prism;
  assert.ok(defaultHighlighter() instanceof PlainHighlighter);
  (window as unknown as { Prism: unknown }).Prism = {
    languages: {},
    highlight: (c: string) => c,
  };
  assert.ok(defaultHighlighter() instanceof PrismHighlighter);
  delete (window as unknown as { Prism?: unknown }).Prism;
});
