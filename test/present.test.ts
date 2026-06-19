import { test } from "node:test";
import assert from "node:assert/strict";
import { presentRun, selectRunCode } from "../src/core/present.ts";
import type { RunResult } from "../src/types.ts";

const labels = { noOutput: "(no output)" };

test("selectRunCode prefers the explicit compilable twin", () => {
  assert.equal(selectRunCode("TWIN", "editor"), "TWIN");
});

test("selectRunCode falls back to the editor value", () => {
  assert.equal(selectRunCode(undefined, "editor"), "editor");
});

test("selectRunCode keeps an empty-string twin (not skipped)", () => {
  assert.equal(selectRunCode("", "editor"), "");
});

test("presentRun shows compile errors with markers, preferring friendly text", () => {
  const result: RunResult = {
    compiled: false,
    output: "",
    errors: [
      { raw: "CS0103", friendly: "x is not defined" },
      { raw: "CS1002" },
    ],
  };
  const view = presentRun(result, labels);
  assert.equal(view.isError, true);
  assert.equal(view.text, "x is not defined\nCS1002");
  assert.equal(view.markers.length, 2);
});

test("presentRun shows a runtime error combined with output, no markers", () => {
  const result: RunResult = {
    compiled: true,
    output: "partial",
    runtimeError: "boom",
    errors: [],
  };
  const view = presentRun(result, labels);
  assert.equal(view.isError, true);
  assert.equal(view.text, "partial\nboom");
  assert.deepEqual(view.markers, []);
});

test("presentRun shows normal output when clean", () => {
  const result: RunResult = {
    compiled: true,
    output: "Hello",
    errors: [],
  };
  const view = presentRun(result, labels);
  assert.equal(view.isError, false);
  assert.equal(view.text, "Hello");
});

test("presentRun falls back to the noOutput label on empty output", () => {
  const result: RunResult = { compiled: true, output: "", errors: [] };
  const view = presentRun(result, labels);
  assert.equal(view.text, "(no output)");
  assert.equal(view.isError, false);
});
