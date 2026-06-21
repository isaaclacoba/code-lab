export { CodeLab } from "./code-lab.js";
export { Tour } from "./tour.js";
export type { TourConfig } from "./tour.js";

export { ReadOnlyView } from "./editors/readonly.js";
export { TextareaEditor } from "./editors/textarea.js";
export { MonacoEditor } from "./editors/monaco.js";
export type { MonacoEditorConfig } from "./editors/monaco.js";
export { loadMonaco } from "./editors/load-monaco.js";
export type { LoadMonacoConfig } from "./editors/load-monaco.js";

export { RoslynIframeRunner } from "./runners/roslyn-iframe.js";
export type { RoslynIframeRunnerConfig } from "./runners/roslyn-iframe.js";

export {
  PrismHighlighter,
  PlainHighlighter,
  defaultHighlighter,
} from "./highlighter.js";

// DOM-free core helpers, exported so they can be reused and tested directly.
export {
  normalizeLines,
  splitCodeLines,
  computeLineFlags,
} from "./core/lines.js";
export type { LineFlags } from "./core/lines.js";
export { presentRun, selectRunCode } from "./core/present.js";
export type { RunPresentation, PresentLabels } from "./core/present.js";
export { renderErrorPanel, showErrorPanel } from "./dom/error-panel.js";
export type { ErrorPanelLabels } from "./dom/error-panel.js";
export {
  makeTour,
  goTo,
  next,
  prev,
  atFirst,
  atLast,
  counterLabel,
} from "./core/tour-state.js";
export type { TourModel } from "./core/tour-state.js";

export type {
  CodeLabOptions,
  CodeLabLabels,
  CodeRunner,
  CompileError,
  RunResult,
  Highlighter,
  EditorAdapter,
  EditorKind,
  EditorMountOptions,
  TourStep,
} from "./types.js";
