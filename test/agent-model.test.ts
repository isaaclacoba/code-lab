import { test } from "node:test";
import assert from "node:assert/strict";
import { agentFanRows } from "../src/core/agent-model.ts";

test("no fan yields no rows", () => {
  assert.deepEqual(agentFanRows(null), []);
  assert.deepEqual(agentFanRows(undefined), []);
  assert.deepEqual(agentFanRows({ list: [] }), []);
});

test("probabilities become whole-number percentages", () => {
  const rows = agentFanRows({
    list: [
      { t: "mat", p: 0.61 },
      { t: "floor", p: 0.14 },
      { t: "roof", p: 0.041 },
    ],
  });
  assert.deepEqual(
    rows.map((r) => [r.t, r.pct]),
    [
      ["mat", 61],
      ["floor", 14],
      ["roof", 4],
    ],
  );
});

test("no choice made: nothing chosen, nothing dimmed", () => {
  const rows = agentFanRows({ list: [{ t: "a", p: 0.5 }, { t: "b", p: 0.5 }] });
  assert.ok(rows.every((r) => !r.chosen && !r.dim));
});

test("a choice flags one row and dims the rest", () => {
  const rows = agentFanRows({
    list: [{ t: "a", p: 0.6 }, { t: "b", p: 0.3 }, { t: "c", p: 0.1 }],
    chosen: 0,
  });
  assert.deepEqual(rows.map((r) => r.chosen), [true, false, false]);
  assert.deepEqual(rows.map((r) => r.dim), [false, true, true]);
});

test("an out-of-range chosen index dims nothing (no phantom choice)", () => {
  const rows = agentFanRows({ list: [{ t: "a", p: 1 }], chosen: 5 });
  assert.ok(rows.every((r) => !r.chosen && !r.dim));
});

test("probabilities are clamped to 0..1 and non-finite becomes 0", () => {
  const rows = agentFanRows({
    list: [
      { t: "hi", p: 1.4 },
      { t: "lo", p: -0.3 },
      { t: "nan", p: Number.NaN },
    ],
  });
  assert.deepEqual(rows.map((r) => r.pct), [100, 0, 0]);
});
