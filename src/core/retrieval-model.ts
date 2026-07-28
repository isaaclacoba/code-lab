// DOM-free model for the AI-track "retrieval" scene: how an agent grounds an
// answer in outside knowledge it was never trained on (retrieval-augmented
// generation, RAG). A query is turned into a vector (an embedding); every
// document chunk in the store has one too; the ones whose vectors sit closest to
// the query - the highest similarity - are pulled into the context so the model
// answers from real text instead of guessing. Pure data + one pure resolver so
// the score formatting and defaulting are unit-tested without a browser,
// mirroring tool-rack-model and transcript-model.

/** Where a document chunk sits this step, driving its colour:
 *  idle (in the store, not yet scored), match (retrieved - closest to the query),
 *  dim (scored but not retrieved this step). */
export type DocState = "idle" | "match" | "dim";

/** One document chunk in the store. */
export interface RetrievalDoc {
  /** The chunk of text (a fact the model may not know on its own). */
  text: string;
  /** Similarity to the query, 0..1 - how close the two vectors sit. Omit before
   *  the query is embedded; set it to draw a bar. */
  score?: number;
  /** This chunk's state this step (defaults to idle). */
  state?: DocState;
}

/** One snapshot of the retrieval scene for a step. */
export interface RetrievalScene {
  /** Caption above the scene. */
  caption?: string;
  /** Label above the query chip (defaults to "query"). */
  queryLabel?: string;
  /** The query being embedded and matched, e.g. "what is Luna's return policy?". */
  query?: string;
  /** The document chunks in the store, in display order. */
  docs?: RetrievalDoc[];
  /** Label above the answer box (defaults to "grounded answer"). */
  answerLabel?: string;
  /** The answer the model writes once the retrieved chunks are in its context. */
  answer?: string;
}

/** A document resolved for rendering: its text, state, and score as both a
 *  clamped 0..1 value and a whole percentage (or null before it is scored). */
export interface ResolvedDoc {
  text: string;
  state: DocState;
  score: number | null;
  scorePct: number | null;
}

/** Clamp a raw similarity into 0..1 so a stray value never overflows the bar. */
function clampScore(score: number | undefined): number | null {
  if (typeof score !== "number" || Number.isNaN(score)) return null;
  return Math.max(0, Math.min(1, score));
}

/** Resolve every chunk: clamp its score, derive a whole-percent label, and
 *  default its state to idle, in display order. Pure, so the view stays a thin
 *  renderer and the maths is unit-tested (mirrors resolveRackTools). */
export function resolveRetrieval(scene: RetrievalScene | null | undefined): ResolvedDoc[] {
  const docs = scene?.docs ?? [];
  return docs.map((doc) => {
    const score = clampScore(doc.score);
    return {
      text: doc.text,
      state: doc.state ?? "idle",
      score,
      scorePct: score === null ? null : Math.round(score * 100),
    };
  });
}
