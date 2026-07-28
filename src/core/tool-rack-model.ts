// DOM-free model for the AI-track "tool rack" scene: how an agent works with more
// than one tool. The intro lesson (ai-7) showed a single tool on the happy path;
// this scene shows several tools, each described by a schema (name + typed
// parameters), the agent choosing one, the structured call it emits, and the
// result - or an error it must read and recover from. Pure data + one pure
// function so the signature formatting is unit-tested without a browser.

/** Where a tool card sits in the round-trip, driving its colour:
 *  idle (available), chosen (picked for this task), calling (request on its way),
 *  error (the call came back with an error), returned (a result came back). */
export type ToolState = "idle" | "chosen" | "calling" | "error" | "returned";

/** One typed parameter in a tool's schema, e.g. { name: "city", type: "text" }. */
export interface ToolParam {
  name: string;
  type: string;
}

/** A tool the agent can call, described by its schema. */
export interface RackTool {
  /** The function name, e.g. "getWeather". */
  name: string;
  /** One line saying what the tool is for - what the model matches against. */
  desc?: string;
  /** The typed parameters the tool takes (its schema). */
  params?: ToolParam[];
  /** This tool's state this step (defaults to idle). */
  state?: ToolState;
}

/** One snapshot of the rack for a step. */
export interface ToolRackScene {
  /** Caption above the rack. */
  caption?: string;
  /** The tools on the rack, in display order. */
  tools?: RackTool[];
  /** The call the model emits this step, e.g. `getWeather(city: "Oslo")`. */
  call?: string;
  /** The result that came back - a success. */
  result?: string;
  /** An error that came back instead of a result. */
  error?: string;
}

/** Build a tool's schema signature from its name and typed parameters, e.g.
 *  `getWeather(city: text, day: text)`. A tool with no parameters reads `name()`.
 *  Pure, so it is unit-tested directly and the view stays a thin renderer. */
export function formatToolSignature(tool: RackTool): string {
  const params = tool.params ?? [];
  const inner = params.map((p) => `${p.name}: ${p.type}`).join(", ");
  return `${tool.name}(${inner})`;
}

/** A tool resolved for rendering: its signature, description and state, in
 *  display order. */
export interface ResolvedRackTool {
  name: string;
  signature: string;
  desc?: string;
  state: ToolState;
}

/** Resolve every tool on the rack: compute its signature and default its state
 *  to idle, in display order. Pure, so the view stays a thin renderer and the
 *  defaulting is unit-tested (mirrors shelfStores in the memory-shelf scene). */
export function resolveRackTools(scene: ToolRackScene | null | undefined): ResolvedRackTool[] {
  const tools = scene?.tools ?? [];
  return tools.map((tool) => ({
    name: tool.name,
    signature: formatToolSignature(tool),
    desc: tool.desc,
    state: tool.state ?? "idle",
  }));
}

/** The kinds of row shown in a tool's input/output area. */
export type ToolIoKind = "call" | "error" | "result";

/** One row in the input/output area: the call out, or the outcome back. */
export interface ToolIoRow {
  kind: ToolIoKind;
  text: string;
}

/** Resolve which I/O rows to show, in order: the call the model emits (if any),
 *  then the outcome - an error takes precedence over a result, because a failed
 *  call returns an error instead of a result. Pure, so this precedence is a
 *  unit-tested rule in the model rather than a branch buried in the view. */
export function toolRackRows(scene: ToolRackScene | null | undefined): ToolIoRow[] {
  const rows: ToolIoRow[] = [];
  if (!scene) return rows;
  if (scene.call) rows.push({ kind: "call", text: scene.call });
  if (scene.error) rows.push({ kind: "error", text: scene.error });
  else if (scene.result) rows.push({ kind: "result", text: scene.result });
  return rows;
}
