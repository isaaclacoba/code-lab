// DOM-free model for the MemoryViz component. Pure data + pure functions so the
// stack/heap/reference/GC logic can be unit-tested without a browser.
//
// A lesson supplies a MemoryVizConfig (code + a step script + optional actions).
// Reference arrows are DERIVED from whatever a slot holds, and any heap object
// nothing points to is dimmed - so lifetime/GC behaviour emerges from just
// pushing and popping frames instead of being hand-authored per step.

import type { CodeMark } from "./code-marks.js";
export type { CodeMark } from "./code-marks.js";
import type { AgentScene } from "./agent-model.js";
export type { AgentScene } from "./agent-model.js";
import type { AgentLoopScene } from "./agent-loop-model.js";
export type { AgentLoopScene } from "./agent-loop-model.js";
import type { MemoryShelfScene } from "./memory-shelf-model.js";
export type { MemoryShelfScene } from "./memory-shelf-model.js";
import type { ToolRackScene } from "./tool-rack-model.js";
export type { ToolRackScene } from "./tool-rack-model.js";
import type { TranscriptScene } from "./transcript-model.js";
export type { TranscriptScene } from "./transcript-model.js";
import type { RetrievalScene } from "./retrieval-model.js";
export type { RetrievalScene } from "./retrieval-model.js";
import type { PlanScene } from "./planboard-model.js";
export type { PlanScene } from "./planboard-model.js";
import type { RepoScene } from "./repo-scene.js";
export type { RepoScene } from "./repo-scene.js";

export interface Slot {
  id: string;
  addr?: string;
  k?: string;
  v?: string;
  /** Heap object id this slot points to (makes it a reference). */
  ref?: string;
  empty?: boolean;
  /** Spotlight this slot - e.g. a bit that just flipped or a value that changed. */
  hot?: boolean;
}

export interface Frame {
  id: string;
  name?: string;
  vars: Slot[];
  /** Colour-code this frame (e.g. tie a process to the core running it). */
  accent?: string;
  /** What kind of call this frame is: "entry", "method", "static" or "ctor".
   *  Shown as a small badge so a call reads as what it is. */
  kind?: string;
  /** For an instance call, the object it runs on (e.g. "Cart #1"), shown under
   *  the frame name so several instances of one type stay tellable apart. */
  recv?: string;
  /** The 1-based source line this frame is currently paused on. On a caller
   *  waiting for a callee, this is its call site (shown as "paused at line N"). */
  line?: number;
}

export interface GlobalSlot {
  id: string;
  k: string;
  v: string;
  hot?: boolean;
}

export interface HeapObject {
  id: string;
  type: string;
  fields: Array<[string, string]>;
  dim?: boolean;
  glow?: boolean;
  /** Location label shown after the type (default "heap", e.g. "disk"). */
  at?: string;
  /** A per-type instance number, shown as "#1" after the type, so two objects of
   *  the same type are tellable apart. */
  no?: number;
  /** Field names (keys) to spotlight - e.g. one whose value just changed. */
  hotFields?: string[];
}

export interface Ref {
  from: string;
  to: string;
}

/** A signal travelling along a named copper trace on the board. */
export interface Packet {
  path: string;
  reverse?: boolean;
  color?: string;
  dur?: number;
}

/** A named board component that a step can spotlight. */
export type BoardPart = "ufs" | "soc" | "ram" | "gpio";

/** Anything a step's `highlight` can spotlight: a board component or a memory
 *  region in the die. Board and die each pick out the targets they own. */
export type HighlightTarget = BoardPart | RegionName;

/** A CPU core lit persistently, optionally tinted to match the process it runs. */
export interface CoreLight {
  i: number;
  color?: string;
}

