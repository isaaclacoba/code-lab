// Unified diff over lines, for `git diff` in the lessons.
//
// Shares the LCS alignment used by the merge, for the same reason: lines are
// matched by content, so inserting one line reads as one added line rather than
// as a rewrite of everything below it.

import { lcsLines, splitLines } from "./text-merge.js";

/** One line of a diff: context, removed, or added. */
export interface DiffLine {
  kind: " " | "-" | "+";
  text: string;
}

/** The full line-by-line diff, context included. */
export function diffLines(a: string[], b: string[]): DiffLine[] {
  const out: DiffLine[] = [];
  let ai = 0;
  let bi = 0;
  for (const m of lcsLines(a, b)) {
    while (ai < m.ai) out.push({ kind: "-", text: a[ai++] });
    while (bi < m.bi) out.push({ kind: "+", text: b[bi++] });
    out.push({ kind: " ", text: a[m.ai] });
    ai = m.ai + 1;
    bi = m.bi + 1;
  }
  while (ai < a.length) out.push({ kind: "-", text: a[ai++] });
  while (bi < b.length) out.push({ kind: "+", text: b[bi++] });
  return out;
}

interface Hunk {
  aStart: number;
  aCount: number;
  bStart: number;
  bCount: number;
  lines: DiffLine[];
}

/** Group changed lines into hunks, keeping `context` unchanged lines around
 *  each. Files here are a handful of lines, so this usually is the whole file -
 *  which is what a learner wants to see anyway. */
function hunksOf(lines: DiffLine[], context: number): Hunk[] {
  const changed = lines.map((l) => l.kind !== " ");
  const keep = lines.map((_, i) =>
    changed.slice(Math.max(0, i - context), i + context + 1).some(Boolean),
  );

  const hunks: Hunk[] = [];
  let ai = 0;
  let bi = 0;
  let current: Hunk | null = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (keep[i]) {
      if (!current) {
        current = { aStart: ai + 1, aCount: 0, bStart: bi + 1, bCount: 0, lines: [] };
        hunks.push(current);
      }
      current.lines.push(l);
      if (l.kind !== "+") current.aCount++;
      if (l.kind !== "-") current.bCount++;
    } else {
      current = null;
    }
    if (l.kind !== "+") ai++;
    if (l.kind !== "-") bi++;
  }
  return hunks;
}

/** A unified diff for one file, or "" when nothing changed. `aLabel`/`bLabel`
 *  are the two sides, written the way git writes them (`a/notes.md`). */
export function formatFileDiff(
  path: string,
  oldText: string,
  newText: string,
  context = 3,
): string {
  if (oldText === newText) return "";
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const hunks = hunksOf(diffLines(a, b), context);
  if (hunks.length === 0) return "";

  const out: string[] = [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
  ];
  for (const h of hunks) {
    out.push(`@@ -${h.aCount === 0 ? 0 : h.aStart},${h.aCount} +${h.bCount === 0 ? 0 : h.bStart},${h.bCount} @@`);
    for (const l of h.lines) out.push(l.kind + l.text);
  }
  return out.join("\n");
}
