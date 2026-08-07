import { MonacoEditor } from "../editors/monaco.js";
import { loadMonaco } from "../editors/load-monaco.js";
import { IframeRunner } from "../runners/roslyn-iframe.js";
import { traceToSteps } from "../core/exec-tracer-model.js";
import type { ExecTrace } from "../core/exec-tracer-model.js";
import type { Step } from "../core/memory-model.js";
import { MemoryViz } from "./memory-viz.js";
import { renderErrorPanel } from "./error-panel.js";
import type { LegendItem, PanelSpec, VizLabels, VizLayout } from "../core/memory-model.js";
import { DEFAULT_VIZ_LABELS } from "../core/memory-model.js";
import type { CompileError } from "../types.js";
import { mergeTemplates, fill } from "../core/template.js";
import { classifyTraceOutcome, tracerFailedOutcome } from "../core/viz-trace-outcome.js";
import type { VizTraceOutcome } from "../core/viz-trace-outcome.js";
import type { TraceNarration } from "../core/trace-narration.js";
import { bootWait, traceWait } from "../core/wait-progress.js";

/** The trace wire reports optional line/friendly as number|string|null; the
 *  shared error panel wants them as number|string|undefined. Normalize once. */
function normalizeErrors(
  errors: { line?: number | null; friendly?: string | null; raw: string }[],
): CompileError[] {
  return errors.map((e) => ({
    line: e.line ?? undefined,
    friendly: e.friendly ?? undefined,
    raw: e.raw,
  }));
}

/** @deprecated The surface now always shows the full memory view (the call stack
 *  and the heap together); this alias is kept only so older imports still type. */
export type VizLevel = "values" | "memory";

export interface VizLabConfig {
  /** URL of the compiler host that implements the trace wire (same-origin).
   *  Example: "level3-app/index.html?runner=1". */
  runnerUrl: string;
  /** Code shown in the editor on first load. */
  starter?: string;
  /** @deprecated The surface no longer has a level toggle - it always shows the
   *  full memory view. Accepted and ignored for backward compatibility. */
  level?: string;
  /** Editor language id for Monaco. Default "csharp". */
  language?: string;
  /** Legend swatches passed through to the visualiser controls. */
  legend?: LegendItem[];
  /** Max wait for the host to warm up, in ms. Passed to the runner. */
  readyTimeout?: number;
  /** Overridable chrome strings for i18n - VizLab's own button and status lines,
   *  and the labels of the MemoryViz panels it mounts. Any omitted key keeps its
   *  English default; an override that drops a `{slot}` is refused. */
  labels?: Partial<VizLabels>;
  /** Translated templates for the captions the tracer generates per step. Omit
   *  for English. */
  narration?: Partial<TraceNarration>;
  /** Called after every Visualize press with what the run actually did. This is
   *  the seam a host grades against: the widget shows the trace, and this hands
   *  out the same trace, so the thing marked is the thing on screen.
   *
   *  It fires on EVERY press, including the ones that produced no picture - code
   *  that did not compile, threw, hit the step budget, or a tracer that never
   *  loaded - because "did not run" and "ran and was wrong" are different
   *  verdicts and a grader must be able to tell them apart. */
  onTrace?: (outcome: VizTraceOutcome) => void;
}

const DEFAULT_STARTER = [
  "class Program",
  "{",
  "    static void Main()",
  "    {",
  "        int a = 3;",
  "        int b = 4;",
  "        int total = a + b;",
  "        System.Console.WriteLine(total);",
  "    }",
  "}",
].join("\n");

/** The "Visualize my code" surface: a Monaco editor whose C# is traced by the
 *  real compiler host, then animated by the same MemoryViz renderer the
 *  hand-authored scenes use. It is pure composition - editor, the runner's
 *  trace() wire, the traceToSteps adapter, and MemoryViz - so there is no new
 *  engine, runner, or renderer here.
 *
 *  There is one view: the full memory picture (the call stack and the heap
 *  objects side by side). The running line is highlighted in the editor itself,
 *  so the code is shown once, not duplicated in a separate panel. */
