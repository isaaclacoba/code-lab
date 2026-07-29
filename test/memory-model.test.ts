import { test } from "node:test";
import assert from "node:assert/strict";
import { slotKind } from "../src/core/memory-model.ts";
import type { Slot } from "../src/core/memory-model.ts";

test("an empty slot is classified empty, before anything else", () => {
  assert.equal(slotKind({ id: "a", empty: true } as Slot), "empty");
  // empty wins even if a value or ref is also present
  assert.equal(slotKind({ id: "a", empty: true, v: "5" } as Slot), "empty");
  assert.equal(slotKind({ id: "a", empty: true, ref: "o1" } as Slot), "empty");
});

test("a slot holding a heap id is a reference", () => {
  assert.equal(slotKind({ id: "pet", k: "pet", ref: "d1" } as Slot), "ref");
});

test('a slot whose value is exactly "null" is an explicit null reference', () => {
  assert.equal(slotKind({ id: "stray", k: "stray", v: "null" } as Slot), "null");
});

test("a plain value slot is classified value", () => {
  assert.equal(slotKind({ id: "count", k: "count", v: "5" } as Slot), "value");
  // a value that merely contains the text null is still a value, not a null ref
  assert.equal(slotKind({ id: "s", k: "s", v: '"null"' } as Slot), "value");
  assert.equal(slotKind({ id: "s", k: "s", v: "nullable" } as Slot), "value");
});
