import { test } from "node:test";
import assert from "node:assert/strict";
import { traceToSteps } from "../src/core/exec-tracer-model.ts";
import type { ExecTrace } from "../src/core/exec-tracer-model.ts";

const CODE = ["int a = 1;", "int b = 2;", "int t = a + b;", 'Console.WriteLine(t);'];

function frame(vars: Array<[string, string]>) {
  return { id: "main", name: "Main", vars: vars.map(([name, value]) => ({ name, value })) };
}

test("maps line to a 0-based pc and keeps the source", () => {
  const trace: ExecTrace = {
    code: CODE,
    steps: [{ line: 1, frames: [frame([["a", "1"]])] }],
  };
  const steps = traceToSteps(trace);
  assert.equal(steps.length, 2); // the one statement, plus a terminal "finished" step
  assert.equal(steps[0].pc, 0);
  assert.equal(steps[0].codeLive, true);
  assert.equal(steps[1].narr, "The program has finished.");
  assert.equal(steps[1].pc, -1); // no line highlighted once the program is done
});

test("value locals become value slots with stable ids", () => {
  const trace: ExecTrace = { code: CODE, steps: [{ line: 1, frames: [frame([["a", "1"]])] }] };
  const slot = traceToSteps(trace)[0].stack![0].vars[0];
  assert.equal(slot.id, "main:a");
  assert.equal(slot.k, "a");
  assert.equal(slot.v, "1");
  assert.equal(slot.ref, undefined);
});

test("a changed value is hot; an unchanged one is not; the first step is never hot", () => {
  const trace: ExecTrace = {
    code: CODE,
    steps: [
      { line: 1, frames: [frame([["a", "1"], ["b", "2"]])] },
      { line: 2, frames: [frame([["a", "1"], ["b", "9"]])] },
    ],
  };
  const steps = traceToSteps(trace);
  // first step: nothing hot
  assert.equal(steps[0].stack![0].vars.every((v) => !v.hot), true);
  // second step: only b changed
  const [a, b] = steps[1].stack![0].vars;
  assert.equal(a.hot, false);
  assert.equal(b.hot, true);
});

test("a newly appearing local is hot (created this step)", () => {
  const trace: ExecTrace = {
    code: CODE,
    steps: [
      { line: 1, frames: [frame([["a", "1"]])] },
      { line: 2, frames: [frame([["a", "1"], ["b", "2"]])] },
    ],
  };
  const b = traceToSteps(trace)[1].stack![0].vars[1];
  assert.equal(b.k, "b");
  assert.equal(b.hot, true);
});

test("a reference local becomes a ref slot, and null is a value", () => {
  const trace: ExecTrace = {
    code: ["Dog pet = new Dog();", "Dog stray = null;"],
    steps: [
      {
        line: 1,
        frames: [{ id: "main", name: "Main", vars: [{ name: "pet", ref: "o1" }, { name: "stray", value: "null" }] }],
        heap: [{ id: "o1", type: "Dog", fields: [["Name", '"Rex"']] }],
      },
    ],
  };
  const [pet, stray] = traceToSteps(trace)[0].stack![0].vars;
  assert.equal(pet.ref, "o1");
  assert.equal(pet.v, undefined);
  assert.equal(stray.ref, undefined);
  assert.equal(stray.v, "null");
});

test("a re-pointed reference is hot", () => {
  const mk = (ref: string): ExecTrace["steps"][number] => ({
    line: 1,
    frames: [{ id: "main", name: "Main", vars: [{ name: "pet", ref }] }],
    heap: [{ id: ref, type: "Dog", fields: [] }],
  });
  const steps = traceToSteps({ code: [], steps: [mk("o1"), mk("o2")] });
  assert.equal(steps[1].stack![0].vars[0].hot, true);
});

test("heap objects map through, and a changed field is hot", () => {
  const mk = (name: string): ExecTrace["steps"][number] => ({
    line: 1,
    frames: [{ id: "main", name: "Main", vars: [{ name: "pet", ref: "o1" }] }],
    heap: [{ id: "o1", type: "Dog", fields: [["Name", name], ["Age", "3"]] }],
  });
  const steps = traceToSteps({ code: [], steps: [mk('"Rex"'), mk('"Fido"')] });
  const obj0 = steps[0].heap![0];
  assert.equal(obj0.type, "Dog");
  assert.deepEqual(obj0.hotFields, []); // first step
  const obj1 = steps[1].heap![0];
  assert.deepEqual(obj1.hotFields, ["Name"]); // only Name changed
});

test("incremental printed output is the delta of cumulative stdout", () => {
  const trace: ExecTrace = {
    code: [],
    steps: [
      { line: 1, frames: [frame([])], stdout: "" },
      { line: 2, frames: [frame([])], stdout: "hello\n" },
      { line: 3, frames: [frame([])], stdout: "hello\nworld\n" },
    ],
  };
  const steps = traceToSteps(trace);
  assert.equal(steps[0].printed, undefined);
  assert.equal(steps[1].printed, "hello\n");
  assert.equal(steps[2].printed, "world\n");
});

test("every real step narrates its own line; a terminal step says finished", () => {
  const trace: ExecTrace = {
    code: CODE,
    steps: [
      { line: 3, frames: [frame([])] },
      { line: 4, frames: [frame([])] },
    ],
  };
  const steps = traceToSteps(trace);
  assert.equal(steps.length, 3); // two statements, plus the terminal step
  assert.match(steps[0].narr, /int t = a \+ b;/);
  assert.match(steps[1].narr, /Console\.WriteLine\(t\);/); // the last line keeps its narration
  assert.equal(steps[2].narr, "The program has finished.");
  assert.equal(steps[2].pc, -1);
});

test("a truncated trace ends with a stopped-early note, not finished", () => {
  const trace: ExecTrace = {
    code: CODE,
    steps: [{ line: 1, frames: [frame([["a", "1"]])] }],
    truncated: true,
  };
  const steps = traceToSteps(trace);
  assert.match(steps[steps.length - 1].narr, /Stopped early/);
});

test("a frame carries its call kind and instance receiver through", () => {
  const trace: ExecTrace = {
    code: [],
    steps: [
      {
        line: 1,
        frames: [
          { id: "f1", name: "Main", kind: "entry", vars: [] },
          { id: "f2", name: "Total", kind: "method", recv: "Cart #1", vars: [] },
        ],
      },
    ],
  };
  const stack = traceToSteps(trace)[0].stack!;
  assert.equal(stack[0].kind, "entry");
  assert.equal(stack[0].recv, undefined); // no receiver on a static entry point
  assert.equal(stack[1].kind, "method");
  assert.equal(stack[1].recv, "Cart #1");
});

test("a heap object carries its per-type instance number through", () => {
  const trace: ExecTrace = {
    code: [],
    steps: [
      {
        line: 1,
        frames: [frame([])],
        heap: [
          { id: "o1", type: "Clock", no: 1, fields: [["_hour", "9"]] },
          { id: "o2", type: "Clock", no: 2, fields: [["_hour", "15"]] },
        ],
      },
    ],
  };
  const heap = traceToSteps(trace)[0].heap!;
  assert.equal(heap[0].no, 1);
  assert.equal(heap[1].no, 2);
});

test("an empty trace yields no steps", () => {
  assert.deepEqual(traceToSteps({ code: [], steps: [] }), []);
});
