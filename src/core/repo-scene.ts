// The data behind the `repo` scene: one git repository as a stepped explainer.
//
// WHY THIS EXISTS
// The git track teaches an idea (a branch, a merge, a conflict, a reset) with a
// narrated visual BEFORE the learner types the command in a practical lesson.
// The practical already renders a repository with GitGraph; a theory step is the
// same picture, held still, with narration beside it.
//
// So this scene carries no geometry and no drawing of its own - the view hands
// the `RepoState` straight to the existing GitGraph. What lives here is only the
// part a step can get WRONG: which repository to show, and which commits to call
// out. Keeping it pure means a lesson's steps can be checked without a browser.

import type { RepoState } from "./git-model.js";

/** One step of a git explainer. */
export interface RepoScene {
  /** The repository as it stands at this step. */
  state: RepoState;
  /** Commit ids to draw as not-yet-there, for showing what a command WILL do. */
  ghost?: string[];
  /** Commit ids to flag as off the expected path. */
  diverged?: string[];
  /** A short caption under the board, e.g. "main has not moved". */
  note?: string;
}

/** Normalise a raw scene for rendering.
 *
 *  A step that names a commit which is not in the repository is an authoring
 *  slip, and the honest thing is to drop it rather than ask the view to draw a
 *  commit that does not exist - a missing highlight is visible, a thrown error
 *  mid-lesson is not recoverable. `resolveRepo` therefore keeps only the ids the
 *  state actually holds, and is the single place that decision is made. */
export function resolveRepo(scene: RepoScene | undefined): RepoScene | null {
  if (!scene || !scene.state) return null;
  const known = (ids: string[] | undefined): string[] =>
    (ids || []).filter((id) => scene.state.commits.has(id));
  return {
    state: scene.state,
    ghost: known(scene.ghost),
    diverged: known(scene.diverged),
    note: scene.note,
  };
}
