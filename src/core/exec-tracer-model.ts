// The wire contract for a GENERATED execution trace, plus a pure adapter that
// maps it onto the same Step[] the hand-authored MemoryViz scenes use. A tracer
// (a Roslyn source-instrumentation pass in the compiler-host) emits, per
// statement, the current line, the call stack of frames with their locals, the
// live heap objects, and the cumulative console output. That is deliberately
// close to Step, so a generated trace drives the SAME renderer - no second
// widget, no second data model.
//
// "Animate only what changed" is derived here, not by the tracer: the adapter
// diffs each step against the one before it and marks changed/created slots and
// heap fields hot, and computes the incremental (delta) console output.

import type { Frame, GlobalSlot, HeapObject, Slot, Step } from "./memory-model.js";
import { fill } from "./template.js";
import { resolveNarration } from "./trace-narration.js";
import type { TraceNarration } from "./trace-narration.js";

/** One local (or parameter) in a frame. A value type carries `value`; a
 *  reference type carries `ref` (the id of a heap object) - never both. A
 *  reference to nothing has `value: "null"` and no `ref`. */
export interface TraceVar {
  name: string;
  value?: string;
  ref?: string;
}

/** One call frame. `id` is stable for the life of the call (so the adapter can
 *  tell a frame that stayed from one pushed this step). `name` is the method
 *  label shown on the card. Frames are listed caller-first (bottom of stack
 *  first), matching the Step.stack convention. */
export interface TraceFrame {
  id: string;
  name: string;
  /** What kind of call this frame is: "entry" (Main), "method" (instance),
   *  "static" (static method), or "ctor" (a constructor). Drives the badge. */
  kind?: string;
  /** For an instance call, the object it runs on, e.g. "Cart #1" - a hint so
   *  several instances of one type stay tellable apart. Absent for static calls. */
  recv?: string;
  /** The 1-based source line this frame is currently paused on. For a caller
   *  waiting on a callee, this is its call site. */
  line?: number;
  vars: TraceVar[];
}

/** One heap object. `id` is stable for the life of the allocation. `fields` is
 *  an ordered list of name/value pairs (values already stringified). */
export interface TraceObject {
  id: string;
  type: string;
  /** A per-type instance number ("Cart #1", "Cart #2") shown on the card so two
   *  objects of the same type are tellable apart. */
  no?: number;
  fields: Array<[string, string]>;
}

export interface TraceStatic {
  owner?: string;
  name: string;
  value: string;
}

/** One executed statement: the line about to run (1-based), the stack, the live
 *  heap, and the cumulative stdout so far. Cumulative (not incremental) stdout
 *  keeps the tracer trivial; the adapter derives the per-step delta. */
export interface TraceStep {
  line: number;
  frames: TraceFrame[];
  heap?: TraceObject[];
  statics?: TraceStatic[];
  consts?: TraceStatic[];
  stdout?: string;
}

/** A whole generated trace: the source lines and the executed steps. `truncated`
 *  is set when the tracer hit its step budget (e.g. a long loop) and stopped. */
export interface ExecTrace {
  code: string[];
  steps: TraceStep[];
  truncated?: boolean;
}

/** Turn a generated trace into MemoryViz steps. Pure: no DOM, unit-testable.
 *  The mapping is 1:1 on structure; the only computed parts are the per-step
 *  change highlights (hot / hotFields) and the incremental printed output.
 *
 *  `narration` translates the generated captions. Omit it for English; a partial
 *  set keeps the English default for every key it does not carry, and an override
 *  that drops a `{slot}` is refused rather than rendered without its value. */
