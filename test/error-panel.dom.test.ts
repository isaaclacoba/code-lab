import { test } from "node:test";
import assert from "node:assert/strict";
import "./setup-dom.ts";
import { renderErrorPanel, showErrorPanel } from "../src/dom/error-panel.ts";
import type { CompileError } from "../src/types.ts";

test("renderErrorPanel shows heading, note, and one item per error", () => {
  const errors: CompileError[] = [
    { line: 15, column: 1, friendly: "public must precede the type", raw: "CS1585" },
    { raw: "CS1002: ; expected" },
  ];
  const panel = renderErrorPanel(errors);

  assert.equal(panel.querySelector("h3")?.textContent, "Let's fix this first");
  assert.ok(panel.querySelector(".cl-errors-note"));
  assert.equal(panel.querySelectorAll("li").length, 2);
});

test("renderErrorPanel renders line/col, friendly, and raw for a full error", () => {
  const panel = renderErrorPanel([
    { line: 15, column: 1, friendly: "public must precede the type", raw: "CS1585" },
  ]);
  const li = panel.querySelector("li");
  assert.equal(li?.querySelector(".cl-error-loc")?.textContent, "Line 15, col 1");
  assert.equal(li?.querySelector(".cl-error-friendly")?.textContent, "public must precede the type");
  assert.equal(li?.querySelector(".cl-error-raw")?.textContent, "CS1585");
});

test("renderErrorPanel omits the location when there is no line", () => {
  const panel = renderErrorPanel([{ raw: "CS1002: ; expected" }]);
  const li = panel.querySelector("li");
  assert.equal(li?.querySelector(".cl-error-loc"), null);
  assert.equal(li?.querySelector(".cl-error-raw")?.textContent, "CS1002: ; expected");
});

test("renderErrorPanel shows line only when column is absent", () => {
  const panel = renderErrorPanel([{ line: 7, raw: "x" }]);
  assert.equal(panel.querySelector(".cl-error-loc")?.textContent, "Line 7");
});

test("showErrorPanel mounts the panel and reports that errors were shown", () => {
  const host = document.createElement("div");
  const shown = showErrorPanel(host, [{ raw: "boom" }]);
  assert.equal(shown, true);
  assert.equal(host.hidden, false);
  assert.ok(host.querySelector(".cl-errors"));
});

test("showErrorPanel clears and hides the host when there are no errors", () => {
  const host = document.createElement("div");
  host.appendChild(document.createElement("span"));
  const shown = showErrorPanel(host, []);
  assert.equal(shown, false);
  assert.equal(host.hidden, true);
  assert.equal(host.childNodes.length, 0);
});
