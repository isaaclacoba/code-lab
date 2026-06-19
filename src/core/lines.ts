// Pure, DOM-free helpers for turning code text and tour-step line references
// into a renderable model. Kept free of the DOM so they can be unit-tested in
// isolation; the Tour adapter only does element creation on top of these.

/** Normalize a step's `lines` (1-based, single or list, possibly absent) into a
 *  sorted, de-duplicated array of line numbers. */
export function normalizeLines(lines: number | number[] | undefined | null): number[] {
  if (lines === undefined || lines === null) return [];
  const list = Array.isArray(lines) ? lines : [lines];
  return [...new Set(list.filter((n) => Number.isFinite(n) && n > 0))].sort(
    (a, b) => a - b,
  );
}

/** Split source into display lines, dropping trailing blank lines so the pane
 *  does not show empty rows at the end. */
export function splitCodeLines(code: string): string[] {
  return code.replace(/\n+$/, "").split("\n");
}

export interface LineFlags {
  active: boolean;
  dim: boolean;
}

/** For each 1..count line, decide whether it is highlighted (active) or dimmed.
 *  A line is dim only when some other line is active. With no active lines,
 *  nothing is dimmed. */
export function computeLineFlags(active: number[], count: number): LineFlags[] {
  const set = new Set(active);
  const anyActive = active.length > 0;
  const flags: LineFlags[] = [];
  for (let i = 1; i <= count; i++) {
    const isActive = set.has(i);
    flags.push({ active: isActive, dim: anyActive && !isActive });
  }
  return flags;
}
