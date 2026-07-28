import { test } from "node:test";
import assert from "node:assert/strict";
import { formatToolSignature, resolveRackTools, toolRackRows } from "../src/core/tool-rack-model.ts";

test("a tool with no parameters reads name()", () => {
  assert.equal(formatToolSignature({ name: "listInbox" }), "listInbox()");
  assert.equal(formatToolSignature({ name: "listInbox", params: [] }), "listInbox()");
});

test("a single typed parameter is name: type", () => {
  assert.equal(
    formatToolSignature({ name: "getWeather", params: [{ name: "city", type: "text" }] }),
    "getWeather(city: text)",
  );
});

test("many parameters are comma-separated in order", () => {
  assert.equal(
    formatToolSignature({
      name: "searchFlights",
      params: [
        { name: "from", type: "text" },
        { name: "to", type: "text" },
        { name: "day", type: "date" },
      ],
    }),
    "searchFlights(from: text, to: text, day: date)",
  );
});

test("resolveRackTools defaults state to idle, computes the signature, keeps order", () => {
  const rows = resolveRackTools({
    tools: [
      { name: "getWeather", params: [{ name: "city", type: "text" }], desc: "weather now" },
      { name: "listInbox", state: "chosen" },
    ],
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => r.name),
    ["getWeather", "listInbox"],
  );
  assert.equal(rows[0].state, "idle");
  assert.equal(rows[0].signature, "getWeather(city: text)");
  assert.equal(rows[0].desc, "weather now");
  assert.equal(rows[1].state, "chosen");
  assert.equal(rows[1].signature, "listInbox()");
});

test("resolveRackTools on an empty or missing scene yields no tools", () => {
  assert.deepEqual(resolveRackTools({}), []);
  assert.deepEqual(resolveRackTools(null), []);
  assert.deepEqual(resolveRackTools(undefined), []);
});

test("toolRackRows shows nothing when there is no call, result or error", () => {
  assert.deepEqual(toolRackRows({}), []);
  assert.deepEqual(toolRackRows(null), []);
});

test("toolRackRows shows the call, then the result", () => {
  assert.deepEqual(toolRackRows({ call: 'getWeather(city: "Oslo")', result: "12C, rain" }), [
    { kind: "call", text: 'getWeather(city: "Oslo")' },
    { kind: "result", text: "12C, rain" },
  ]);
});

test("an error takes precedence over a result, and the result row is dropped", () => {
  assert.deepEqual(toolRackRows({ call: "getWeather()", error: "404 unknown city", result: "12C" }), [
    { kind: "call", text: "getWeather()" },
    { kind: "error", text: "404 unknown city" },
  ]);
});

test("an error can appear without a call", () => {
  assert.deepEqual(toolRackRows({ error: "timeout" }), [{ kind: "error", text: "timeout" }]);
});
