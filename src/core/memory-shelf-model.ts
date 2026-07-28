// DOM-free model for the AI-track "memory shelf" scene: how a real agent splits
// memory into kinds. The intro lesson (ai-6) treated memory as one box; this
// scene shows working memory - the context read right now - fed by three
// long-term stores: episodic (what happened), semantic (facts that stay true)
// and procedural (how to do things). Pure data + pure functions so the resolve
// logic is unit-tested without a browser, mirroring agent-model / agent-loop-model.

/** The three long-term stores an agent keeps outside the context window. Working
 *  memory is modelled separately - it is the context strip, not a store. */
export type MemoryKind = "episodic" | "semantic" | "procedural";

/** One remembered item, shown as a chip in a store or the working strip. */
export interface ShelfItem {
  text: string;
  /** Spotlight this item this step (e.g. just saved, or just recalled). */
  hot?: boolean;
}

/** Fixed metadata for a store: its heading and the one-line question it answers.
 *  Kept as data so the view never hard-codes the taxonomy. */
export interface MemoryStoreMeta {
  id: MemoryKind;
  name: string;
  blurb: string;
}

/** The stores, in the order the shelf shows them - the single source of truth for
 *  the taxonomy (open/closed: add a kind here and both the model and the view
 *  follow, without either being edited by hand). */
export const DEFAULT_MEMORY_STORES: MemoryStoreMeta[] = [
  { id: "episodic", name: "Episodic", blurb: "what happened before" },
  { id: "semantic", name: "Semantic", blurb: "facts that stay true" },
  { id: "procedural", name: "Procedural", blurb: "how to do things" },
];

/** One snapshot of the shelf for a step. Everything is optional so a step can
 *  show just the strip, just one store, or the whole shelf. */
export interface MemoryShelfScene {
  /** Contents of the working-memory strip - the context the model reads now. */
  working?: ShelfItem[];
  /** Caption above the working strip. */
  workingCaption?: string;
  /** Spotlight the working strip this step. */
  workingActive?: boolean;
  /** Items held in each long-term store, keyed by kind. */
  stores?: Partial<Record<MemoryKind, ShelfItem[]>>;
  /** Which store(s) to spotlight this step. */
  active?: MemoryKind | MemoryKind[];
}

/** A store resolved for rendering: its metadata, its items, and whether it is lit. */
export interface ResolvedStore {
  meta: MemoryStoreMeta;
  items: ShelfItem[];
  active: boolean;
}

/** Normalize the scene's `active` field to a set of kinds. Pure. */
export function activeStores(scene: MemoryShelfScene | null | undefined): Set<MemoryKind> {
  if (!scene || scene.active == null) return new Set();
  const list = Array.isArray(scene.active) ? scene.active : [scene.active];
  return new Set(list);
}

/** Resolve every store, in shelf order, to { meta, items, active }. Pure, so the
 *  view stays a thin renderer and the choose/spotlight logic is unit-tested. */
export function shelfStores(
  scene: MemoryShelfScene | null | undefined,
  stores: MemoryStoreMeta[] = DEFAULT_MEMORY_STORES,
): ResolvedStore[] {
  const active = activeStores(scene);
  const byKind = scene?.stores ?? {};
  return stores.map((meta) => ({
    meta,
    items: byKind[meta.id] ?? [],
    active: active.has(meta.id),
  }));
}
