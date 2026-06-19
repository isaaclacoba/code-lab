import { test } from "node:test";
import assert from "node:assert/strict";
import "./setup-dom.ts";
import { ReadOnlyView } from "../src/editors/readonly.ts";

test("mount renders an escaped, highlighted block reflecting the value", () => {
  const host = document.createElement("div");
  const view = new ReadOnlyView();
  view.mount(host, { value: "a < b", language: "csharp", readOnly: true });

  const code = host.querySelector("code");
  assert.ok(code);
  assert.equal(view.getValue(), "a < b");
  // No Prism on the page -> the plain highlighter escapes.
  assert.equal(code.innerHTML, "a &lt; b");

  view.destroy();
});

test("setValue updates both the stored value and the rendered HTML", () => {
  const host = document.createElement("div");
  const view = new ReadOnlyView();
  view.mount(host, { value: "x", language: "csharp", readOnly: true });

  view.setValue("c > d");
  assert.equal(view.getValue(), "c > d");
  assert.equal(host.querySelector("code")?.innerHTML, "c &gt; d");

  view.destroy();
});

test("destroy removes the element from the host", () => {
  const host = document.createElement("div");
  const view = new ReadOnlyView();
  view.mount(host, { value: "x", language: "csharp", readOnly: true });
  assert.ok(host.querySelector("pre"));

  view.destroy();
  assert.equal(host.querySelector("pre"), null);
});
