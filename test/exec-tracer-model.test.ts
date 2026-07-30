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
  assert.match(steps[1].narr, /finished/i);
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
  // Cumulative output rides along for the console panel: full transcript per step.
  assert.equal(steps[0].output, undefined);
  assert.equal(steps[1].output, "hello\n");
  assert.equal(steps[2].output, "hello\nworld\n");
  // The appended terminal snapshot keeps the whole transcript (nothing new).
  assert.equal(steps[3].output, "hello\nworld\n");
  assert.equal(steps[3].printed, undefined);
});

test("a step with no detectable change falls back to the source line; a terminal step summarizes", () => {
  const trace: ExecTrace = {
    code: CODE,
    steps: [
      { line: 3, frames: [frame([])] },
      { line: 4, frames: [frame([])] },
    ],
  };
  const steps = traceToSteps(trace);
  assert.equal(steps.length, 3); // two statements, plus the terminal step
  assert.match(steps[1].narr, /Console\.WriteLine\(t\);/); // no effect to describe -> echo the line
  assert.match(steps[2].narr, /finished/i);
  assert.equal(steps[2].pc, -1);
});

test("effect-based captions: call, return, print, create, and set", () => {
  const mainEntry = (vars: Array<{ name: string; value?: string; ref?: string }>) => ({
    id: "f1",
    name: "Main",
    kind: "entry",
    vars,
  });
  const cat = { id: "o1", type: "Cat", no: 1, fields: [] as Array<[string, string]> };
  const trace: ExecTrace = {
    code: [
      "static void Main() {",
      "  Cat c = new Cat();",
      "  Console.WriteLine(c.Speak());",
      "}",
      "string Speak() {",
      '  return "Meow";',
      "}",
    ],
    steps: [
      { line: 2, frames: [mainEntry([])] }, // Main entered
      { line: 2, frames: [mainEntry([{ name: "c", ref: "o1" }])], heap: [cat] }, // c = new Cat()
      {
        line: 6,
        frames: [mainEntry([{ name: "c", ref: "o1" }]), { id: "f2", name: "Speak", kind: "method", recv: "Cat #1", vars: [] }],
        heap: [cat],
      }, // call Speak (the collapsed single snapshot for the one-line method)
      // The WriteLine snapshot: Speak has returned (stack shrank) AND the text is
      // now printed - both happen at once. The pop headlines the caption; the
      // console panel shows the printed line, so nothing is lost.
      { line: 3, frames: [mainEntry([{ name: "c", ref: "o1" }])], heap: [cat], stdout: "Meow\n" },
    ],
  };
  const steps = traceToSteps(trace);
  assert.equal(steps[0].narr, "Entered `Main`");
  assert.equal(steps[1].narr, "Set `c` to a new `Cat`");
  assert.equal(steps[2].narr, "Called `Speak()` on `Cat #1`");
  assert.equal(steps[3].narr, "`Speak()` returned to `Main`");
  assert.equal(steps[3].printed, "Meow\n"); // the print still rides along for the console panel
  assert.equal(steps[4].narr, "The program finished. It printed 1 line.");
});

test("a direct Console.WriteLine reads as Printed x", () => {
  const trace: ExecTrace = {
    code: ['Console.WriteLine("Hi");'],
    steps: [
      { line: 1, frames: [{ id: "f1", name: "Main", kind: "entry", vars: [] }] },
      { line: 1, frames: [{ id: "f1", name: "Main", kind: "entry", vars: [] }], stdout: "Hi\n" },
    ],
  };
  const steps = traceToSteps(trace);
  assert.equal(steps[1].narr, "Printed `Hi`");
});

test("a plain value assignment reads as Set x to v", () => {
  const trace: ExecTrace = {
    code: CODE,
    steps: [
      { line: 1, frames: [frame([["a", "1"]])] },
      { line: 2, frames: [frame([["a", "1"], ["b", "2"]])] },
    ],
  };
  const steps = traceToSteps(trace);
  assert.equal(steps[1].narr, "Set `b` to `2`");
});

