// The outcome VizLab hands to its `onTrace` hook after every Visualize press,
// plus the pure classifier that builds it. DOM-free and in core/ so the part a
// course grades against is unit-testable without a compiler host or a browser.
//
// A grader has to tell four failures apart from a clean run, because "the
// learner's code is wrong" and "the code never ran" are different verdicts and
// only one of them should leave a goal red without an explanation. The code may
// not have compiled, it may have thrown partway, it may have hit the step budget,
// or the tracer itself may have failed to load - that last one is not the
// learner's fault at all. `status` names the disposition; `trace` carries the
// frames, heap and stdout the gate vocabulary reads whenever a trace exists.

import type { ExecTrace } from "./exec-tracer-model.js";
import type { CompileError } from "../types.js";

/** How a single Visualize press turned out.
 *  - "traced": compiled and ran to the end - the case worth grading.
 *  - "threw": ran but threw before finishing; `trace` holds what ran up to the
 *    throw and `runtimeError` the message.
 *  - "budget": hit the tracer's step budget and stopped early; `trace` is a
 *    partial run and `truncated` is true.
 *  - "empty": compiled but produced no steps to show (e.g. an empty `Main`).
 *  - "did-not-compile": never ran; `errors` explains why.
 *  - "failed": the tracer could not be reached or timed out. Nothing can be
 *    concluded about the learner's code from this one. */
export type VizTraceStatus =
  | "traced"
  | "threw"
  | "budget"
  | "empty"
  | "did-not-compile"
  | "failed";

/** The full picture of one Visualize press. `trace` is present whenever the code
 *  compiled and produced steps, so a grader can read `TraceFrame.kind`/`recv`,
 *  `TraceObject.no`/`fields` and `TraceStep.stdout` off it.
 *
 *  `truncated` and `runtimeError` sit alongside `status` rather than being folded
 *  into it, so a run that both threw AND was cut short is not misreported by a
 *  single label. */
export interface VizTraceOutcome {
  status: VizTraceStatus;
  /** The execution trace, whenever the code compiled and produced steps. */
  trace?: ExecTrace;
  /** True when the run hit the step budget and stopped early. Always true for
   *  `status: "budget"`, and also readable on a "threw" run that was cut short. */
  truncated: boolean;
  /** The runtime error text when the program threw. */
  runtimeError?: string;
  /** Compile errors for `status: "did-not-compile"`; empty otherwise. */
  errors: CompileError[];
  /** Why the tracer itself failed, for `status: "failed"`. Developer English from
   *  the throw site - a UI should show its own wording, not this. */
  failure?: string;
}

/** A runner trace result, narrowed to what the classifier reads. Structurally the
 *  runner's `TraceOutcome`, restated here so this core module does not import the
 *  runner - and so a test can build one without a browser. */
export interface RunnerTraceResult {
  compiled: boolean;
  trace?: ExecTrace;
  runtimeError?: string | null;
  errors?: CompileError[];
}

/** Classify a runner result into the outcome VizLab reports to `onTrace`. Pure
 *  and total: every result maps to exactly one status, and no signal is dropped. */
export function classifyTraceOutcome(result: RunnerTraceResult): VizTraceOutcome {
  if (!result.compiled) {
    return { status: "did-not-compile", truncated: false, errors: result.errors ?? [] };
  }
  const trace = result.trace;
  const truncated = trace?.truncated === true;
  const runtimeError = result.runtimeError ?? undefined;
  if (!trace || (trace.steps?.length ?? 0) === 0) {
    const empty: VizTraceOutcome = { status: "empty", truncated, errors: [] };
    if (trace) empty.trace = trace;
    if (runtimeError) empty.runtimeError = runtimeError;
    return empty;
  }
  // A throw is the more specific verdict than a budget cut, so it takes the
  // label; `truncated` still tells a grader the run was also stopped short.
  const status: VizTraceStatus = runtimeError ? "threw" : truncated ? "budget" : "traced";
  const outcome: VizTraceOutcome = { status, trace, truncated, errors: [] };
  if (runtimeError) outcome.runtimeError = runtimeError;
  return outcome;
}

/** The outcome for a Visualize press that never reached a verdict - the tracer
 *  timed out or could not load. Separate from `classifyTraceOutcome` because
 *  there is no result to classify. */
export function tracerFailedOutcome(message: string): VizTraceOutcome {
  return { status: "failed", truncated: false, errors: [], failure: message };
}
