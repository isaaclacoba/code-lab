import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTranscript, authorOf } from "../src/core/transcript-model.ts";

test("no scene yields an empty list", () => {
  assert.deepEqual(resolveTranscript(null), []);
  assert.deepEqual(resolveTranscript(undefined), []);
  assert.deepEqual(resolveTranscript({}), []);
});

test("each role defaults to its true author", () => {
  const rows = resolveTranscript({
    messages: [
      { role: "system", text: "You are terse." },
      { role: "developer", text: "Prefer metric units." },
      { role: "user", text: "Weather in Oslo?" },
      { role: "assistant", text: "Let me check." },
      { role: "tool", text: "4C, clear" },
    ],
  });
  assert.deepEqual(
    rows.map((m) => m.author),
    ["app", "app", "you", "model", "code"],
  );
});

test("an explicit author overrides the role default", () => {
  const rows = resolveTranscript({
    messages: [{ role: "assistant", text: "injected", by: "app" }],
  });
  assert.equal(rows[0].author, "app");
});

test("resolve preserves role, text and order, and defaults hot to false", () => {
  const rows = resolveTranscript({
    messages: [
      { role: "user", text: "first" },
      { role: "assistant", text: "second", hot: true, note: "the model only emits text" },
    ],
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((m) => m.text), ["first", "second"]);
  assert.equal(rows[0].hot, false);
  assert.equal(rows[0].note, undefined);
  assert.equal(rows[1].hot, true);
  assert.equal(rows[1].note, "the model only emits text");
});

test("authorOf answers a single message without resolving the whole list", () => {
  assert.equal(authorOf({ role: "tool", text: "42C" }), "code");
  assert.equal(authorOf({ role: "assistant", text: "hi" }), "model");
  assert.equal(authorOf({ role: "user", text: "hi" }), "you");
  assert.equal(authorOf({ role: "assistant", text: "hi", by: "code" }), "code");
});
