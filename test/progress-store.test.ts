import { test } from "node:test";
import assert from "node:assert/strict";
import { ProgressStore } from "../src/core/progress-store.ts";
import type { KeyValueStore } from "../src/core/progress-store.ts";

function fakeStore(seed: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

test("xp reads the stored total, defaulting to 0", () => {
  assert.equal(new ProgressStore("xp", "done", 20, fakeStore()).xp(), 0);
  assert.equal(new ProgressStore("xp", "done", 20, fakeStore({ xp: "40" })).xp(), 40);
});

test("awardOnce grants XP and marks done the first time", () => {
  const store = fakeStore({ xp: "40" });
  const p = new ProgressStore("xp", "done", 20, store);
  assert.equal(p.awardOnce(), 60);
  assert.equal(store.data.xp, "60");
  assert.deepEqual(JSON.parse(store.data.done), { done: true });
});

test("awardOnce is idempotent within a session", () => {
  const store = fakeStore();
  const p = new ProgressStore("xp", "done", 20, store);
  p.awardOnce();
  const after = p.awardOnce();
  assert.equal(after, 20);
  assert.equal(store.data.xp, "20");
});

test("awardOnce does not re-grant when the store already says done", () => {
  const store = fakeStore({ xp: "100", done: JSON.stringify({ done: true }) });
  const p = new ProgressStore("xp", "done", 20, store);
  assert.equal(p.awardOnce(), 100);
  assert.equal(store.data.xp, "100");
});

test("no awardedKey means no award, just the current total", () => {
  const store = fakeStore({ xp: "5" });
  const p = new ProgressStore("xp", undefined, 20, store);
  assert.equal(p.awardOnce(), 5);
  assert.equal(store.data.xp, "5");
});
