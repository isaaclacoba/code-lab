import { test } from "node:test";
import assert from "node:assert/strict";
import { shelfStores, activeStores, DEFAULT_MEMORY_STORES } from "../src/core/memory-shelf-model.ts";

test("no scene yields an empty active set", () => {
  assert.equal(activeStores(null).size, 0);
  assert.equal(activeStores(undefined).size, 0);
  assert.equal(activeStores({}).size, 0);
});

test("active accepts a single kind or a list", () => {
  assert.deepEqual([...activeStores({ active: "semantic" })], ["semantic"]);
  const set = activeStores({ active: ["episodic", "procedural"] });
  assert.ok(set.has("episodic"));
  assert.ok(set.has("procedural"));
  assert.ok(!set.has("semantic"));
});

test("shelfStores returns the three stores in taxonomy order", () => {
  const rows = shelfStores({});
  assert.deepEqual(
    rows.map((r) => r.meta.id),
    DEFAULT_MEMORY_STORES.map((s) => s.id),
  );
  assert.equal(rows.length, 3);
});

test("shelfStores resolves items and the active flag per store", () => {
  const rows = shelfStores({
    stores: { semantic: [{ text: "aisle seats" }], episodic: [{ text: "3 May trip", hot: true }] },
    active: "semantic",
  });
  const byId = Object.fromEntries(rows.map((r) => [r.meta.id, r]));
  assert.equal(byId.semantic.items.length, 1);
  assert.equal(byId.semantic.active, true);
  assert.equal(byId.episodic.items[0].hot, true);
  assert.equal(byId.episodic.active, false);
  assert.equal(byId.procedural.items.length, 0);
});

test("shelfStores follows a custom taxonomy list (the open/closed seam)", () => {
  const custom = [{ id: "semantic" as const, name: "Facts", blurb: "what it knows" }];
  const rows = shelfStores({ stores: { semantic: [{ text: "x" }] }, active: "semantic" }, custom);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].meta.name, "Facts");
  assert.equal(rows[0].active, true);
  assert.equal(rows[0].items.length, 1);
});
