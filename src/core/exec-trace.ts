import type { Frame, Slot, Step } from "./memory-model.js";

export type SlotValue = string | null;
export type SlotChangeKind = "created" | "changed" | "unchanged";

export interface SlotChange {
  name: string;
  kind: SlotChangeKind;
  from: SlotValue;
  to: SlotValue;
}

export interface VarHistory {
  name: string;
  values: SlotValue[];
}

// Exceptions and loop boundaries are deferred until the tracer emits that signal.
export type NotableKind = "call" | "return" | "new-object";

export interface Notable {
  step: number;
  kind: NotableKind;
}

export interface DerivedTrace {
  callDepth: number[];
  lineHeatmap: Map<number, number>;
  changes: SlotChange[][];
  valueHistory: VarHistory[];
  notables: Notable[];
}

export function deriveTrace(steps: Step[]): DerivedTrace {
  const callDepth = new Array<number>(steps.length);
  const lineHeatmap = new Map<number, number>();
  const changes = new Array<SlotChange[]>(steps.length);
  const valueHistory: VarHistory[] = [];
  const historiesByName = new Map<string, VarHistory>();
  const notables: Notable[] = [];

  let previousSlots = new Map<string, Slot>();
  let previousDepth = 0;
  let previousHeapIds = new Set<string>();

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const stack = step.stack ?? [];
    const depth = stack.length;
    const currentSlots = slotsByName(activeFrame(stack));

    callDepth[i] = depth;
    if (step.pc != null && step.pc >= 0) {
      lineHeatmap.set(step.pc, (lineHeatmap.get(step.pc) ?? 0) + 1);
    }

    changes[i] = deriveSlotChanges(currentSlots, previousSlots, i === 0);
    extendValueHistory(i, currentSlots, valueHistory, historiesByName);

    const heapIds = heapObjectIds(step);
    if (i > 0) {
      if (depth > previousDepth) notables.push({ step: i, kind: "call" });
      else if (depth < previousDepth) notables.push({ step: i, kind: "return" });
      if (heapSetGrew(previousHeapIds, heapIds)) notables.push({ step: i, kind: "new-object" });
    }

    previousSlots = currentSlots;
    previousDepth = depth;
    previousHeapIds = heapIds;
  }

  return { callDepth, lineHeatmap, changes, valueHistory, notables };
}

function activeFrame(stack: Frame[]): Frame | undefined {
  return stack[stack.length - 1];
}

function slotsByName(frame: Frame | undefined): Map<string, Slot> {
  const slots = new Map<string, Slot>();
  for (const slot of frame?.vars ?? []) {
    slots.set(slotName(slot), slot);
  }
  return slots;
}

function slotName(slot: Slot): string {
  return slot.k ?? slot.id;
}

function slotValue(slot: Slot | undefined): SlotValue {
  if (!slot || slot.empty || slot.v == null) return null;
  return slot.v;
}

function deriveSlotChanges(
  currentSlots: Map<string, Slot>,
  previousSlots: Map<string, Slot>,
  firstStep: boolean,
): SlotChange[] {
  const result: SlotChange[] = [];
  for (const [name, slot] of currentSlots) {
    const previousSlot = firstStep ? undefined : previousSlots.get(name);
    const from = firstStep ? null : slotValue(previousSlot);
    const to = slotValue(slot);
    result.push({ name, kind: changeKind(previousSlot, from, to, firstStep), from, to });
  }
  return result;
}

function changeKind(
  previousSlot: Slot | undefined,
  from: SlotValue,
  to: SlotValue,
  firstStep: boolean,
): SlotChangeKind {
  if (firstStep) return to === null ? "unchanged" : "created";
  if (!previousSlot) return "created";
  if (from === null && to !== null) return "created";
  if (from !== null && from !== to) return "changed";
  return "unchanged";
}

function extendValueHistory(
  stepIndex: number,
  currentSlots: Map<string, Slot>,
  valueHistory: VarHistory[],
  historiesByName: Map<string, VarHistory>,
): void {
  for (const [name] of currentSlots) {
    if (!historiesByName.has(name)) {
      const history = { name, values: Array<SlotValue>(stepIndex).fill(null) };
      historiesByName.set(name, history);
      valueHistory.push(history);
    }
  }

  for (const history of valueHistory) {
    history.values.push(slotValue(currentSlots.get(history.name)));
  }
}

function heapObjectIds(step: Step): Set<string> {
  const ids = new Set<string>();
  for (const obj of step.heap ?? []) {
    ids.add(obj.id);
  }
  return ids;
}

function heapSetGrew(previousIds: Set<string>, currentIds: Set<string>): boolean {
  return currentIds.size > previousIds.size;
}