/** One snapshot of the machine + memory, plus its narration. */
export interface Step {
  narr: string;
  /** Highlighted source line (0-based); negative or undefined = none. */
  pc?: number;
  instr?: string;
  ram?: boolean;
  load?: boolean;
  codeLive?: boolean;
  /** Replace the code panel's lines for this step (e.g. show a broken then fixed
   *  version, or source then compiled output). Defaults to the config's `code`. */
  code?: string[];
  /** Spotlight part of a code line - a statement, sub-expression or operator. */
  codeMark?: CodeMark | CodeMark[];
  core?: number;
  /** Cores lit persistently (e.g. to contrast one-core sharing vs two-core parallelism). */
  cores?: CoreLight[];
  led?: boolean;
  glow?: string;
  /** Board component(s) or memory region(s) to spotlight while this step shows. */
  highlight?: HighlightTarget | HighlightTarget[];
  packets?: Packet[];
  globals?: GlobalSlot[];
  /** Read-only constants region. */
  rodata?: GlobalSlot[];
  /** Initialized globals/statics. */
  data?: GlobalSlot[];
  /** Zero-initialized globals/statics. */
  bss?: GlobalSlot[];
  /** Memory-mapped region (e.g. shared libraries). */
  mmap?: GlobalSlot[];
  stack?: Frame[];
  heap?: HeapObject[];
  /** Only used when deriveRefs is disabled. */
  refs?: Ref[];
  /** AI-track scene for this step (the token strip, model core and next-token
   *  fan). Rendered by an `agent` panel; ignored by the memory panels. */
  agent?: AgentScene;
  /** AI-track "agent loop" scene for this step (the assembled agent: model,
   *  context, memory, tools, and the loop). Rendered by an `agentloop` panel. */
  agentLoop?: AgentLoopScene;
  /** AI-track "memory shelf" scene: working memory over the episodic/semantic/
   *  procedural stores. Rendered by a `memoryshelf` panel. */
  memoryShelf?: MemoryShelfScene;
  /** AI-track "tool rack" scene: several tools with schemas, a call, and a
   *  result or an error. Rendered by a `toolrack` panel. */
  toolRack?: ToolRackScene;
  /** AI-track "transcript" scene: the growing list of role-tagged messages the
   *  model re-reads on every call. Rendered by a `transcript` panel. */
  transcript?: TranscriptScene;
  /** AI-track "retrieval" scene: a query, a store of document chunks with
   *  similarity scores, and the grounded answer. Rendered by a `retrieval` panel. */
  retrieval?: RetrievalScene;
  /** AI-track "planboard" scene: a goal decomposed into ordered, stateful steps.
   *  Rendered by a `planboard` panel. */
  plan?: PlanScene;
  /** For a `repo` panel: the git repository this step shows. */
  repo?: RepoScene;
  /** Incremental console output produced by THIS step (the delta since the
   *  previous step). Additive: set by the generated-trace adapter; the
   *  hand-authored scenes omit it, and panels that do not render output ignore
   *  it. */
  printed?: string;
  /** Cumulative console output up to and including this step, so a `console`
   *  panel can show the whole transcript at any step (including after a back or
   *  seek) without accumulating state itself; the freshly printed tail equals
   *  `printed`. Set by the generated-trace adapter. */
  output?: string;
}

/** An interactive verb: transforms the live model and returns the next one. */
export interface VizAction {
  label: string;
  once?: boolean;
  apply(model: Step): Step;
}

/** The memory areas of a running process, in low-to-high address order. `code`
 *  (text), `rodata`, `data`, `bss` and `mmap` are read-as slot lists; `stack`
 *  and `heap` have their own shapes. `global` is a friendly alias that stands in
 *  for data + bss when a lesson does not want to split them. */
export type RegionName =
  | "code"
  | "rodata"
  | "data"
  | "bss"
  | "global"
  | "heap"
  | "stack"
  | "mmap";

/** Which parts of the visualiser a lesson shows. Adding a new scene type (bits,
 *  pipeline, network, ...) means a new view + a new branch in the facade; the
 *  existing views are untouched (open/closed). */
