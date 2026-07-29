import { MonacoEditor } from "../editors/monaco.js";
import { loadMonaco } from "../editors/load-monaco.js";
import { RoslynIframeRunner } from "../runners/roslyn-iframe.js";
import { traceToSteps } from "../core/exec-tracer-model.js";
import type { ExecTrace } from "../core/exec-tracer-model.js";
import type { Step } from "../core/memory-model.js";
import { MemoryViz } from "./memory-viz.js";
import { renderErrorPanel } from "./error-panel.js";
import type { LegendItem, PanelSpec, PanelType, VizLayout } from "../core/memory-model.js";
import type { CompileError } from "../types.js";

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

/** How much of the memory model to reveal. Maps to a MemoryViz panel:
 *  values -> a flat variable table (level 0), callstack -> stacked call frames
 *  (level 1), heap -> frames + heap objects joined by reference arrows (level 2). */
export type VizLevel = "values" | "callstack" | "heap";

export interface VizLabConfig {
  /** URL of the compiler host that implements the trace wire (same-origin).
   *  Example: "level3-app/index.html?runner=1". */
  runnerUrl: string;
  /** Code shown in the editor on first load. */
  starter?: string;
  /** Which level of detail to render first. Default "heap" (the richest). */
  level?: VizLevel;
  /** Legend swatches passed through to the visualiser controls. */
  legend?: LegendItem[];
  /** Max wait for the host to warm up, in ms. Passed to the runner. */
  readyTimeout?: number;
}

const LEVELS: { id: VizLevel; label: string; panel: PanelType }[] = [
  { id: "values", label: "Values", panel: "vartable" },
  { id: "callstack", label: "Call stack", panel: "callstack" },
  { id: "heap", label: "Heap", panel: "heapcards" },
];

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
 *  engine, runner, or renderer here. */
export class VizLab {
  private readonly root: HTMLElement;
  private readonly editorHost: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly vizBtn: HTMLButtonElement;
  private readonly levelBtns = new Map<VizLevel, HTMLButtonElement>();

  private readonly editor = new MonacoEditor();
  private readonly runner: RoslynIframeRunner;

  private level: VizLevel;
  private legend?: LegendItem[];
  private lastTrace: ExecTrace | null = null;
  private lastSteps: Step[] | null = null;
  private viz: MemoryViz | null = null;
  private ready = false;

