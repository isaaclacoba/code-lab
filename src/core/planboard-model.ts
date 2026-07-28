// DOM-free model for the AI-track "planboard" scene: how an agent turns one big
// goal into a plan it can act on (task decomposition). Rather than trying to do
// everything in a single leap, the model writes an ordered list of smaller steps,
// then works down it - marking each done as it goes, and sometimes re-planning
// when a step is blocked. Pure data + one pure resolver so the numbering and the
// progress count are unit-tested without a browser, mirroring the other scenes.

/** Where a plan step sits this step, driving its colour:
 *  pending (not started), active (being worked on now), done (finished),
 *  blocked (could not be completed - a signal to re-plan). */
export type PlanState = "pending" | "active" | "done" | "blocked";

/** One step in the plan. */
export interface PlanStep {
  /** What this step does, e.g. "search flights for the travel dates". */
  text: string;
  /** This step's state this step of the walkthrough (defaults to pending). */
  state?: PlanState;
  /** A short aside under the step, e.g. a result or a reason it is blocked. */
  note?: string;
}

/** One snapshot of the planboard for a step. */
export interface PlanScene {
  /** Caption above the board. */
  caption?: string;
  /** The overall goal the plan serves, shown at the top. */
  goal?: string;
  /** The ordered steps of the plan. */
  steps?: PlanStep[];
}

/** A plan step resolved for rendering: a 1-based number, its text, state, and
 *  optional note, in order. */
export interface ResolvedPlanStep {
  /** 1-based position in the plan. */
  n: number;
  text: string;
  state: PlanState;
  note?: string;
}

/** Resolve every step: number it from 1 and default its state to pending, in
 *  order. Pure, so the view stays a thin renderer and the numbering is a
 *  unit-tested rule (mirrors resolveRackTools / resolveTranscript). */
export function resolvePlan(scene: PlanScene | null | undefined): ResolvedPlanStep[] {
  const steps = scene?.steps ?? [];
  return steps.map((step, i) => ({
    n: i + 1,
    text: step.text,
    state: step.state ?? "pending",
    note: step.note,
  }));
}

/** How far the plan has progressed: how many steps are done out of the total.
 *  Exposed so a lesson (or a test) can show "2 / 4 done" without walking the
 *  list itself. Pure. */
export function planProgress(scene: PlanScene | null | undefined): { done: number; total: number } {
  const steps = resolvePlan(scene);
  return { done: steps.filter((s) => s.state === "done").length, total: steps.length };
}
