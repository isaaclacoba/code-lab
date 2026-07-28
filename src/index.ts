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

export { MemoryViz } from "./dom/memory-viz.js";
export type {
  MemoryVizConfig,
  MemoryScene,
  RegionName,
  PanelType,
  PanelSpec,
  VizLayout,
  LegendItem,
  Step as MemoryVizStep,
  VizAction as MemoryVizAction,
  Frame as MemoryVizFrame,
  Slot as MemoryVizSlot,
  GlobalSlot as MemoryVizGlobal,
  HeapObject as MemoryVizHeapObject,
  Ref as MemoryVizRef,
  BoardPart as MemoryVizBoardPart,
  HighlightTarget as MemoryVizHighlightTarget,
} from "./core/memory-model.js";
export {
  ALL_REGIONS,
  FULL_REGIONS,
  deriveRefs,
  referencedIds,
  resolveModel,
} from "./core/memory-model.js";

export type {
  AgentScene,
  AgentToken,
  AgentTokenKind,
  AgentCandidate,
  AgentFan,
  AgentCore,
  AgentTool,
  FanRow,
} from "./core/agent-model.js";
export { agentFanRows } from "./core/agent-model.js";

export type {
  AgentLoopScene,
  AgentLoopNodeId,
  AgentLoopPacket,
  LoopStage,
  AgentLoopToolId,
  AgentLoopMemoryId,
  AgentLoopTool,
  AgentLoopMemoryRow,
} from "./core/agent-loop-model.js";
export {
  agentLoopActiveSet,
  DEFAULT_LOOP_TOOLS,
  DEFAULT_LOOP_MEMORIES,
} from "./core/agent-loop-model.js";

export type {
  MemoryShelfScene,
  MemoryKind,
  ShelfItem,
  MemoryStoreMeta,
  ResolvedStore,
} from "./core/memory-shelf-model.js";
export { DEFAULT_MEMORY_STORES, shelfStores, activeStores } from "./core/memory-shelf-model.js";

export type {
  ToolRackScene,
  ToolState,
  ToolParam,
  RackTool,
  ResolvedRackTool,
  ToolIoKind,
  ToolIoRow,
} from "./core/tool-rack-model.js";
export { formatToolSignature, resolveRackTools, toolRackRows } from "./core/tool-rack-model.js";

export type {
  TranscriptScene,
  TranscriptMessage,
  ResolvedMessage,
  MsgRole,
  MsgAuthor,
  TranscriptFlow,
} from "./core/transcript-model.js";
export { resolveTranscript, authorOf } from "./core/transcript-model.js";

export type { CodeMark } from "./core/code-marks.js";
export {
  resolveMarks,
  spansForLine,
  markedLineHtml,
} from "./core/code-marks.js";

export { Quiz } from "./dom/quiz-view.js";
export type { QuizStore } from "./dom/quiz-view.js";
export type {
  QuizConfig,
  QuizQuestion,
  QuizPlan,
  QuizResult,
  DrawnQuestion,
  DrawnOption,
} from "./core/quiz-model.js";
export { drawQuiz, scoreQuiz, shuffle as shuffleQuiz, neededToPass, firstUnanswered } from "./core/quiz-model.js";

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
