import type { EditorAdapter, EditorMountOptions, Highlighter } from "../types.js";
import { defaultHighlighter } from "../highlighter.js";

/** A writable editor with no external dependency: a transparent textarea over a
 *  Prism-highlighted underlay. Good for tiny embeds or hosts that cannot load
 *  Monaco. */
export class TextareaEditor implements EditorAdapter {
  private highlighter: Highlighter;
  private language = "csharp";
  private wrap?: HTMLDivElement;
  private pre?: HTMLPreElement;
  private code?: HTMLElement;
  private textarea?: HTMLTextAreaElement;

  constructor(highlighter?: Highlighter) {
    this.highlighter = highlighter ?? defaultHighlighter();
  }

  mount(host: HTMLElement, opts: EditorMountOptions): void {
    this.language = opts.language;

    this.wrap = document.createElement("div");
    this.wrap.className = "cl-ta-wrap";

    this.pre = document.createElement("pre");
    this.pre.className = "cl-ta-underlay";
    this.pre.setAttribute("aria-hidden", "true");
    this.code = document.createElement("code");
    this.code.className = `language-${opts.language}`;
    this.pre.appendChild(this.code);

    this.textarea = document.createElement("textarea");
    this.textarea.className = "cl-ta-input";
    this.textarea.spellcheck = false;
    this.textarea.autocapitalize = "off";
    this.textarea.setAttribute("autocomplete", "off");
    this.textarea.setAttribute("autocorrect", "off");
    this.textarea.value = opts.value;
    this.textarea.readOnly = opts.readOnly;

    this.textarea.addEventListener("input", () => this.sync());
    this.textarea.addEventListener("scroll", () => this.syncScroll());

    this.wrap.append(this.pre, this.textarea);
    host.appendChild(this.wrap);
    this.sync();
  }

  private sync(): void {
    if (!this.code || !this.textarea) return;
    // A trailing newline keeps the underlay height in step with the textarea.
    const text = this.textarea.value;
    this.code.innerHTML = this.highlighter.highlight(text + "\n", this.language);
    this.syncScroll();
  }

  private syncScroll(): void {
    if (!this.pre || !this.textarea) return;
    this.pre.scrollTop = this.textarea.scrollTop;
    this.pre.scrollLeft = this.textarea.scrollLeft;
  }

  getValue(): string {
    return this.textarea?.value ?? "";
  }

  setValue(value: string): void {
    if (this.textarea) {
      this.textarea.value = value;
      this.sync();
    }
  }

  setReadOnly(readOnly: boolean): void {
    if (this.textarea) this.textarea.readOnly = readOnly;
  }

  destroy(): void {
    this.wrap?.remove();
    this.wrap = undefined;
    this.pre = undefined;
    this.code = undefined;
    this.textarea = undefined;
  }
}
