import { test } from "node:test";
import assert from "node:assert/strict";
import { CommandHistory } from "../src/terminal/history.ts";

test("CommandHistory keeps entries in order and skips blanks and repeats", () => {
  const hist = new CommandHistory();
  hist.push("one");
  hist.push("one");
  hist.push("  ");
  hist.push("two");
  assert.deepEqual([...hist.entries], ["one", "two"]);
});

test("CommandHistory drops the oldest entry past its limit", () => {
  const hist = new CommandHistory(2);
  hist.push("a");
  hist.push("b");
  hist.push("c");
  assert.deepEqual([...hist.entries], ["b", "c"]);
});

test("CommandHistory returns null at both ends of the walk", () => {
  const hist = new CommandHistory();
  assert.equal(hist.prev("draft"), null);
  assert.equal(hist.next(), null);
  hist.push("a");
  assert.equal(hist.prev("draft"), "a");
  assert.equal(hist.prev("draft"), null);
  assert.equal(hist.next(), "draft");
  assert.equal(hist.next(), null);
});

test("CommandHistory pushing resets the walk position", () => {
  const hist = new CommandHistory();
  hist.push("a");
  hist.push("b");
  hist.prev("");
  hist.push("c");
  assert.equal(hist.prev(""), "c");
});