export class VizLab {
  private readonly root: HTMLElement;
  private readonly editorHost: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly vizBtn: HTMLButtonElement;

  private readonly editor = new MonacoEditor();
  private readonly runner: IframeRunner;

  private legend?: LegendItem[];
  private readonly language: string;
  private readonly labels: VizLabels;
  private readonly narration?: Partial<TraceNarration>;
  private readonly onTrace?: (outcome: VizTraceOutcome) => void;
  private lastTrace: ExecTrace | null = null;
  private lastSteps: Step[] | null = null;
  private viz: MemoryViz | null = null;
  private ready = false;
  private mounted = false;
  private pendingSource: string | null = null;
  private traceTimer: ReturnType<typeof setInterval> | null = null;

  private constructor(host: HTMLElement, config: VizLabConfig) {
    this.legend = config.legend;
    this.language = config.language ?? "csharp";
    this.labels = mergeTemplates(DEFAULT_VIZ_LABELS, config.labels).merged;
    this.narration = config.narration;
    this.onTrace = config.onTrace;
    this.runner = new IframeRunner({
      url: config.runnerUrl,
      readyTimeout: config.readyTimeout ?? 180000,
      // The runtime is ~30MB, so this wait is tens of seconds on a slow line.
      // Reporting the phase is what answers "is it stuck?" - only the download
      // has a number, and it is the phase most likely to be the slow one.
      onProgress: (progress) => this.showBootPhase(progress.phase, progress.percent),
    });

    this.root = document.createElement("div");
    this.root.className = "cl-vl";

    const editorPane = document.createElement("div");
    editorPane.className = "cl-vl-editor";

    const toolbar = document.createElement("div");
    toolbar.className = "cl-vl-toolbar";

    this.vizBtn = document.createElement("button");
    this.vizBtn.type = "button";
    this.vizBtn.className = "cl-btn cl-primary cl-vl-run";
    this.vizBtn.textContent = this.labels.vlPreparing;
    this.vizBtn.disabled = true;
    this.vizBtn.setAttribute("aria-busy", "true");
    this.vizBtn.setAttribute("data-viz", "");
    this.vizBtn.addEventListener("click", () => void this.visualize());

    this.statusEl = document.createElement("span");
    this.statusEl.className = "cl-vl-status";
    this.statusEl.setAttribute("role", "status");
    this.statusEl.setAttribute("aria-live", "polite");

    toolbar.append(this.vizBtn, this.statusEl);

    this.editorHost = document.createElement("div");
    this.editorHost.className = "cl-vl-monaco";

    editorPane.append(toolbar, this.editorHost);

    this.stage = document.createElement("div");
    this.stage.className = "cl-vl-stage";
    this.showHint(this.labels.vlHint);

    this.root.append(editorPane, this.stage);
    host.appendChild(this.root);

    void this.boot(config.starter ?? DEFAULT_STARTER);
  }

  static create(host: HTMLElement, config: VizLabConfig): VizLab {
    return new VizLab(host, config);
  }

  /** Paint a wait inside the button: a label naming the phase, over a bar.
   *
   *  `percent` null means "no measurable progress" - the bar then animates
   *  instead of filling, because a fake percentage that creeps to 90% and stops
   *  is worse than an honest "this is still going". Every wait longer than a
   *  second lands here, so none of them can look like a hang. */
  private showWait(label: string, percent: number | null): void {
    let bar = this.vizBtn.querySelector<HTMLElement>(".cl-vl-wait-fill");
    let text = this.vizBtn.querySelector<HTMLElement>(".cl-vl-wait-label");
    if (!bar || !text) {
      this.vizBtn.textContent = "";
      const wrap = document.createElement("span");
      wrap.className = "cl-vl-wait";
      text = document.createElement("span");
      text.className = "cl-vl-wait-label";
      const track = document.createElement("span");
      track.className = "cl-vl-wait-bar";
      bar = document.createElement("span");
      bar.className = "cl-vl-wait-fill";
      track.appendChild(bar);
      wrap.append(text, track);
      this.vizBtn.appendChild(wrap);
    }
    text.textContent = label;
    if (percent === null) {
      bar.classList.add("is-indeterminate");
      bar.style.width = "";
      this.vizBtn.removeAttribute("aria-valuenow");
    } else {
      const pct = Math.max(0, Math.min(100, Math.round(percent)));
      bar.classList.remove("is-indeterminate");
      bar.style.width = pct + "%";
      this.vizBtn.setAttribute("aria-valuenow", String(pct));
    }
  }