export function traceToSteps(trace: ExecTrace, narration?: Partial<TraceNarration>): Step[] {
  const t = resolveNarration(narration).narration;
  const src = trace.code ?? [];
  const steps = collapseCallEntries(trace.steps ?? []);
  const out: Step[] = [];
  let prevValues = new Map<string, string>();
  let prevFields = new Map<string, string>();
  let prevGlobals = new Map<string, string>();
  let prevStdout = "";

  steps.forEach((ts, i) => {
    const values = new Map<string, string>();
    const stack: Frame[] = (ts.frames ?? []).map((f) =>
      frameToFrame(f, values, prevValues, i === 0),
    );

    const fields = new Map<string, string>();
    const heap: HeapObject[] = (ts.heap ?? []).map((o) =>
      objectToObject(o, fields, prevFields, i === 0),
    );
    const globalValues = new Map<string, string>();
    const globals = globalSlots(ts.statics ?? [], globalValues, prevGlobals, i === 0);
    const rodata = globalSlots(ts.consts ?? []);

    const stdout = ts.stdout ?? "";
    const printed = stdout.startsWith(prevStdout) ? stdout.slice(prevStdout.length) : stdout;

    const prevFrames = i > 0 ? steps[i - 1].frames ?? [] : [];
    const prevHeapIds = new Set((i > 0 ? steps[i - 1].heap ?? [] : []).map((o) => o.id));

    const step: Step = {
      narr: describeStep(prevFrames, ts, stack, heap, prevHeapIds, globals, printed, src, t),
      pc: typeof ts.line === "number" && ts.line > 0 ? ts.line - 1 : -1,
      codeLive: true,
      stack,
      heap,
    };
    if (globals.length) step.globals = globals;
    if (rodata.length) step.rodata = rodata;
    if (printed) step.printed = printed;
    if (stdout) step.output = stdout;
    out.push(step);

    prevValues = values;
    prevFields = fields;
    prevGlobals = globalValues;
    prevStdout = stdout;
  });

  // A final snapshot that repeats the end state and closes the run. The last
  // real statement keeps its own caption (a call on the last line was otherwise
  // never shown), and this beat states plainly that the program is over and how
  // much it printed - which reads together with the console panel below it.
  // Nothing is hot here and no new output is printed - it is the same picture,
  // one beat later.
  const lastTs = steps[steps.length - 1];
  if (lastTs) {
    const values = new Map<string, string>();
    const stack: Frame[] = (lastTs.frames ?? []).map((f) =>
      frameToFrame(f, values, prevValues, false),
    );
    const fields = new Map<string, string>();
    const heap: HeapObject[] = (lastTs.heap ?? []).map((o) =>
      objectToObject(o, fields, prevFields, false),
    );
    const globals = globalSlots(lastTs.statics ?? [], new Map<string, string>(), prevGlobals, false);
    const rodata = globalSlots(lastTs.consts ?? []);
    const printedLines = prevStdout ? prevStdout.replace(/\n+$/, "").split("\n").length : 0;
    const terminal: Step = {
      narr: trace.truncated
        ? t.truncated
        : printedLines > 0
          ? fill(printedLines === 1 ? t.finishedPrintedOne : t.finishedPrintedMany, { n: printedLines })
          : t.finishedNoPrint,
      pc: -1,
      codeLive: true,
      stack,
      heap,
    };
    if (globals.length) terminal.globals = globals;
    if (rodata.length) terminal.rodata = rodata;
    if (prevStdout) terminal.output = prevStdout;
    out.push(terminal);
  }

  return out;
}

/** A call's entry snapshot lands on the first statement's line (the tracer's
 *  Enter records the fresh frame at `FirstBodyLine`), so every method or
 *  constructor call shows that line twice in a row: once the instant the frame
 *  is pushed, then again as the first statement runs. For a one-line method those
 *  are the only two steps for the frame, and the repeat is pure noise - you click
 *  Next and nothing moves. Drop the entry snapshot when the very next step is the
 *  same line in the same freshly pushed frame. The stack still visibly grows at
 *  the surviving step (its depth is one deeper than the caller's), so the "a call
 *  pushes a frame" beat is kept - it just happens together with the first
 *  statement instead of one dead click earlier. The first step (Main's own entry,
 *  which has no caller before it) is never dropped, so a trace still starts in
 *  Main. */
