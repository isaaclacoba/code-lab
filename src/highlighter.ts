import type { Highlighter } from "./types.js";

declare global {
  interface Window {
    Prism?: {
      highlight(code: string, grammar: unknown, language: string): string;
      languages: Record<string, unknown>;
    };
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Uses Prism when it is present on the page, otherwise escapes plainly. Prism
 *  is an optional peer dependency, loaded by the host page. */
export class PrismHighlighter implements Highlighter {
  highlight(code: string, language: string): string {
    const prism = window.Prism;
    if (prism && prism.languages && prism.languages[language]) {
      return prism.highlight(code, prism.languages[language], language);
    }
    return escapeHtml(code);
  }
}

/** A no-op highlighter that only escapes. Used as a safe default. */
export class PlainHighlighter implements Highlighter {
  highlight(code: string): string {
    return escapeHtml(code);
  }
}

export function defaultHighlighter(): Highlighter {
  return window.Prism ? new PrismHighlighter() : new PlainHighlighter();
}