test("re-pointing a reference reads as Pointed x at Type #n", () => {
  const trace: ExecTrace = {
    code: ["Dog pet = a;", "pet = b;"],
    steps: [
      {
        line: 1,
        frames: [{ id: "main", name: "Main", vars: [{ name: "pet", ref: "o1" }] }],
        heap: [
          { id: "o1", type: "Dog", no: 1, fields: [] },
          { id: "o2", type: "Dog", no: 2, fields: [] },
        ],
      },
      {
        line: 2,
        frames: [{ id: "main", name: "Main", vars: [{ name: "pet", ref: "o2" }] }],
        heap: [
          { id: "o1", type: "Dog", no: 1, fields: [] },
          { id: "o2", type: "Dog", no: 2, fields: [] },
        ],
      },
    ],
  };
  const steps = traceToSteps(trace);
  assert.equal(steps[1].narr, "Pointed `pet` at `Dog #2`");
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
          { id: "f1", name: "Main", kind: "entry", line: 36, vars: [] },
          { id: "f2", name: "Total", kind: "method", recv: "Cart #1", line: 14, vars: [] },
        ],
      },
    ],
  };
  const stack = traceToSteps(trace)[0].stack!;
  assert.equal(stack[0].kind, "entry");
  assert.equal(stack[0].recv, undefined); // no receiver on a static entry point
  assert.equal(stack[0].line, 36); // the caller's call-site line comes through
  assert.equal(stack[1].kind, "method");
  assert.equal(stack[1].recv, "Cart #1");
  assert.equal(stack[1].line, 14);
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

test("a call's redundant entry snapshot is collapsed into its first statement", () => {
  // Main (depth 1) calls Speak (depth 2). The tracer emits the callee's entry
  // snapshot on the same line as its first statement, so that line would show
  // twice; the entry is dropped and the frame appears together with its body.
  const mainFr = { id: "f1", name: "Main", kind: "entry", vars: [] as { name: string; value?: string }[] };
  const speakFr = { id: "f2", name: "Speak", kind: "method", vars: [] as { name: string; value?: string }[] };
  const trace: ExecTrace = {
    code: ["class C {", "  string Speak() {", '    return "Meow";', "  }", "}"],
    steps: [
      { line: 1, frames: [mainFr] },
      { line: 3, frames: [mainFr, speakFr] }, // Speak entry snapshot
      { line: 3, frames: [mainFr, speakFr] }, // first statement runs (same line)
      { line: 1, frames: [mainFr] }, // back in Main after the call returns
    ],
  };
  const steps = traceToSteps(trace);
  // 4 raw steps - 1 collapsed entry + 1 terminal = 4 rendered steps.
  assert.equal(steps.length, 4);
  // The two same-line depth-2 steps became one.
  const speakSteps = steps.filter((s) => s.stack!.length === 2);
  assert.equal(speakSteps.length, 1);
  // The stack still grows into Speak at that surviving step.
  assert.equal(speakSteps[0].stack![1].name, "Speak");
  assert.equal(speakSteps[0].pc, 2); // line 3, 0-based
});

test("Main's own entry is kept, and two same-line statements in one frame are not merged", () => {
  const mainFr = (vars: Array<[string, string]>) => ({
    id: "f1",
    name: "Main",
    vars: vars.map(([name, value]) => ({ name, value })),
  });
  const trace: ExecTrace = {
    code: ["int a = 1; int b = 2;"], // two statements authored on one line
    steps: [
      { line: 1, frames: [mainFr([["a", "1"]])] }, // Main entry (no caller before it)
      { line: 1, frames: [mainFr([["a", "1"], ["b", "2"]])] }, // second statement, same line, same frame
    ],
  };
  const steps = traceToSteps(trace);
  // Neither step is dropped (no push between them, and step 0 is Main's entry):
  // two real statements plus the terminal step.
  assert.equal(steps.length, 3);
  assert.equal(steps[1].stack![0].vars[1].hot, true); // b still shows as newly set
});
