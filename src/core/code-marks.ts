// DOM-free logic for spotlighting parts of a code line - a whole statement, a
// sub-expression, or a single operator. A step declares one or more CodeMarks;
// the code views turn them into <span> highlights. Kept pure so the range
// resolution and HTML building are unit-tested without a browser.

export interface CodeMark {
  /** Which code line to mark (0-based). Defaults to the step's `pc`. */
  line?: number;
  /** Substring(s) to find and mark - every occurrence on the line is marked. */
  text?: string | string[];
  /** Explicit character ranges [start, end) - an alternative to `text`. */
  ranges?: Array<[number, number]>;
  /** Optional style variant, e.g. "op" | "expr" | "stmt". */
  kind?: string;
}

export interface MarkSpan {
  start: number;
  end: number;
  kind?: string;
}

export function escapeHtml(text: string): string {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Turn one CodeMark into concrete spans on a given line. Pure. */
export function resolveMarks(line: string, mark: CodeMark): MarkSpan[] {
  if (mark.ranges && mark.ranges.length) {
    return mark.ranges.map(([start, end]) => ({ start, end, kind: mark.kind }));
  }
  const spans: MarkSpan[] = [];
  const texts = mark.text == null ? [] : Array.isArray(mark.text) ? mark.text : [mark.text];
  for (const needle of texts) {
    if (!needle) continue;
    let from = 0;
    let idx = line.indexOf(needle, from);
    while (idx >= 0) {
      spans.push({ start: idx, end: idx + needle.length, kind: mark.kind });
      from = idx + needle.length;
      idx = line.indexOf(needle, from);
    }
  }
  return spans;
}

/** All spans targeting one line, drawn from a step's codeMark(s). Pure. */
export function spansForLine(
  lineIndex: number,
  line: string,
  codeMark: CodeMark | CodeMark[] | undefined,
  pc: number,
): MarkSpan[] {
  if (!codeMark) return [];
  const marks = Array.isArray(codeMark) ? codeMark : [codeMark];
  const spans: MarkSpan[] = [];
  for (const mark of marks) {
    const target = mark.line == null ? pc : mark.line;
    if (target !== lineIndex) continue;
    spans.push(...resolveMarks(line, mark));
  }
  return spans;
}

/** Escaped HTML for a line, wrapping the given spans. Overlaps are skipped. Pure. */
export function markedLineHtml(line: string, spans: MarkSpan[]): string {
  const valid = spans
    .filter((s) => s.start < s.end && s.start >= 0)
    .sort((a, b) => a.start - b.start);
  if (!valid.length) return escapeHtml(line);
  let html = "";
  let cursor = 0;
  for (const s of valid) {
    if (s.start < cursor) continue; // overlapping mark, skip
    const start = Math.max(cursor, s.start);
    const end = Math.min(line.length, s.end);
    if (end <= start) continue;
    if (start > cursor) html += escapeHtml(line.slice(cursor, start));
    const kindAttr = s.kind ? ` data-kind="${escapeHtml(s.kind)}"` : "";
    html += `<span class="cl-mv-cmark"${kindAttr}>${escapeHtml(line.slice(start, end))}</span>`;
    cursor = end;
  }
  if (cursor < line.length) html += escapeHtml(line.slice(cursor));
  return html;
}
