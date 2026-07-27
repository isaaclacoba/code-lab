// DOM-free model for the AI-track "agent" scene: the one evolving picture of how
// a language model works - the text so far as a strip of tokens, the model core
// that reads it, and the probability of the next token. Pure data + one pure
// function (agentFanRows) so the choose/dim logic is unit-tested without a
// browser, mirroring how memory-model keeps the stack/heap logic testable.

/** How a token is coloured. `given` is plain text the model reads; `gen` is a
 *  token the model just produced (spotlit, amber). The role kinds (`system`,
 *  `user`, `context`) let later lessons tint a prompt's parts. `dropped` marks a
 *  token that has fallen out of the context window (faded, no longer read). */
export type AgentTokenKind = "given" | "gen" | "system" | "user" | "context" | "dropped";

export interface AgentToken {
  t: string;
  kind?: AgentTokenKind;
  /** Spotlight this token for the current step. */
  hot?: boolean;
}

/** One candidate next token and its probability (0..1). */
export interface AgentCandidate {
  t: string;
  p: number;
}

/** The probability distribution over the next token. */
export interface AgentFan {
  /** Candidates, already in the order they should be shown (usually descending). */
  list: AgentCandidate[];
  /** Index of the token the model picked, or -1/undefined before it has chosen. */
  chosen?: number;
  /** Caption above the fan (defaults handled by the view). */
  caption?: string;
}

/** The model "chip" that reads the text and predicts the next token. */
export interface AgentCore {
  /** Big label, e.g. "LLM". */
  label?: string;
  /** Small sub-label, e.g. "next-token model". */
  sub?: string;
  /** The core is actively scanning this step (animated). */
  live?: boolean;
}

/** A tool the model can ask to run: a function outside itself. The model emits a
 *  `call`; something runs it and hands back a `result`, which then goes into the
 *  context. `state` drives the picture: idle (nothing yet), calling (the request
 *  is on its way out), returned (the answer has come back). */
export interface AgentTool {
  /** The function's name, e.g. "getWeather". */
  name: string;
  /** The call the model emits, e.g. `getWeather("Paris")`. */
  call?: string;
  /** What the tool hands back, e.g. `18\u00b0C`. */
  result?: string;
  /** Where we are in the round-trip. */
  state?: "idle" | "calling" | "returned";
}

/** One snapshot of the AI scene for a step. Everything is optional so a lesson
 *  can show only the parts it needs (just the strip, or the strip + a fan). */
export interface AgentScene {
  /** Caption above the token strip. */
  stripCaption?: string;
  /** The text so far, as tokens. */
  tokens?: AgentToken[];
  /** Show a blinking caret after the tokens (the next slot to be filled). */
  caret?: boolean;
  /** The model core. */
  core?: AgentCore;
  /** The next-token probabilities, or null/absent to hide the fan. */
  fan?: AgentFan | null;
  /** A tool round-trip to draw beside the model (the call it emits and the
   *  result that comes back). Absent/null hides the tool card. */
  tool?: AgentTool | null;
  /** Label for the divider drawn where `dropped` tokens end and in-window tokens
   *  begin (the edge of the context window). Defaults to "context window". */
  windowLabel?: string;
}

/** A fan candidate turned into a view row: an integer percentage, whether it is
 *  the chosen one, and whether it should be dimmed (something else was chosen). */
export interface FanRow {
  t: string;
  pct: number;
  chosen: boolean;
  dim: boolean;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Turn a fan's raw probabilities into rows to render: percentages rounded to
 *  whole numbers, the chosen row flagged, and every other row dimmed once a
 *  choice has been made. Pure, so it is unit-tested directly. */
export function agentFanRows(fan: AgentFan | null | undefined): FanRow[] {
  if (!fan || !Array.isArray(fan.list)) return [];
  const chosen = typeof fan.chosen === "number" ? fan.chosen : -1;
  const hasChoice = chosen >= 0 && chosen < fan.list.length;
  return fan.list.map((c, i) => ({
    t: c.t,
    pct: Math.round(clamp01(c.p) * 100),
    chosen: hasChoice && i === chosen,
    dim: hasChoice && i !== chosen,
  }));
}
