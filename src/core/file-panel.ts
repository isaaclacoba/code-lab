// What the file panel shows: one file, read in whichever of the three zones the
// learner picked, plus whether the other copies disagree with it.
//
// The disagreement is the point. "Staging holds a snapshot of when you added it"
// is a sentence a learner can nod along to without believing; two copies of the
// same file that visibly differ is the same claim they cannot argue with. So the
// panel marks every zone whose copy differs from the one behind it, and when the
// selected zone is one of them, shows the change rather than a flat copy.

import { headCommit, fileAt, type RepoState } from "./git-model.js";
import { diffLines, type DiffLine } from "./text-diff.js";
import { splitLines } from "./text-merge.js";

/** The three zones a file can sit in, newest work first - the order the board
 *  reads left to right. */
export type PanelZone = "tree" | "index" | "repo";

export const PANEL_ZONES: readonly PanelZone[] = ["tree", "index", "repo"];

/** One zone's copy of the selected file. */
export interface ZoneCopy {
  zone: PanelZone;
  /** Does this zone hold the file at all? */
  present: boolean;
  text: string;
  /** Does this copy differ from the next copy behind it? */
  differs: boolean;
}

/** Everything the view needs to paint the panel. */
export interface FilePanel {
  /** The file being read, or null when no file exists anywhere yet. */
  path: string | null;
  /** Every file the repo knows about, for the chip row. */
  files: string[];
  zones: ZoneCopy[];
  selected: PanelZone;
  /** The change from `comparedWith` to `selected`, or null when they agree. */
  diff: DiffLine[] | null;
  comparedWith: PanelZone | null;
}

/** The text a zone holds for a path, or null when that zone does not have it. */
export function copyIn(state: RepoState, zone: PanelZone, path: string): string | null {
  if (zone === "tree") return state.worktree.get(path)?.text ?? null;
  if (zone === "index") return state.index.get(path) ?? null;
  return fileAt(state, headCommit(state), path);
}

/** Every path the repo knows about, in any zone, sorted. */
export function panelFiles(state: RepoState): string[] {
  const all = new Set<string>();
  for (const p of state.worktree.keys()) all.add(p);
  for (const p of state.index.keys()) all.add(p);
  const head = headCommit(state);
  if (head !== null) {
    const c = state.commits.get(head);
    // A commit may arrive without contents: `git-progress` clones commits as
    // {id, parents, message, paths} to build the ghost/union graph, and that
    // clone is what the board is handed. No contents means nothing to read.
    if (c && c.blobs) for (const p of c.blobs.keys()) all.add(p);
  }
  return [...all].sort();
}

/** The zone behind this one - the copy it should be compared against. */
function behind(zones: ZoneCopy[], zone: PanelZone): ZoneCopy | null {
  const i = PANEL_ZONES.indexOf(zone);
  for (let k = i + 1; k < PANEL_ZONES.length; k++) {
    const z = zones.find((c) => c.zone === PANEL_ZONES[k]);
    if (z && z.present) return z;
  }
  return null;
}

/** Resolve the panel. `path` and `selected` are the learner's choices; both fall
 *  back to something sensible so a fresh board paints without being told. */
export function resolveFilePanel(
  state: RepoState,
  path: string | null,
  selected: PanelZone | null,
): FilePanel {
  const files = panelFiles(state);
  const chosen = path && files.includes(path) ? path : (files[0] ?? null);

  // Nothing to read means nothing to show. A lesson that never gives its files
  // any content gets no panel rather than a row of "(empty file)" boxes.
  const anyText = files.some((f) => PANEL_ZONES.some((z) => (copyIn(state, z, f) ?? "") !== ""));
  if (chosen === null || !anyText) {
    return { path: null, files, zones: [], selected: "tree", diff: null, comparedWith: null };
  }

  const zones: ZoneCopy[] = PANEL_ZONES.map((zone) => {
    const text = copyIn(state, zone, chosen);
    return { zone, present: text !== null, text: text ?? "", differs: false };
  });
  for (const z of zones) {
    const prev = behind(zones, z.zone);
    z.differs = z.present && prev !== null && prev.text !== z.text;
  }

  // Prefer the zone the learner picked; otherwise the first that holds the file.
  const wanted = selected && zones.some((z) => z.zone === selected && z.present) ? selected : null;
  const sel = wanted ?? (zones.find((z) => z.present)?.zone ?? "tree");
  const selCopy = zones.find((z) => z.zone === sel)!;
  const prev = behind(zones, sel);

  const showDiff = selCopy.present && prev !== null && prev.text !== selCopy.text;
  return {
    path: chosen,
    files,
    zones,
    selected: sel,
    diff: showDiff ? diffLines(splitLines(prev!.text), splitLines(selCopy.text)) : null,
    comparedWith: showDiff ? prev!.zone : null,
  };
}
