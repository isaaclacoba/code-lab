export { CodeLab } from "./code-lab.js";
export { Tour } from "./tour.js";
export type { TourConfig } from "./tour.js";

export { ReadOnlyView } from "./editors/readonly.js";
export { TextareaEditor } from "./editors/textarea.js";
export { MonacoEditor } from "./editors/monaco.js";
export type { MonacoEditorConfig } from "./editors/monaco.js";
export { loadMonaco } from "./editors/load-monaco.js";
export { scanCSharp, receiverBefore, membersOf, stripCommentsAndStrings } from "./core/csharp-symbols.js";
export type { CSharpSymbols, TypeSymbol, MemberSymbol, VarSymbol, TypeKind, MemberKind } from "./core/csharp-symbols.js";
export type { LoadMonacoConfig } from "./editors/load-monaco.js";

export { IframeRunner, RoslynIframeRunner } from "./runners/roslyn-iframe.js";
export type { BootProgress, IframeRunnerConfig, RoslynIframeRunnerConfig, TraceOutcome } from "./runners/roslyn-iframe.js";

export { MemoryViz } from "./dom/memory-viz.js";
export { VizLab } from "./dom/viz-lab.js";
export type { VizLabConfig, VizLevel } from "./dom/viz-lab.js";

export { GitGraph } from "./dom/git-graph-view.js";
export type { GitGraphInspect } from "./dom/git-graph-view.js";
export type { RepoState, Hash, Commit, RefName, Head } from "./core/git-model.js";
export type { GraphLayout, LayoutNode, LayoutEdge, LayoutChip } from "./core/git-layout.js";
export { layout as gitLayout } from "./core/git-layout.js";
// The git RUNTIME: without these the vendored bundle can draw a repo but not change
// one, so the course's git plugin could never run a learner's command.
export {
  init as gitInit, addFiles as gitAddFiles, stage as gitStage, commit as gitCommit, branch as gitBranch,
  tag as gitTag, checkout as gitCheckout, merge as gitMerge, mergeAbort as gitMergeAbort,
  resolvePaths as gitResolvePaths, reset as gitReset, revParse as gitRevParse,
  rebase as gitRebase,
  revList as gitRevList, GitError,
  edit as gitEdit, fileAt as gitFileAt, treeAt as gitTreeAt,
} from "./core/git-model.js";
export type { OpResult, Effect, WorktreeEntry, WorktreeStatus } from "./core/git-model.js";
// Text merging: the course grades and displays conflicts, so the merge itself
// has to be reachable from the bundle.
export { merge3 as gitMerge3, splitLines as gitSplitLines, joinLines as gitJoinLines } from "./core/text-merge.js";
export type { Merge3Result, MergeLabels } from "./core/text-merge.js";
export { formatFileDiff as gitFormatFileDiff, diffLines as gitDiffLines } from "./core/text-diff.js";
// The file panel under the git board.
export { resolveFilePanel as gitResolveFilePanel, panelFiles as gitPanelFiles } from "./core/file-panel.js";
export type { FilePanel, PanelZone, ZoneCopy } from "./core/file-panel.js";
// Reading and settling a file git left markers in.
export { findConflicts as gitFindConflicts, resolveConflicts as gitResolveConflicts, hasConflictMarkers as gitHasConflictMarkers } from "./core/conflict-file.js";
export type { ConflictRegion, ConflictChoice } from "./core/conflict-file.js";
export { run as gitRun } from "./core/git-cli.js";
// git as a command set the terminal Shell can register. The shell owns tokenizing,
// help and unknown-command handling; this is only the git subcommands.
export { createGitCommand, gitSubcommands } from "./terminal/commands/git.js";
// `echo ... > file` - the only way to change what is INSIDE a file.
export { echoCommand as createEchoCommand } from "./terminal/commands/echo.js";
export type { RunResult as GitRunResult } from "./core/git-cli.js";
// The line console the git track types into (dependency-free; xterm.js is deferred).
// The terminal module: a console that RUNS commands. It knows nothing about git -
// git is just a command set registered on the shell.
export { Shell, tokenize as shellTokenize, tokenizeLine as shellTokenizeLine } from "./terminal/shell.js";
export type { ShellCommand, ShellResult, ClearEffect } from "./terminal/shell.js";
export { LineTerminal } from "./terminal/line-terminal.js";
export type { LineTerminalOptions, LineKind } from "./terminal/line-terminal.js";
export { CommandHistory } from "./terminal/history.js";
export type {
  MemoryVizConfig,
  MemoryScene,
  RegionName,
  PanelType,
  PanelSpec,
  VizLayout,
  LegendItem,
  VizLabels,
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
export { DEFAULT_VIZ_LABELS } from "./core/memory-model.js";

export { traceToSteps } from "./core/exec-tracer-model.js";
export type {
  ExecTrace,
  TraceStep,
  TraceFrame,
  TraceVar,
  TraceObject,
} from "./core/exec-tracer-model.js";

export { DEFAULT_TRACE_NARRATION, resolveNarration } from "./core/trace-narration.js";
export type { TraceNarration } from "./core/trace-narration.js";

export { fill, missingPlaceholders, mergeTemplates, placeholdersOf } from "./core/template.js";
export type { TemplateIssue } from "./core/template.js";

export { classifyTraceOutcome, tracerFailedOutcome } from "./core/viz-trace-outcome.js";
export type { VizTraceOutcome, VizTraceStatus, RunnerTraceResult } from "./core/viz-trace-outcome.js";

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

export type {
  RetrievalScene,
  RetrievalDoc,
  ResolvedDoc,
  DocState,
} from "./core/retrieval-model.js";
export { resolveRetrieval } from "./core/retrieval-model.js";

export type {
  PlanScene,
  PlanStep,
  ResolvedPlanStep,
  PlanState,
} from "./core/planboard-model.js";
export { resolvePlan, planProgress } from "./core/planboard-model.js";
export type { RepoScene, SceneFile } from "./core/repo-scene.js";
export { resolveRepo } from "./core/repo-scene.js";
export type {
  ChainRow, ObjectAct, ObjectLens, ObjectsScene, Replay, ResolvedObjectsScene,
} from "./core/objects-scene.js";
export {
  DEFAULT_AUTHOR, chainRows, objectFocusKeys, replayObjects, resolveObjects, short,
} from "./core/objects-scene.js";
export type {
  CommitFields, HeadState, ObjectId, ObjectType, StoredObject, TreeEntry,
} from "./core/git-objects.js";
export {
  MODE_DIR, MODE_EXEC, MODE_FILE, ObjectStore, bytesOf, commitBody, hashObject,
  objectBytes, sha1, treeBody, treeSortKey,
} from "./core/git-objects.js";

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
  QuizLabels,
  DrawnQuestion,
  DrawnOption,
} from "./core/quiz-model.js";
export { drawQuiz, scoreQuiz, conceptResults, shuffle as shuffleQuiz, neededToPass, firstUnanswered } from "./core/quiz-model.js";

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
export type { ErrorPanelLabels, ErrorPanelOptions } from "./dom/error-panel.js";
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
