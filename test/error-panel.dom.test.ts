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

test("an error with no why has no toggle - nothing to open", () => {
  const panel = renderErrorPanel([{ raw: "CS1002: ; expected" }]);
  assert.equal(panel.querySelector(".cl-error-why-toggle"), null);
  assert.equal(panel.querySelector(".cl-error-why"), null);
});

test("the why paragraph is rendered but folded away until asked for", () => {
  const panel = renderErrorPanel([
    { raw: "CS0201", friendly: "do something with it", why: "Every statement has to act." },
  ]);
  const toggle = panel.querySelector(".cl-error-why-toggle") as HTMLButtonElement;
  const why = panel.querySelector(".cl-error-why") as HTMLElement;
  assert.ok(toggle);
  assert.equal(toggle.textContent, "Learn why");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(why.textContent, "Every statement has to act.");
  assert.equal(why.hidden, true);
});

test("clicking the toggle opens the why, and clicking again folds it back", () => {
  const panel = renderErrorPanel([{ raw: "CS0201", why: "because" }]);
  const toggle = panel.querySelector(".cl-error-why-toggle") as HTMLButtonElement;
  const why = panel.querySelector(".cl-error-why") as HTMLElement;

  toggle.click();
  assert.equal(why.hidden, false);
  assert.equal(toggle.textContent, "Hide why");
  assert.equal(toggle.getAttribute("aria-expanded"), "true");

  toggle.click();
  assert.equal(why.hidden, true);
  assert.equal(toggle.textContent, "Learn why");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
});

test("the warning variant says the code ran, and is marked apart from errors", () => {
  const panel = renderErrorPanel([{ raw: "CS1718" }], {}, { kind: "warning" });
  assert.ok(panel.classList.contains("cl-errors--warning"));
  assert.equal(panel.querySelector("h3")?.textContent, "It ran - but read this");
});

test("the error variant keeps the blocking heading and no warning class", () => {
  const panel = renderErrorPanel([{ raw: "CS1002" }], {}, { kind: "error" });
  assert.equal(panel.classList.contains("cl-errors--warning"), false);
  assert.equal(panel.querySelector("h3")?.textContent, "Let's fix this first");
});

test("labels stay translatable - every string can be replaced", () => {
  const panel = renderErrorPanel([{ raw: "CS1718", why: "porque" }], {
    warningHeading: "Funciona - pero lee esto",
    why: "Saber por que",
  }, { kind: "warning" });
  assert.equal(panel.querySelector("h3")?.textContent, "Funciona - pero lee esto");
  assert.equal(panel.querySelector(".cl-error-why-toggle")?.textContent, "Saber por que");
});

test("showErrorPanel passes the warning kind through to the panel", () => {
  const host = document.createElement("div");
  showErrorPanel(host, [{ raw: "CS1718" }], {}, { kind: "warning" });
  assert.ok(host.querySelector(".cl-errors--warning"));
});
