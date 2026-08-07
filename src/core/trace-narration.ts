// The sentences `traceToSteps` writes under each step of a traced program.
//
// These captions are GENERATED, not authored: the adapter diffs one step against
// the last and says what changed. That is why they cannot live in a lesson's
// string bundle the way ordinary prose does - there is no card to put them on.
// This module is the seam that makes them translatable anyway: the templates come
// out of the code and into one overridable table, with English as the default so
// every existing caller keeps rendering exactly what it rendered before.
//
// Slots are `{name}`, filled by `fill()` from `./template.js`. An override that
// drops a slot is refused there rather than shipping a sentence with the value
// missing from it.

import { mergeTemplates } from "./template.js";
import type { TemplateIssue } from "./template.js";

/** Every generated caption, as an overridable template.
 *
 *  Backticks around a name or value are part of the template on purpose: the
 *  narration panel renders them as inline code, and a translation that keeps the
 *  backticks keeps that formatting. */
export interface TraceNarration {
  /** A call pushed a frame. */
  entered: string;
  calledCtor: string;
  calledOn: string;
  called: string;
  /** A frame was popped. */
  ctorFinishedBack: string;
  ctorFinished: string;
  returnedTo: string;
  returned: string;
  /** Something reached the console. */
  printed: string;
  printedBlank: string;
  /** An object was allocated. `setToNew` is the common `Cat c = new Cat();`
   *  shape, where the allocation and the assignment happen on one line. */
  setToNew: string;
  createdNumbered: string;
  created: string;
  /** A local, or a static, changed. */
  pointedAt: string;
  setTo: string;
  /** Nothing structural was detectable, so the caption falls back to the line. */
  runningLine: string;
  running: string;
  /** The closing beat after the last statement. */
  finishedPrintedOne: string;
  finishedPrintedMany: string;
  finishedNoPrint: string;
  truncated: string;
  /** The label for a reference whose target is not in the current heap. */
  anObject: string;
}

/** English defaults. Byte-identical to the captions the adapter emitted before
 *  the templates were extracted, so a caller that passes no narration sees no
 *  change at all. */
export const DEFAULT_TRACE_NARRATION: TraceNarration = {
  entered: "Entered `{name}`",
  calledCtor: "Called the `{type}` constructor",
  calledOn: "Called `{method}` on `{recv}`",
  called: "Called `{method}`",
  ctorFinishedBack: "The `{type}` constructor finished - back in `{caller}`",
  ctorFinished: "The `{type}` constructor finished",
  returnedTo: "`{method}` returned to `{caller}`",
  returned: "`{method}` returned",
  printed: "Printed `{text}`",
  printedBlank: "Printed a blank line",
  setToNew: "Set `{name}` to a new `{type}`",
  createdNumbered: "Created a `{type}` (`{label}`)",
  created: "Created a `{type}`",
  pointedAt: "Pointed `{name}` at `{label}`",
  setTo: "Set `{name}` to `{value}`",
  runningLine: "Running this line: `{line}`",
  running: "Running the program.",
  // Singular and plural are separate templates rather than one string with an
  // "s" glued on: not every language pluralises by adding a letter, and the
  // English original had the suffix baked into the sentence.
  finishedPrintedOne: "The program finished. It printed {n} line.",
  finishedPrintedMany: "The program finished. It printed {n} lines.",
  finishedNoPrint: "The program finished without printing anything.",
  truncated: "Stopped early - there were too many steps to show the rest.",
  anObject: "an object",
};

/** Merge caller templates onto the English defaults, refusing any that dropped a
 *  slot. `issues` names what was refused; it is empty for a complete set. */
export function resolveNarration(
  overrides?: Partial<TraceNarration>,
): { narration: TraceNarration; issues: TemplateIssue[] } {
  const { merged, issues } = mergeTemplates(DEFAULT_TRACE_NARRATION, overrides);
  return { narration: merged, issues };
}