export interface MemoryScene {
  type?: "memory";
  /** Show the hardware board (UFS/SoC/GPIO/traces). Default true. */
  board?: boolean;
  /** Which RAM-die regions to show, in order. Default all four. */
  regions?: RegionName[];
  /** Show the "zoom into the chip" caption. Default true. */
  zoomTab?: boolean;
}

export const ALL_REGIONS: RegionName[] = ["code", "global", "stack", "heap"];

/** The full, accurate process memory layout, low-to-high address order. */
export const FULL_REGIONS: RegionName[] = ["code", "rodata", "data", "bss", "heap", "stack", "mmap"];

/** A composable panel a lesson can place in the layout. New panel types (bits,
 *  pipeline, network, a code editor merged from CodeLab, ...) extend this union
 *  and get a factory in the facade; existing panels are untouched (open/closed). */
export type PanelType = "board" | "die" | "code" | "vartable" | "callstack" | "heapcards" | "narration" | "controls" | "console" | "agent" | "agentloop" | "memoryshelf" | "toolrack" | "transcript" | "retrieval" | "planboard" | "repo";

export interface PanelSpec {
  type: PanelType;
  /** For a die panel: which regions it shows (defaults to the scene's regions). */
  regions?: RegionName[];
  /** For an agent panel: whether to render the next-token probability area.
   *  Defaults to true. Set false for lessons that never show probabilities. */
  fan?: boolean;
}

/** Injectable arrangement: which panels go in the main (visual) column and which
 *  in the side reading rail. Omit to get a sensible default from the scene. */
export interface VizLayout {
  visual?: PanelSpec[];
  aside?: PanelSpec[];
}

/** One swatch + label in the controls legend. `round` draws a dot (a signal or
 *  reference) instead of a square (a region). */
export interface LegendItem {
  sw: string;
  label: string;
  round?: boolean;
}

/** Every hardcoded English chrome string the MemoryViz views render: the
 *  transport controls, the font-size control, the transcript author tags and the
 *  tool-rack direction words. Overridable for i18n; any omitted key keeps the
 *  English default. Glyphs (arrows, "Aa", S/M/L) stay in the view, not here. */
export interface VizLabels {
  /** VizControls transport buttons + scrubber. */
  prev: string;
  play: string;
  pause: string;
  next: string;
  /** The final "next" button when a nextHref is set and the last step is reached. */
  nextLesson: string;
  reset: string;
  step: string;
  /** Font-size control group + its S/M/L buttons. */
  textSize: string;
  textSmall: string;
  textDefault: string;
  textLarge: string;
  /** TranscriptView author tags - the honest "who wrote this line". */
  authorYou: string;
  authorApp: string;
  authorModel: string;
  authorCode: string;
  /** ToolRackView I/O direction words (arrows added by the view). */
  toolCall: string;
  toolError: string;
  toolResult: string;
  /** AgentView fan caption - the next-token probability panel's heading. */
  fanCaption: string;
}

/** English defaults for every VizLabels string. A widget built with no `labels`
 *  renders exactly these, so the default language stays byte-identical. */
export const DEFAULT_VIZ_LABELS: VizLabels = {
  prev: "\u25c0 Prev",
  play: "\u25b6 Play",
  pause: "\u23f8 Pause",
  next: "Next \u25b6",
  // Byte-identical with the pre-i18n end button (was "Next"); the course catalog
  // supplies a distinct "Next lesson" string on i18n pages via `labels`.
  nextLesson: "Next \u25b6",
  reset: "Reset",
  step: "Step",
  textSize: "Text size",
  textSmall: "Small text",
  textDefault: "Default text",
  textLarge: "Large text",
  authorYou: "you wrote this",
  authorApp: "your app wrote this",
  authorModel: "the model wrote this",
  authorCode: "your code wrote this",
  toolCall: "call \u2192",
  toolError: "\u2190 error",
  toolResult: "\u2190 result",
  fanCaption: "Probability of the next token",
};