  /** Put the button back to a plain label, ending whatever wait it was showing. */
  private endWait(label: string): void {
    if (this.traceTimer !== null) {
      clearInterval(this.traceTimer);
      this.traceTimer = null;
    }
    this.vizBtn.textContent = label;
    this.vizBtn.removeAttribute("aria-busy");
    this.vizBtn.removeAttribute("aria-valuenow");
  }

  private showBootPhase(phase: "download" | "start" | "warm", percent: number): void {
    if (this.ready) return;
    const wait = bootWait(this.labels, phase, percent);
    this.showWait(wait.label, wait.percent);
  }

  private async boot(starter: string): Promise<void> {
    await loadMonaco();
    // Monaco is fetched from a CDN, so a host that calls setSource() while that
    // is in flight would otherwise lose the code: MonacoEditor.setValue is a
    // no-op before mount. The pending value wins over the constructor's starter,
    // being the more recent instruction.
    await this.editor.mount(this.editorHost, {
      value: this.pendingSource ?? starter,
      language: this.language,
      readOnly: false,
      autoHeight: { minHeight: 220, maxHeight: 640 },
    });
    this.mounted = true;
    // mount() is itself awaited, so a write can arrive after its argument was
    // evaluated and before it resolves. Re-check rather than assume.
    if (this.pendingSource !== null) {
      this.editor.setValue(this.pendingSource);
      this.pendingSource = null;
    }
    try {
      await this.runner.warm();
    } catch {
      // Warm-up is best effort; the first Visualize click retries the load.
    } finally {
      this.ready = true;
      this.vizBtn.disabled = false;
      this.endWait(this.labels.vlVisualize);
    }
  }

  private async visualize(): Promise<void> {
    if (!this.ready) return;
    const code = this.editor.getValue();
    this.vizBtn.disabled = true;
    this.vizBtn.setAttribute("aria-busy", "true");
    // A trace is one round trip to the host, which reports no sub-phases, so
    // there is no honest percentage here. Count the wait instead: seconds
    // ticking up is the difference between "working" and "hung".
    const startedAt = Date.now();
    const tick = (): void => {
      const wait = traceWait(this.labels, Date.now() - startedAt);
      this.showWait(wait.label, wait.percent);
    };
    tick();
    if (this.traceTimer !== null) clearInterval(this.traceTimer);
    this.traceTimer = setInterval(tick, 1000);
    this.setStatus("");
    // Every path out of here reports exactly once, so a host grading on `onTrace`
    // never has to guess whether a press it saw start ever finished.
    let report: VizTraceOutcome | null = null;
    try {
      const result = await this.runner.trace(code);
      report = classifyTraceOutcome({
        compiled: result.compiled,
        trace: result.trace,
        runtimeError: result.runtimeError,
        errors: normalizeErrors(result.errors),
      });
      if (!result.compiled) {
        const errors = normalizeErrors(result.errors);
        this.showErrors(errors);
        this.setStatus(this.labels.vlDidNotCompile);
        if (this.editor.setMarkers) this.editor.setMarkers(errors);
        return;
      }
      if (this.editor.setMarkers) this.editor.setMarkers([]);
      if (!result.trace || result.trace.steps.length === 0) {
        this.showHint(this.labels.vlNoStepsHint);
        this.setStatus(this.labels.vlNoSteps);
        return;
      }
      this.lastTrace = result.trace;
      this.lastSteps = traceToSteps(result.trace, this.narration);
      this.render();
      // Count the steps the learner will actually click through (the rendered
      // steps less the terminal "finished" beat), so this stays in step with the
      // stepper after redundant call-entry snapshots are collapsed.
      const n = Math.max(0, this.lastSteps.length - 1);
      let msg = fill(n === 1 ? this.labels.vlTracedOne : this.labels.vlTracedMany, { n });
      if (result.trace.truncated) msg += this.labels.vlTruncated;
      if (result.runtimeError) msg += fill(this.labels.vlThrew, { message: result.runtimeError });
      this.setStatus(msg);
    } catch (err) {
      const message = String((err as Error).message || err);
      report = tracerFailedOutcome(message);
      this.showHint(this.labels.vlFailedHint);
      // The thrown text is developer English from the throw site, so it is shown
      // only as the detail line under the widget's own translated hint.
      this.setStatus(message);
    } finally {
      this.vizBtn.disabled = false;
      this.endWait(this.labels.vlVisualize);
      if (report) this.onTrace?.(report);
    }
  }

