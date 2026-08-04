// LineTerminal: the VIEW of the terminal module - a small, dependency-free
// single-line console.
//
// It owns typing, echoing, scrollback, and history recall. It owns no commands.
// There are two ways to give it something to do, and both are supported:
//
//   - `onCommand` - the widget hands you the trimmed line and you do the work,
//     calling `write()` with the result. This is the original contract.
//   - `shell` + `state` - the widget runs the line through a `Shell`, prints the
//     result itself, obeys a `clear` effect, and reports the new state through
//     `onState` so the host can repaint whatever the command changed.
//
// Either way the widget knows nothing about git, or about any other command set;
// that separation is the whole point, and it is why this is not xterm.js: we need
// a few hundred lines we fully control.
//
// The live prompt is a real `<input>`, not a contenteditable or a key-capturing
// div. That buys a native caret, native selection, native IME, and a normal Tab
// stop for free - a keyboard user is never trapped. It is styled to disappear
// into the console, and the focus ring is drawn on the root via `:focus-within`
// so focus stays visible.
//
// Scrollback lines are appended as text nodes (never innerHTML): command output
// is untrusted text and must not be able to inject markup.

import { CommandHistory } from "./history.js";
import type { Shell, ShellResult } from "./shell.js";

/** How a scrollback line reads: normal output, an error, a caution, a success. */
export type LineKind = "out" | "err" | "warn" | "good";

export interface LineTerminalOptions<S = unknown> {
  /** The prompt shown before the live line and before each echoed command. */
  prompt?: string;
  /** Lines printed into the scrollback at mount time (a banner, a hint). */
  intro?: string[];
  /** Called with the trimmed line when the learner presses Enter. Never called
   *  for a blank line. Fires whether or not a `shell` is wired up. */
  onCommand?: (line: string) => void;
  /** Run each entered line through this shell and print the result. */
  shell?: Shell<S>;
  /** The state handed to the shell; replaced by whatever a command returns. */
  state?: S;
  /** Called after every shell run, with the new state and the full result. */
  onState?: (state: S, result: ShellResult<S>) => void;
}

const DEFAULT_PROMPT = "$";

export class LineTerminal<S = unknown> {
  private root: HTMLElement | null = null;
  private scroll: HTMLElement | null = null;
  private input: HTMLInputElement | null = null;

  private prompt = DEFAULT_PROMPT;
  private onCommand: ((line: string) => void) | null = null;
  private shell: Shell<S> | null = null;
  private state!: S;
  private onState: ((state: S, result: ShellResult<S>) => void) | null = null;
  private readonly history = new CommandHistory();

  // --- lifecycle ---------------------------------------------------------

  mount(host: HTMLElement, opts: LineTerminalOptions<S>): void {
    this.prompt = opts.prompt ?? DEFAULT_PROMPT;
    this.onCommand = opts.onCommand ?? null;
    this.shell = opts.shell ?? null;
    this.state = opts.state as S;
    this.onState = opts.onState ?? null;

    const root = document.createElement("div");
    root.className = "cl-term";

    const scroll = document.createElement("div");
    scroll.className = "cl-term-scroll";
    // A log region, not an alert: output is announced as it lands but does not
    // interrupt what the learner is typing.
    scroll.setAttribute("role", "log");
    scroll.setAttribute("aria-live", "polite");
    scroll.setAttribute("aria-label", "Terminal output");

    const row = document.createElement("div");
    row.className = "cl-term-row";
    row.append(this.promptSpan());

    const input = document.createElement("input");
    input.className = "cl-term-input";
    input.type = "text";
    input.setAttribute("aria-label", "Terminal command");
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("autocorrect", "off");
    row.append(input);

    root.append(scroll, row);
    root.addEventListener("click", this.onRootClick);
    input.addEventListener("keydown", this.onKeyDown);
    host.appendChild(root);

    this.root = root;
    this.scroll = scroll;
    this.input = input;

    for (const line of opts.intro ?? []) this.write(line);
  }

  destroy(): void {
    this.root?.removeEventListener("click", this.onRootClick);
    this.input?.removeEventListener("keydown", this.onKeyDown);
    this.root?.remove();
    this.root = null;
    this.scroll = null;
    this.input = null;
    this.onCommand = null;
    this.shell = null;
    this.onState = null;
    this.history.reset();
  }

