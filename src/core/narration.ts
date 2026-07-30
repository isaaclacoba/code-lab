// DOM-free narration formatting. Turns a lesson's plain narration string into
// safe HTML with light structure so a step is not one dense block: blank lines
// split paragraphs, lines starting with "- " or "* " become a bullet list, and
// `code` / **bold** / *italic* get inline formatting. Pure, so it is unit-tested
// directly.

export function escapeHtml(text: string): string {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Code spans are resolved first, then emphasis is applied only to the text
// OUTSIDE those spans - like markdown, a `code` chip is literal, so an asterisk
// in code (a printed value, a multiplication) is not misread as italic. Bold is
// resolved before italic so **word** is not misread as *word* with a stray
// asterisk on each side; by the time italic runs, its asterisks are gone.
function inline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .split(/(<code>[\s\S]*?<\/code>)/)
    .map((seg) =>
      seg.startsWith("<code>")
        ? seg
        : seg
            .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
            .replace(/\*([^*]+)\*/g, "<em>$1</em>"),
    )
    .join("");
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
