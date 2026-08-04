// Core contracts for Code Lab. These interfaces are the seams that make the
// component reusable: any highlighter, editor, or compiler backend that
// satisfies them can be dropped in.

export interface CompileError {
  line?: number;
  column?: number;
  /** A learner-friendly explanation, when the backend can provide one. */
  friendly?: string;
  /** The raw compiler message. */
  raw: string;
  /** The concept behind the message, revealed on request rather than up front
   *  so the panel teaches the idea instead of only handing over the fix. */
  why?: string;
}

export interface RunResult {
  compiled: boolean;
  output: string;
  runtimeError?: string | null;
  errors: CompileError[];
  /** Diagnostics that did not stop the build but almost certainly mean the code
   *  does not do what its author intended. A run with warnings still succeeded. */
  warnings?: CompileError[];
}

/** A pluggable compile/run backend. C# (Roslyn/WASM) ships today; any language
 *  can implement this same shape. */
export interface CodeRunner {
  run(code: string): Promise<RunResult>;
  /** Optional warm-up so the first real run is fast. */
  preload?(): Promise<void>;
  /** Optional deeper warm-up: load the runtime and JIT the backend. */
  warm?(): Promise<void>;
}

/** Turns a single line of source into HTML. */
export interface Highlighter {
  highlight(code: string, language: string): string;
}

export interface EditorMountOptions {
  value: string;
  language: string;
  readOnly: boolean;
  /**
   * When set, the editor grows and shrinks to fit its content instead of using
   * a fixed host height. Heights are in pixels and clamped to the given bounds.
   */
  autoHeight?: { minHeight?: number; maxHeight?: number };
}

/** A pluggable editor surface: read-only view, textarea, or Monaco. */
export interface EditorAdapter {
  mount(host: HTMLElement, opts: EditorMountOptions): Promise<void> | void;
  getValue(): string;
  setValue(value: string): void;
  setReadOnly(readOnly: boolean): void;
  /** Optional inline error markers, when the editor supports them. */
  setMarkers?(errors: CompileError[]): void;
  /** Optional running-line highlight. `line` is a 0-based source line;
   *  pass null (or a negative line) to clear it. */
  highlightLine?(line: number | null): void;
  /** Optional buffer-change notification, for a host that must react as the
   *  learner types (a live goal tracker, a structure view). Returns a function
   *  that unsubscribes. Editors that cannot observe changes simply omit it, and
   *  a caller must treat its absence as "this surface is not live". */
  onChange?(listener: (value: string) => void): () => void;
  destroy(): void;
}

/** One step of a line-by-line tour. `lines` are 1-based. */
export interface TourStep {
  text: string;
  lines?: number | number[];
}

export type EditorKind = "readonly" | "textarea" | "monaco";

export interface CodeLabOptions {
  /** The code shown to the reader. */
  code: string;
  /** Language id for highlighting and the editor (e.g. "csharp"). */
  language?: string;
  /** false = read-only view; true = writable editor. Default false. */
  editable?: boolean;
  /** Which editor to use when editable. Default "monaco". Ignored when read-only. */
  editor?: EditorKind;
  /** Optional line-by-line walkthrough. Omit to hide the tour button. */
  tour?: TourStep[];
  /** Optional compile/run backend. Omit to hide the Run button. */
  runner?: CodeRunner;
  /** Optional compilable twin of `code`. The UI shows `code`; the runner uses
   *  this when present, else the current editor value. */
  runCode?: string;
  /** Labels, overridable for i18n. */
  labels?: Partial<CodeLabLabels>;
  /** A highlighter override. Defaults to Prism when available. */
  highlighter?: Highlighter;
  /** Hook fired after a run completes. */
  onRun?: (result: RunResult) => void;
}

export interface CodeLabLabels {
  run: string;
  running: string;
  tour: string;
  noOutput: string;
  runFailed: string;
}
