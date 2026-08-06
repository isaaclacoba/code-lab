// Reading and resolving a file that git left conflict markers in.
//
// The markers are a small format, and the learner has to be able to act on them
// two ways: by hand, which is the real skill, and with a button, which is what
// stops someone stalling on their first conflict. Both need the same parse, so
// it lives here - away from the DOM, where it can be tested.

/** One conflicted region of a file, as `diff3` markers describe it. */
export interface ConflictRegion {
  /** Line index where `<<<<<<<` sits. */
  start: number;
  /** Line index just past `>>>>>>>`. */
  end: number;
  ourLabel: string;
  theirLabel: string;
  ours: string[];
  /** The shared original. Empty when git wrote 2-way markers. */
  base: string[];
  theirs: string[];
}

/** Which side to keep. `both` keeps ours then theirs, in that order. */
export type ConflictChoice = "ours" | "theirs" | "both";

const OPEN = /^<{7}\s*(.*)$/;
const BASE = /^\|{7}\s*(.*)$/;
const SPLIT = /^={7}\s*$/;
const CLOSE = /^>{7}\s*(.*)$/;

/** Split text into lines the way the rest of the model does. */
function lines(text: string): string[] {
  if (text === "") return [];
  const out = text.split("\n");
  if (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out;
}

/** Every conflicted region in the file, in order. A file with no markers gives
 *  an empty list, which is how "there is nothing left to settle" is answered. */
export function findConflicts(text: string): ConflictRegion[] {
  const src = lines(text);
  const out: ConflictRegion[] = [];

  for (let i = 0; i < src.length; i++) {
    const open = OPEN.exec(src[i]);
    if (!open) continue;

    const region: ConflictRegion = {
      start: i,
      end: i,
      ourLabel: open[1] || "ours",
      theirLabel: "theirs",
      ours: [],
      base: [],
      theirs: [],
    };
    let side: "ours" | "base" | "theirs" = "ours";
    let closed = false;

    for (let j = i + 1; j < src.length; j++) {
      const line = src[j];
      const baseMark = BASE.exec(line);
      const closeMark = CLOSE.exec(line);
      if (baseMark) { side = "base"; continue; }
      if (SPLIT.test(line)) { side = "theirs"; continue; }
      if (closeMark) {
        region.theirLabel = closeMark[1] || "theirs";
        region.end = j + 1;
        closed = true;
        break;
      }
      region[side].push(line);
    }

    // An unterminated marker is a half-edited file, not a region to act on.
    if (!closed) continue;
    out.push(region);
    i = region.end - 1;
  }
  return out;
}

/** Resolve every region the same way, and hand back the whole file. */
export function resolveConflicts(text: string, choice: ConflictChoice): string {
  const src = lines(text);
  const regions = findConflicts(text);
  if (regions.length === 0) return text;

  const out: string[] = [];
  let cursor = 0;
  for (const r of regions) {
    out.push(...src.slice(cursor, r.start));
    if (choice === "ours") out.push(...r.ours);
    else if (choice === "theirs") out.push(...r.theirs);
    else out.push(...r.ours, ...r.theirs);
    cursor = r.end;
  }
  out.push(...src.slice(cursor));
  return out.join("\n");
}

/** Does this text still hold anything git would refuse to commit? */
export function hasConflictMarkers(text: string): boolean {
  return findConflicts(text).length > 0;
}
