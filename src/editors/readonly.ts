import type { EditorAdapter, EditorMountOptions, Highlighter } from "../types.js";
import { defaultHighlighter } from "../highlighter.js";

/** A non-editable, Prism-highlighted code block. The lightest surface, used
 *  whenever `editable` is false. Pulls in no external editor. */
export class ReadOnlyView implements EditorAdapter {
  private highlighter: Highlighter;
  private value = "";
  private pre?: HTMLPreElement;
  private code?: HTMLElement;
  private language = "csharp";

  constructor(highlighter?: Highlighter) {
    this.highlighter = highlighter ?? defaultHighlighter();
  }

  mount(host: HTMLElement, opts: EditorMountOptions): void {
    this.value = opts.value;
    this.language = opts.language;

    this.pre = document.createElement("pre");
    this.pre.className = "cl-readonly line-numbers";
    this.code = document.createElement("code");
    this.code.className = `language-${opts.language}`;
    this.pre.appendChild(this.code);
    host.appendChild(this.pre);
    this.render();
  }

  private render(): void {
    if (this.code) {
      this.code.innerHTML = this.highlighter.highlight(this.value, this.language);
    }
  }

  getValue(): string {
    return this.value;
  }

  setValue(value: string): void {
    this.value = value;
    this.render();
  }

  setReadOnly(): void {
    // Always read-only by definition.
  }

  destroy(): void {
    this.pre?.remove();
    this.pre = undefined;
    this.code = undefined;
  }
}