  /** The one layout: the memory view (call stack + heap objects) in the wide
   *  column, then narration, the console output, and the transport controls in
   *  the reading rail. The console sits right under the narration so "this line
   *  runs" and "this is what it printed" read together. */
  private memoryLayout(): VizLayout {
    return {
      visual: [{ type: "heapcards" }] as PanelSpec[],
      aside: [{ type: "narration" }, { type: "console" }, { type: "controls" }] as PanelSpec[],
    };
  }

  private render(): void {
    if (!this.lastTrace || !this.lastSteps) return;
    const layout = this.memoryLayout();
    if (this.viz) {
      this.viz.setSteps(this.lastSteps, {
        code: this.lastTrace.code,
        layout,
        preserveIndex: false,
      });
      return;
    }
    this.stage.textContent = "";
    this.viz = MemoryViz.create(this.stage, {
      code: this.lastTrace.code,
      steps: this.lastSteps,
      layout,
      legend: this.legend,
      labels: this.labels,
      deriveRefs: true,
      autoDim: true,
      onStep: (info) => this.editor.highlightLine?.(info.pc),
    });
  }

  private showHint(text: string): void {
    this.editor.highlightLine?.(null);
    this.teardownViz();
    this.stage.textContent = "";
    const hint = document.createElement("p");
    hint.className = "cl-vl-hint";
    hint.textContent = text;
    this.stage.appendChild(hint);
  }

  private showErrors(errors: CompileError[]): void {
    this.editor.highlightLine?.(null);
    this.teardownViz();
    this.stage.textContent = "";
    this.stage.appendChild(renderErrorPanel(errors));
  }

  private teardownViz(): void {
    this.viz?.destroy();
    this.viz = null;
    this.lastTrace = null;
    this.lastSteps = null;
  }

  private setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  /** Load a different exercise into the editor without tearing the widget down,
   *  so a lesson can move between cards while keeping the one warmed compiler
   *  this surface owns. Clears the stage back to its hint - the picture on
   *  screen belongs to the code that produced it, never to the next exercise. */
  setSource(code: string): void {
    if (!this.mounted) {
      // Before the editor exists there is nothing to write into, and dropping
      // this silently hands the learner an empty editor. Hold it for boot().
      this.pendingSource = code;
      return;
    }
    this.editor.setValue(code);
    if (this.editor.setMarkers) this.editor.setMarkers([]);
    this.setStatus("");
    this.showHint(this.labels.vlHint);
  }

  /** The learner's current code. A host grades the trace, not the text; this is
   *  for saving work and for restoring it, not for marking. */
  getSource(): string {
    if (!this.mounted) return this.pendingSource ?? "";
    return this.editor.getValue();
  }

  destroy(): void {
    this.teardownViz();
    this.editor.destroy();
    this.runner.destroy();
    this.root.remove();
  }
}