function collapseCallEntries(steps: TraceStep[]): TraceStep[] {
  const drop = new Set<number>();
  for (let i = 1; i + 1 < steps.length; i++) {
    const prev = steps[i - 1];
    const cur = steps[i];
    const next = steps[i + 1];
    const curLen = cur.frames?.length ?? 0;
    const pushed = curLen > (prev.frames?.length ?? 0);
    if (!pushed) continue;
    if (cur.line !== next.line) continue;
    if (curLen !== (next.frames?.length ?? 0)) continue;
    const curTop = cur.frames?.[curLen - 1];
    const nextTop = next.frames?.[curLen - 1];
    if (!curTop || !nextTop || curTop.id !== nextTop.id) continue;
    drop.add(i);
  }
  return drop.size ? steps.filter((_, i) => !drop.has(i)) : steps;
}

function frameToFrame(
  f: TraceFrame,
  values: Map<string, string>,
  prevValues: Map<string, string>,
  firstStep: boolean,
): Frame {
  const vars: Slot[] = (f.vars ?? []).map((v) => {
    const id = `${f.id}:${v.name}`;
    const display = v.ref != null ? refDisplay(v) : v.value ?? "";
    values.set(id, display);
    const hot = !firstStep && prevValues.get(id) !== display;
    const slot: Slot = { id, k: v.name, hot };
    if (v.ref != null) slot.ref = v.ref;
    else slot.v = v.value ?? "";
    return slot;
  });
  const frame: Frame = { id: f.id, name: f.name, vars };
  if (f.kind) frame.kind = f.kind;
  if (f.recv) frame.recv = f.recv;
  if (typeof f.line === "number") frame.line = f.line;
  return frame;
}

function objectToObject(
  o: TraceObject,
  fields: Map<string, string>,
  prevFields: Map<string, string>,
  firstStep: boolean,
): HeapObject {
  const hotFields: string[] = [];
  (o.fields ?? []).forEach(([name, value]) => {
    const key = `${o.id}:${name}`;
    fields.set(key, value);
    if (!firstStep && prevFields.get(key) !== value) hotFields.push(name);
  });
  const obj: HeapObject = { id: o.id, type: o.type, fields: o.fields ?? [], hotFields };
  if (typeof o.no === "number") obj.no = o.no;
  return obj;
}

function globalSlots(
  globals: TraceStatic[],
  values?: Map<string, string>,
  prevValues?: Map<string, string>,
  firstStep = false,
): GlobalSlot[] {
  return (globals ?? []).map((g) => {
    const owner = g.owner ?? "";
    const id = `${owner}.${g.name}`;
    const v = g.value ?? "";
    values?.set(id, v);
    const slot: GlobalSlot = {
      id,
      k: owner ? `${owner}.${g.name}` : g.name,
      v,
    };
    if (prevValues && !firstStep && prevValues.get(id) !== v) slot.hot = true;
    return slot;
  });
}

/** A slot that changed is "hot" whether its value or its target changed. For a
 *  reference the comparable display is the target id (or "null"). */
function refDisplay(v: TraceVar): string {
  return v.ref != null ? `\u2192${v.ref}` : v.value ?? "null";
}

/** A caption that says what a step DID, derived from the same diff that drives
 *  the highlights - no AI, no fabricated prose. Picks the single most salient
 *  event for the step: a call was made or returned, a value was printed, an
 *  object was created, or a variable changed. When nothing structural is
 *  detectable it falls back to the source line. This makes the caption carry its
 *  own weight instead of echoing the line the editor already highlights. */