  // --- public API --------------------------------------------------------

  /** Append output to the scrollback. Embedded newlines become separate lines,
   *  so a caller can hand over a whole command result in one call. */
  write(text: string, kind: LineKind = "out"): void {
    if (!this.scroll) return;
    for (const line of String(text).split("\n")) {
      const el = document.createElement("div");
      el.className = `cl-term-line is-${kind}`;
      el.textContent = line;
      this.scroll.appendChild(el);
    }
    this.scrollToEnd();
  }

  /** Wipe the scrollback. The prompt line, its text, and focus are untouched. */
  clear(): void {
    if (this.scroll) this.scroll.textContent = "";
  }

  focus(): void {
    this.input?.focus();
  }

  // --- input -------------------------------------------------------------

  private readonly onKeyDown = (ev: KeyboardEvent): void => {
    const input = this.input;
    if (!input) return;
    if (ev.key === "Enter") {
      ev.preventDefault();
      this.submit(input.value);
      return;
    }
    if (ev.key === "ArrowUp") {
      ev.preventDefault();
      this.recall(this.history.prev(input.value));
      return;
    }
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      this.recall(this.history.next());
    }
    // Everything else - Tab included - keeps its native behaviour.
  };

  private submit(raw: string): void {
    const line = raw.trim();
    if (this.input) this.input.value = "";
    this.echo(line);
    this.history.push(line);
    if (line === "") return;
    // A shell and an onCommand handler are alternatives, never both. Running
    // both would execute every typed line TWICE - two commits per `git commit`.
    // The shell wins when it is wired up; onCommand then only observes.
    if (this.shell) {
      this.dispatch(line);
      this.onCommand?.(line);
      return;
    }
    this.onCommand?.(line);
  }

  /** Run the line through the shell, if there is one, and show what came back. */
  private dispatch(line: string): void {
    const shell = this.shell;
    if (!shell) return;
    const result = shell.run(line, this.state);
    if (isClear(result.effect)) this.clear();
    if (result.output !== "") this.write(result.output, result.error ? "err" : "out");
    this.state = result.state;
    this.onState?.(result.state, result);
  }

  /** Put a recalled entry on the live line, caret at the end. `null` means the
   *  walk hit an end, so the line stays as it is. */
  private recall(value: string | null): void {
    const input = this.input;
    if (!input || value === null) return;
    input.value = value;
    const end = value.length;
    if (typeof input.setSelectionRange === "function") input.setSelectionRange(end, end);
  }

  // --- rendering helpers -------------------------------------------------

  /** Echo what was entered into the scrollback, so the transcript reads like a
   *  real session. A blank line echoes a bare prompt. */
  private echo(line: string): void {
    if (!this.scroll) return;
    const el = document.createElement("div");
    el.className = "cl-term-line is-cmd";
    el.append(this.promptSpan());
    // A literal space, not a margin: the line is `pre-wrap`, so copying the
    // transcript yields `$ git status` rather than `$git status`.
    el.append(document.createTextNode(line === "" ? "" : ` ${line}`));
    this.scroll.appendChild(el);
    this.scrollToEnd();
  }

  private promptSpan(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cl-term-prompt";
    el.textContent = this.prompt;
    // Decorative: a screen reader gets the command text, not "dollar sign".
    el.setAttribute("aria-hidden", "true");
    return el;
  }

  private scrollToEnd(): void {
    if (this.scroll) this.scroll.scrollTop = this.scroll.scrollHeight;
  }

  /** Clicking anywhere in the console puts the caret back on the live line -
   *  except when the click ended a selection, so output stays copyable. */
  private readonly onRootClick = (ev: MouseEvent): void => {
    if (ev.target === this.input) return;
    const sel = typeof document.getSelection === "function" ? document.getSelection() : null;
    if (sel && sel.toString() !== "") return;
    this.focus();
  };
}

function isClear(effect: unknown): boolean {
  return typeof effect === "object" && effect !== null && (effect as { kind?: unknown }).kind === "clear";
}
