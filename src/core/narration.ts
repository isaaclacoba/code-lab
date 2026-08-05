// DOM-free narration formatting. Turns a lesson's plain narration string into
// safe HTML with light structure so a step is not one dense block: blank lines
// split paragraphs, lines starting with "- " or "* " become a bullet list, and
// `code` / **bold** / *italic* get inline formatting. Pure, so it is unit-tested
// directly.

export function escapeHtml(text: string): string {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Code spans are pulled OUT before emphasis runs and put back after, rather than
// splitting the string around them. Both matter:
//   - an asterisk inside `code` (a printed value, a multiplication) must stay
//     literal, which is why the spans are removed first;
//   - **bold that wraps a code chip** must still work, which splitting broke -
//     the opening and closing `**` landed in different segments, so the pattern
//     never matched and a learner saw the raw asterisks on the page.
// Bold is resolved before italic, so **word** is not misread as *word* with a
// stray asterisk on each side.
const CODE_SLOT = "\u0000";

function inline(text: string): string {
  const spans: string[] = [];
  const stashed = escapeHtml(text).replace(/`([^`]+)`/g, (_m, code: string) => {
    spans.push(`<code>${code}</code>`);
    return `${CODE_SLOT}${spans.length - 1}${CODE_SLOT}`;
  });
  return stashed
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(new RegExp(`${CODE_SLOT}(\\d+)${CODE_SLOT}`, "g"), (_m, i: string) => spans[Number(i)]);
}

/** Render narration text to safe HTML. A single-line string stays one paragraph,
 *  so existing lessons are unaffected; newlines and "- " bullets add structure. */
export function renderNarration(text: string): string {
  const lines = String(text ?? "").split("\n");
  let html = "";
  let bullets: string[] = [];
  const flush = (): void => {
    if (bullets.length) {
      html += "<ul>" + bullets.map((b) => `<li>${inline(b)}</li>`).join("") + "</ul>";
      bullets = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      bullets.push(bullet[1]);
      continue;
    }
    flush();
    html += `<p>${inline(line)}</p>`;
  }
  flush();
  return html;
}