export interface MemoryVizConfig {
  code: string[];
  steps: Step[];
  actions?: VizAction[];
  /** Derive arrows from slot refs (default true) rather than explicit step.refs. */
  deriveRefs?: boolean;
  /** Dim heap objects nothing points to (default true). */
  autoDim?: boolean;
  /** What to show. Defaults to the full board + all four regions. */
  scene?: MemoryScene;
  /** Explicit panel arrangement. Overrides the scene-derived default layout. */
  layout?: VizLayout;
  /** Replace the controls legend (defaults to the memory/hardware legend). Pass
   *  a scene-appropriate legend - e.g. token colours for the AI track. */
  legend?: LegendItem[];
  /** Override a die region's header tag (e.g. relabel STACK as "Processes in RAM"). */
  regionTags?: Partial<Record<RegionName, string>>;
  /** URL the final "next" button navigates to (the next lesson in the part). */
  nextHref?: string;
  /** Label for the final "next" button when the last step is reached
   *  (default "Next"). The host can supply its own wording. */
  nextLabel?: string;
  /** Overridable chrome strings for i18n (transport, font control, transcript
   *  author tags, tool-rack directions). Any omitted key falls back to English. */
  labels?: Partial<VizLabels>;
  /** Called whenever the tracked XP changes (after awarding on the last step),
   *  so the host can reflect it in its own UI. The widget owns no XP label. */
  onXpChange?: (xp: number) => void;
  /** Called after each step is rendered with the current program-counter line
   *  and position, so a host can mirror the running line elsewhere (e.g. its
   *  own editor). `pc` is the 0-based source line, or -1 when there is none. */
  onStep?: (info: { pc: number; index: number; total: number }) => void;
  /** CSS background for the whole widget (switch the backdrop entirely). */
  background?: string;
  /** Starting text scale (1 = default). The viewer can still adjust it live. */
  fontScale?: number;
  /** Progress: localStorage key marked done, and XP granted, when the learner
   *  reaches the last step. Omit to track no progress for this lesson. */
  awardedKey?: string;
  xpKey?: string;
  awardAmount?: number;
  /** Board chip labels (all optional; sensible defaults). */
  chipName?: string;
  chipAddr?: string;
}

export interface ResolvedModel extends Step {
  refs: Ref[];
  heap: HeapObject[];
}

/** Every reference implied by the slots currently on the stack. */
export function deriveRefs(stack: Frame[] = []): Ref[] {
  const refs: Ref[] = [];
  for (const frame of stack) {
    for (const slot of frame.vars ?? []) {
      if (slot.ref) refs.push({ from: slot.id, to: slot.ref });
    }
  }
  return refs;
}

export function referencedIds(refs: Ref[]): Set<string> {
  return new Set(refs.map((r) => r.to));
}

/** How a slot reads at level 2. A `ref` points to a heap object (draw an arrow);
 *  a slot whose value is exactly "null" is an explicit null reference (no arrow,
 *  shown in red); an `empty` slot is declared-but-unassigned; everything else is
 *  a value shown inline. Pure so the projection is unit-tested without a browser. */
export type SlotKind = "empty" | "null" | "ref" | "value";

export function slotKind(slot: Slot): SlotKind {
  if (slot.empty) return "empty";
  if (slot.ref) return "ref";
  if (slot.v === "null") return "null";
  return "value";
}

/** Turn a raw step into a fully-resolved model: arrows computed and unreferenced
 *  heap objects dimmed, according to the config flags. Pure. */
export function resolveModel(
  step: Step,
  opts: { deriveRefs: boolean; autoDim: boolean },
): ResolvedModel {
  const stack = step.stack ?? [];
  const refs = opts.deriveRefs ? deriveRefs(stack) : step.refs ?? [];
  const referenced = referencedIds(refs);
  const heap = (step.heap ?? []).map((o) => ({
    ...o,
    dim: opts.autoDim ? !referenced.has(o.id) : Boolean(o.dim),
  }));
  return { ...step, stack, refs, heap };
}

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
