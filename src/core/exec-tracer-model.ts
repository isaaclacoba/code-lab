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
 *  change highlights (hot / hotFields) and the incremental printed output. */
export function traceToSteps(trace: ExecTrace): Step[] {
  const src = trace.code ?? [];
  const steps = trace.steps ?? [];
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

    const step: Step = {
      narr: runningNarration(ts.line, src),
      pc: typeof ts.line === "number" && ts.line > 0 ? ts.line - 1 : -1,
      codeLive: true,
      stack,
      heap,
    };
    if (globals.length) step.globals = globals;
    if (rodata.length) step.rodata = rodata;
    if (printed) step.printed = printed;
    out.push(step);

    prevValues = values;
    prevFields = fields;
    prevGlobals = globalValues;
    prevStdout = stdout;
  });

  // A final snapshot that repeats the end state and says the program is done, so
  // the last real statement keeps its own narration instead of being relabelled
  // (a call on the last line was otherwise never shown). Nothing is hot here and
  // no new output is printed - it is the same picture, one beat later.
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
    const terminal: Step = {
      narr: trace.truncated
        ? "Stopped early - there were too many steps to show the rest."
        : "The program has finished.",
      pc: -1,
      codeLive: true,
      stack,
      heap,
    };
    if (globals.length) terminal.globals = globals;
    if (rodata.length) terminal.rodata = rodata;
    out.push(terminal);
  }

  return out;
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

/** A plain, honest narration for a generated step: the source line being run.
 *  No fabricated teaching prose - the code is the story here. The terminal
 *  "finished" step is added by the caller, so every real step narrates its line. */
function runningNarration(line: number, src: string[]): string {
  const text = typeof line === "number" && line > 0 ? (src[line - 1] ?? "").trim() : "";
  if (!text) return "Running the program.";
  return "Running this line: `" + text + "`";
}