function describeStep(
  prevFrames: TraceFrame[],
  ts: TraceStep,
  stack: Frame[],
  heap: HeapObject[],
  prevHeapIds: Set<string>,
  globals: GlobalSlot[],
  printed: string,
  src: string[],
  t: TraceNarration,
): string {
  const curFrames = ts.frames ?? [];
  const prevLen = prevFrames.length;
  const curLen = curFrames.length;

  // A call pushed a frame (its first statement runs together with the push after
  // the redundant entry snapshot is collapsed).
  if (curLen > prevLen) return callNarration(curFrames[curLen - 1], t);
  // A call returned - a frame was popped.
  if (curLen < prevLen) return returnNarration(prevFrames[prevLen - 1], curFrames[curLen - 1], t);

  // Something was written to the console.
  if (printed) return printedNarration(printed, t);

  const topFrame = stack[stack.length - 1];
  const hotSlot = topFrame ? topFrame.vars.find((v) => v.hot) : undefined;
  const created = heap.find((o) => !prevHeapIds.has(o.id));

  // A local was set to a freshly created object, e.g. `Cat c = new Cat();`.
  if (created && hotSlot && hotSlot.ref != null && hotSlot.ref === created.id) {
    return fill(t.setToNew, { name: hotSlot.k ?? "", type: created.type });
  }
  if (created) {
    const label = typeof created.no === "number" ? `${created.type} #${created.no}` : created.type;
    return typeof created.no === "number"
      ? fill(t.createdNumbered, { type: created.type, label })
      : fill(t.created, { type: created.type });
  }
  // A local changed value or was pointed at a different object.
  if (hotSlot) {
    if (hotSlot.ref != null)
      return fill(t.pointedAt, { name: hotSlot.k ?? "", label: heapLabel(hotSlot.ref, heap, t) });
    return fill(t.setTo, { name: hotSlot.k ?? "", value: hotSlot.v ?? "" });
  }
  // A static / field-like global changed.
  const g = globals.find((s) => s.hot);
  if (g) return fill(t.setTo, { name: g.k, value: g.v });

  return runningNarration(ts.line, src, t);
}

/** "Called `Speak()` on `Cat #1`" / "Entered `Main`" / "Called the `Clock`
 *  constructor". The "on X" only appears for an instance call, so a static call
 *  reads differently from a method call without a separate badge in the text. */
function callNarration(top: TraceFrame, t: TraceNarration): string {
  if (top.kind === "entry") return fill(t.entered, { name: top.name || "Main" });
  if (top.kind === "ctor") {
    const type = (top.name || "").replace(/^new\s+/, "") || "object";
    return fill(t.calledCtor, { type });
  }
  const m = methodLabel(top);
  return top.recv ? fill(t.calledOn, { method: m, recv: top.recv }) : fill(t.called, { method: m });
}

/** "`Speak()` returned to `Main`" / "The `Clock` constructor finished". */
function returnNarration(left: TraceFrame, back: TraceFrame | undefined, t: TraceNarration): string {
  const backName = back ? back.name : null;
  if (left.kind === "ctor") {
    const type = (left.name || "").replace(/^new\s+/, "") || "object";
    return backName ? fill(t.ctorFinishedBack, { type, caller: backName }) : fill(t.ctorFinished, { type });
  }
  const m = methodLabel(left);
  return backName ? fill(t.returnedTo, { method: m, caller: backName }) : fill(t.returned, { method: m });
}

function methodLabel(f: TraceFrame): string {
  const name = f.name || "?";
  return name.endsWith(")") ? name : name + "()";
}

/** "Printed `Meow`" - the fresh line, without the trailing newline, first line
 *  only if several were printed at once. */
function printedNarration(printed: string, t: TraceNarration): string {
  const parts = printed.replace(/\n+$/, "").split("\n");
  const first = (parts[0] ?? "").replace(/`/g, "");
  if (first === "") return t.printedBlank;
  const shown = parts.length > 1 ? first + " \u2026" : first;
  return fill(t.printed, { text: shown });
}

/** The card label for the object a reference points at, e.g. "Cat #1". */
function heapLabel(ref: string, heap: HeapObject[], t: TraceNarration): string {
  const o = heap.find((h) => h.id === ref);
  if (!o) return t.anObject;
  return typeof o.no === "number" ? `${o.type} #${o.no}` : o.type;
}

/** A plain fallback when no structural change is detectable for a step: the
 *  source line being run. */
function runningNarration(line: number, src: string[], t: TraceNarration): string {
  const text = typeof line === "number" && line > 0 ? (src[line - 1] ?? "").trim() : "";
  if (!text) return t.running;
  return fill(t.runningLine, { line: text });
}
