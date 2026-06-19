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
}

export interface RunResult {
  compiled: boolean;
  output: string;
  runtimeError?: string | null;
  errors: CompileError[];
}

/** A pluggable compile/run backend. C# (Roslyn/WASM) ships today; any language
 *  can implement this same shape. */
export interface CodeRunner {
  run(code: string): Promise<RunResult>;
  /** Optional warm-up so the first real run is fast. */
  preload?(): Promise<void>;
}

/** Turns a single line of source into HTML. */
export interface Highlighter {
  highlight(code: string, language: string): string;
}

export interface EditorMountOptions {
  value: string;
  language: string;
  readOnly: boolean;
}

/** A pluggable editor surface: read-only view, textarea, or Monaco. */
export interface EditorAdapter {
  mount(host: HTMLElement, opts: EditorMountOptions): Promise<void> | void;
  getValue(): string;
  setValue(value: string): void;
  setReadOnly(readOnly: boolean): void;
  /** Optional inline error markers, when the editor supports them. */
  setMarkers?(errors: CompileError[]): void;
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
