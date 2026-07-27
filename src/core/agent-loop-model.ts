// DOM-free model for the AI-track "agent loop" scene: the capstone picture where
// the pieces met one at a time - the model, its context, memory, tools - are
// assembled and wrapped in a loop. A step lights up nodes, a loop stage, memory
// rows and tool chips, sets the context chips and the model's current thought,
// and lists the packets to animate along the wires. Pure data + one pure helper
// (agentLoopActiveSet) so the "which nodes are lit" logic is unit-tested without
// a browser, mirroring agent-model / memory-model.

/** The four beats of one turn of the loop. */
export type LoopStage = "perceive" | "reason" | "act" | "observe";

/** The fixed boxes in the scene: the world, the agent's context, the model, its
 *  tools and its memory. */
export type AgentLoopNodeId = "env" | "ctx" | "llm" | "tools" | "mem";

/** The tools the model can reach for. Ids are the values a step's `chips` lights. */
export type AgentLoopToolId = "search" | "calc" | "code";

/** The kinds of long-term memory. Ids are the values a step's `mem` lights. */
export type AgentLoopMemoryId = "episodic" | "semantic" | "procedural";

/** One tool row drawn in the TOOLS box. */
export interface AgentLoopTool {
  id: AgentLoopToolId;
  label: string;
}

/** One row drawn in the MEMORY box: a kind of memory and what it holds. */
export interface AgentLoopMemoryRow {
  id: AgentLoopMemoryId;
  label: string;
  sub: string;
}

/** The tool rows the loop diagram shows, defined once as data so the view renders
 *  them in a loop rather than hardcoding each one in its SVG. */
export const DEFAULT_LOOP_TOOLS: AgentLoopTool[] = [
  { id: "search", label: "search" },
  { id: "calc", label: "calculator" },
  { id: "code", label: "run code" },
];

/** The memory rows the loop diagram shows, defined once as data (see above). */
export const DEFAULT_LOOP_MEMORIES: AgentLoopMemoryRow[] = [
  { id: "episodic", label: "episodic", sub: "what happened" },
  { id: "semantic", label: "semantic", sub: "facts it knows" },
  { id: "procedural", label: "procedural", sub: "how to act" },
];

/** A signal to animate along a named wire when the step is reached going forward. */
export interface AgentLoopPacket {
  /** The wire id (matches a `data-trace` in the view). */
  path: string;
  /** Travel from end to start instead of start to end. */
  reverse?: boolean;
}

/** One snapshot of the agent loop for a step. Everything is optional so early
 *  steps can show just the world, and later steps light the whole loop. */
export interface AgentLoopScene {
  /** Node ids that are lit this step; every other node is dimmed. */
  active?: AgentLoopNodeId[];
  /** The loop stage lit this step, or null for none. */
  stage?: LoopStage | null;
  /** The chips shown inside the context box (what the model can see right now). */
  ctx?: string[];
  /** A short thought shown under the model, e.g. "call search()". */
  think?: string;
  /** The memory row lit this step. */
  mem?: AgentLoopMemoryId | null;
  /** The tool chips lit this step, e.g. ["search"]. */
  chips?: AgentLoopToolId[];
  /** Packets to animate along wires on a forward step. */
  packets?: AgentLoopPacket[];
  /** The goal shown in the environment box (defaults handled by the view). */
  goal?: string;
}

/** The set of node ids lit this step. Pure, so it is unit-tested directly. */
export function agentLoopActiveSet(scene: AgentLoopScene | null | undefined): Set<AgentLoopNodeId> {
  if (!scene || !Array.isArray(scene.active)) return new Set();
  return new Set(scene.active);
}