  private constructor(host: HTMLElement, config: VizLabConfig) {
    this.level = config.level ?? "heap";
    this.legend = config.legend;
    this.runner = new RoslynIframeRunner({
      url: config.runnerUrl,
      readyTimeout: config.readyTimeout ?? 180000,
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
    this.vizBtn.textContent = "Preparing compiler...";
    this.vizBtn.disabled = true;
    this.vizBtn.setAttribute("data-viz", "");
    this.vizBtn.addEventListener("click", () => void this.visualize());

    const levelGroup = document.createElement("div");
    levelGroup.className = "cl-vl-levels";
    levelGroup.setAttribute("role", "group");
    levelGroup.setAttribute("aria-label", "Level of detail");
    for (const lvl of LEVELS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cl-btn cl-vl-level";
      b.textContent = lvl.label;
      b.setAttribute("data-level", lvl.id);
      b.setAttribute("aria-pressed", String(lvl.id === this.level));
      b.addEventListener("click", () => this.setLevel(lvl.id));
      this.levelBtns.set(lvl.id, b);
      levelGroup.appendChild(b);
    }

    this.statusEl = document.createElement("span");
    this.statusEl.className = "cl-vl-status";
    this.statusEl.setAttribute("role", "status");
    this.statusEl.setAttribute("aria-live", "polite");

    toolbar.append(this.vizBtn, levelGroup, this.statusEl);

    this.editorHost = document.createElement("div");
    this.editorHost.className = "cl-vl-monaco";

    editorPane.append(toolbar, this.editorHost);

    this.stage = document.createElement("div");
    this.stage.className = "cl-vl-stage";
    this.showHint("Write a small program, then press Visualize to watch it run.");

    this.root.append(editorPane, this.stage);
    host.appendChild(this.root);

    void this.boot(config.starter ?? DEFAULT_STARTER);
  }

  static create(host: HTMLElement, config: VizLabConfig): VizLab {
    return new VizLab(host, config);
  }

  private async boot(starter: string): Promise<void> {
    await loadMonaco();
    await this.editor.mount(this.editorHost, {
      value: starter,
      language: "csharp",
      readOnly: false,
      autoHeight: { minHeight: 220, maxHeight: 640 },
    });
    try {
      await this.runner.warm();
    } catch {
      // Warm-up is best effort; the first Visualize click retries the load.
    } finally {
      this.ready = true;
      this.vizBtn.disabled = false;
      this.vizBtn.textContent = "Visualize";
    }
  }

  private async visualize(): Promise<void> {
    if (!this.ready) return;
    const code = this.editor.getValue();
    this.vizBtn.disabled = true;
    this.vizBtn.textContent = "Tracing...";
    this.setStatus("");
    try {
      const outcome = await this.runner.trace(code);
      if (!outcome.compiled) {
        const errors = normalizeErrors(outcome.errors);
        this.showErrors(errors);
        this.setStatus("Did not compile.");
        if (this.editor.setMarkers) this.editor.setMarkers(errors);
        return;
      }
      if (this.editor.setMarkers) this.editor.setMarkers([]);
      if (!outcome.trace || outcome.trace.steps.length === 0) {
        this.showHint("That program produced no steps to show. Add a statement or two inside Main.");
        this.setStatus("Nothing to trace.");
        return;
      }
      this.lastTrace = outcome.trace;
      this.lastSteps = traceToSteps(outcome.trace);
      this.render();
      const n = outcome.trace.steps.length;
      let msg = `Traced ${n} step${n === 1 ? "" : "s"}.`;
      if (outcome.trace.truncated) msg += " Stopped early - the program ran too long.";
      if (outcome.runtimeError) msg += ` It threw: ${outcome.runtimeError}`;
      this.setStatus(msg);
    } catch (err) {
      this.showHint("The tracer took too long or could not load. Try again.");
      this.setStatus(String((err as Error).message || err));
    } finally {
      this.vizBtn.disabled = false;
      this.vizBtn.textContent = "Visualize";
    }
  }

  private setLevel(level: VizLevel): void {
    if (level === this.level) return;
    this.level = level;
    for (const [id, btn] of this.levelBtns) btn.setAttribute("aria-pressed", String(id === level));
    if (!this.lastTrace || !this.lastSteps) return;
    // Same trace, a different panel: keep the learner's place in the run.
    if (this.viz) {
      this.viz.setSteps(this.lastSteps, {
        code: this.lastTrace.code,
        layout: this.layoutFor(level),
        preserveIndex: true,
      });
    } else {
      this.render();
    }
  }

  private layoutFor(level: VizLevel): VizLayout {
    const panel = LEVELS.find((l) => l.id === level)!.panel;
    return {
      visual: [{ type: "code" }, { type: panel }] as PanelSpec[],
      aside: [{ type: "narration" }, { type: "controls" }] as PanelSpec[],
    };
  }

  private render(): void {
    if (!this.lastTrace || !this.lastSteps) return;
    const layout = this.layoutFor(this.level);
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
      deriveRefs: true,
      autoDim: true,
    });
  }

  private showHint(text: string): void {
    this.teardownViz();
    this.stage.textContent = "";
    const hint = document.createElement("p");
    hint.className = "cl-vl-hint";
    hint.textContent = text;
    this.stage.appendChild(hint);
  }

  private showErrors(errors: CompileError[]): void {
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

  destroy(): void {
    this.teardownViz();
    this.editor.destroy();
    this.runner.destroy();
    this.root.remove();
  }
}
