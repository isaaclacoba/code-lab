import type { CompileError, RunResult } from "../types.js";

// Pure presentation logic: given a run result, decide what text to show, whether
// it is an error, and which inline markers to set. No DOM, no labels rendering -
// just the decision tree, so it can be unit-tested directly.

export interface RunPresentation {
  text: string;
  isError: boolean;
  markers: CompileError[];
}

export interface PresentLabels {
  noOutput: string;
}

/** The code a runner should execute: the explicit compilable twin when given,
 *  otherwise the current editor value. */
export function selectRunCode(
  runCode: string | undefined,
  editorValue: string,
): string {
  return runCode ?? editorValue;
}

/** Map a successful RunResult to display text + markers. Order of precedence:
 *  compile errors, then a runtime error, then normal output. */
export function presentRun(
  result: RunResult,
  labels: PresentLabels,
): RunPresentation {
  if (result.errors && result.errors.length) {
    return {
      text: result.errors.map((e) => e.friendly || e.raw).join("\n"),
      isError: true,
      markers: result.errors,
    };
  }
  if (result.runtimeError) {
    return {
      text: `${result.output}\n${result.runtimeError}`.trim(),
      isError: true,
      markers: [],
    };
  }
  return {
    text: result.output || labels.noOutput,
    isError: false,
    markers: [],
  };
}
