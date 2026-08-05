// Three-way text merge for the git lessons: LCS line alignment, a 3-way merge
// against the ancestor, and diff3-style markers.
//
// The naive thing - compare line 1 to line 1, line 2 to line 2 - is WRONG, and
// wrong in a way that would quietly ruin the lesson. Insert one line at the top
// of a file and every line below it shifts, so a by-index comparison reports the
// whole file as changed and any other edit anywhere "conflicts". A learner would
// see a conflict they did not cause and draw the wrong conclusion about git.
//
// So lines are matched by CONTENT (longest common subsequence), a change is a
// region of the ancestor a side replaced, and a conflict is only what git calls
// one: the two sides changed regions that OVERLAP.

/** Split into lines for merging. A trailing newline is not a line. */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Join lines back into file text. */
export function joinLines(lines: string[]): string {
  return lines.join("\n");
}

/** One matched pair of line indices - `a[ai]` is the same line as `b[bi]`. */
export interface LineMatch {
  ai: number;
  bi: number;
}

/** Longest common subsequence over lines, matched by content. Files here are a
 *  handful of lines, so the plain O(n*m) table is the right call. */
export function lcsLines(a: string[], b: string[]): LineMatch[] {
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const out: LineMatch[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ ai: i, bi: j });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return out;
}

/** A region of the ancestor that one side replaced. `[start, end)` indexes the
 *  ancestor; `lines` is what that side put there. A pure insertion has
 *  `start === end`. */
export interface Hunk {
  start: number;
  end: number;
  lines: string[];
}

/** What one side changed, relative to the ancestor. */
export function diffHunks(base: string[], side: string[]): Hunk[] {
  const matches = lcsLines(base, side);
  const hunks: Hunk[] = [];
  let bi = 0;
  let si = 0;
  const flush = (endBase: number, endSide: number) => {
    if (endBase > bi || endSide > si) {
      hunks.push({ start: bi, end: endBase, lines: side.slice(si, endSide) });
    }
  };
  for (const m of matches) {
    flush(m.ai, m.bi);
    bi = m.ai + 1;
    si = m.bi + 1;
  }
  flush(base.length, side.length);
  return hunks;
}

/** Labels written into the conflict markers. */
export interface MergeLabels {
  ours: string;
  base: string;
  theirs: string;
}

/** The outcome of a three-way merge. `text` always contains something usable:
 *  the merged file when clean, the same file with markers when not. */
export interface Merge3Result {
  text: string;
  clean: boolean;
  /** How many conflict regions the markers describe. */
  conflicts: number;
}

const DEFAULT_LABELS: MergeLabels = { ours: "HEAD", base: "ancestor", theirs: "other" };

/** Do two changed regions of the ancestor overlap? A positive-length overlap is
 *  the ordinary case. Two pure insertions at the same point count only if they
 *  put different lines there - otherwise both sides did the same thing. */
function overlaps(a: Hunk, b: Hunk): boolean {
  const positive = Math.max(a.start, b.start) < Math.min(a.end, b.end);
  if (positive) return true;
  const bothInsert = a.start === a.end && b.start === b.end && a.start === b.start;
  return bothInsert && joinLines(a.lines) !== joinLines(b.lines);
}

interface Group {
  start: number;
  end: number;
  ours: Hunk[];
  theirs: Hunk[];
}

/** Gather each side's hunks into groups that have to be decided together. */
function groupHunks(ourHunks: Hunk[], theirHunks: Hunk[]): Group[] {
  const tagged = [
    ...ourHunks.map((h) => ({ h, side: "ours" as const })),
    ...theirHunks.map((h) => ({ h, side: "theirs" as const })),
  ].sort((x, y) => x.h.start - y.h.start || x.h.end - y.h.end);

  const groups: Group[] = [];
  for (const item of tagged) {
    const last = groups[groups.length - 1];
    const touching =
      last &&
      (Math.max(last.start, item.h.start) < Math.min(last.end, item.h.end) ||
        [...last.ours, ...last.theirs].some((h) => overlaps(h, item.h)));
    if (touching) {
      last.start = Math.min(last.start, item.h.start);
      last.end = Math.max(last.end, item.h.end);
      (item.side === "ours" ? last.ours : last.theirs).push(item.h);
    } else {
      groups.push({
        start: item.h.start,
        end: item.h.end,
        ours: item.side === "ours" ? [item.h] : [],
        theirs: item.side === "theirs" ? [item.h] : [],
      });
    }
  }
  return groups;
}

/** The lines a group's side contributes, with any untouched ancestor lines
 *  inside the group's span kept in place. */
function sideLines(group: Group, side: Hunk[], base: string[]): string[] {
  if (side.length === 0) return base.slice(group.start, group.end);
  const out: string[] = [];
  let cursor = group.start;
  for (const h of side) {
    out.push(...base.slice(cursor, h.start));
    out.push(...h.lines);
    cursor = h.end;
  }
  out.push(...base.slice(cursor, group.end));
  return out;
}

/** Three-way merge. A conflict is an overlap - nothing else. */
export function merge3(
  baseText: string,
  oursText: string,
  theirsText: string,
  labels: MergeLabels = DEFAULT_LABELS,
): Merge3Result {
  const base = splitLines(baseText);
  const ours = splitLines(oursText);
  const theirs = splitLines(theirsText);

  const groups = groupHunks(diffHunks(base, ours), diffHunks(base, theirs));

  const out: string[] = [];
  let cursor = 0;
  let conflicts = 0;

  for (const g of groups) {
    out.push(...base.slice(cursor, g.start));
    const ourSide = sideLines(g, g.ours, base);
    const theirSide = sideLines(g, g.theirs, base);

    if (g.ours.length === 0) {
      out.push(...theirSide);
    } else if (g.theirs.length === 0) {
      out.push(...ourSide);
    } else if (joinLines(ourSide) === joinLines(theirSide)) {
      // both sides made the same edit - git takes it once, without complaint
      out.push(...ourSide);
    } else {
      conflicts++;
      // diff3 markers: the ancestor is shown on purpose. Seeing what the line
      // WAS is what explains why git will not choose.
      out.push(`<<<<<<< ${labels.ours}`);
      out.push(...ourSide);
      out.push(`||||||| ${labels.base}`);
      out.push(...base.slice(g.start, g.end));
      out.push("=======");
      out.push(...theirSide);
      out.push(`>>>>>>> ${labels.theirs}`);
    }
    cursor = g.end;
  }
  out.push(...base.slice(cursor));

  return { text: joinLines(out), clean: conflicts === 0, conflicts };
}
