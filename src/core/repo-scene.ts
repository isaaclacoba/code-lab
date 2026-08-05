// The data behind the `repo` scene: one git repository as a stepped explainer.
//
// WHY THIS EXISTS
// The git track teaches an idea (a branch, a merge, a conflict, a reset) with a
// narrated visual BEFORE the learner types the command in a practical lesson.
// The practical already renders a repository with GitGraph; a theory step is the
// same picture, held still, with narration beside it.
//
// WHY A STEP HOLDS COMMANDS AND NOT A RepoState
// The obvious shape - hand each step a ready-made RepoState - does not survive
// the stepper: the player deep-clones every step, and a RepoState is mostly Maps,
// which a structural clone flattens into plain objects. GitGraph then receives a
// `commits` with no `.keys()` and the lesson dies on mount.
// Carrying the COMMANDS instead fixes that and two more things: step data stays
// plain JSON, so it clones and localizes like every other scene; and a lesson
// file no longer needs the runtime loaded before it, so the same file runs in a
// page, in the validator and in the verifier with none of them special-casing it.
// The replay is real - the same git the practical lessons run - so the theory
// picture and the board the learner types into cannot drift apart.

/** One step of a git explainer. */
export interface RepoScene {
  /** Files the folder holds before anything runs, seeded as untracked. */
  files?: string[];
  /** Real git commands, replayed in order to build this step's picture. */
  commands: string[];
  /** A short caption under the board, e.g. "main has not moved". */
  note?: string;
  /** How many trailing commands are NEW at this step. The view shows those, so
   *  the learner can see which command produced the picture - and in particular
   *  which one moved `HEAD`. Defaults to 1; set 0 for a step that only re-explains
   *  the previous picture without running anything. */
  ran?: number;
}

/** What the view actually renders: the same fields, with the optional ones filled. */
export interface ResolvedRepoScene {
  files: string[];
  commands: string[];
  note?: string;
  /** The trailing commands this step ran, already sliced out of `commands`. */
  ran: string[];
}

/** Normalise a raw scene for rendering.
 *
 *  A step with no command list is an authoring slip. Returning null lets the view
 *  skip it, which costs one blank panel the author will see - where a throw would
 *  take down a lesson mid-run for a learner who did nothing wrong. */
export function resolveRepo(scene: RepoScene | undefined): ResolvedRepoScene | null {
  if (!scene || !Array.isArray(scene.commands)) return null;
  const commands = scene.commands.slice();
  // Clamped, so an author who writes `ran: 9` on a two-command step gets both
  // commands rather than a crash or a silently empty strip.
  const want = scene.ran === undefined ? 1 : Math.max(0, Math.min(scene.ran, commands.length));
  return {
    files: Array.isArray(scene.files) ? scene.files.slice() : [],
    commands,
    note: scene.note,
    ran: want === 0 ? [] : commands.slice(commands.length - want),
  };
}
