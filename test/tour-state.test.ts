import { test } from "node:test";
import assert from "node:assert/strict";
import {
  atFirst,
  atLast,
  counterLabel,
  goTo,
  makeTour,
  next,
  prev,
} from "../src/core/tour-state.ts";

test("makeTour clamps the starting index into range", () => {
  assert.equal(makeTour(3, 9).index, 2);
  assert.equal(makeTour(3, -2).index, 0);
});

test("makeTour guards a zero/negative count", () => {
  const m = makeTour(-1);
  assert.equal(m.count, 0);
  assert.equal(m.index, 0);
});

test("goTo ignores out-of-range requests by returning the same model", () => {
  const m = makeTour(3, 1);
  assert.equal(goTo(m, -1), m);
  assert.equal(goTo(m, 3), m);
  assert.equal(goTo(m, 2).index, 2);
});

test("next and prev move within bounds and stop at the edges", () => {
  let m = makeTour(3, 0);
  assert.ok(atFirst(m));
  m = next(m);
  assert.equal(m.index, 1);
  m = next(m);
  assert.equal(m.index, 2);
  assert.ok(atLast(m));
  assert.equal(next(m).index, 2);
  m = prev(m);
  assert.equal(m.index, 1);
});

test("atFirst and atLast are both true for an empty tour", () => {
  const m = makeTour(0);
  assert.ok(atFirst(m));
  assert.ok(atLast(m));
});

test("counterLabel is 1-based", () => {
  assert.equal(counterLabel(makeTour(5, 0)), "1 / 5");
  assert.equal(counterLabel(makeTour(5, 4)), "5 / 5");
});
