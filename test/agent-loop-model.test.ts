import { test } from "node:test";
import assert from "node:assert/strict";
import { agentLoopActiveSet } from "../src/core/agent-loop-model.ts";

test("no scene yields an empty active set", () => {
  assert.equal(agentLoopActiveSet(null).size, 0);
  assert.equal(agentLoopActiveSet(undefined).size, 0);
  assert.equal(agentLoopActiveSet({}).size, 0);
});

test("active list becomes a set of node ids", () => {
  const set = agentLoopActiveSet({ active: ["llm", "tools"] });
  assert.ok(set.has("llm"));
  assert.ok(set.has("tools"));
  assert.ok(!set.has("mem"));
  assert.equal(set.size, 2);
});

test("duplicate ids collapse in the set", () => {
  const set = agentLoopActiveSet({ active: ["ctx", "ctx", "llm"] });
  assert.equal(set.size, 2);
});
