import { MonacoEditor } from "../editors/monaco.js";
import { loadMonaco } from "../editors/load-monaco.js";
import { IframeRunner } from "../runners/roslyn-iframe.js";
import { traceToSteps } from "../core/exec-tracer-model.js";
import type { ExecTrace } from "../core/exec-tracer-model.js";
import type { Step } from "../core/memory-model.js";
import { MemoryViz } from "./memory-viz.js";
import { renderErrorPanel } from "./error-panel.js";
import type { LegendItem, PanelSpec, VizLayout } from "../core/memory-model.js";
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
  private lastTrace: ExecTrace | null = null;
  private lastSteps: Step[] | null = null;
  private viz: MemoryViz | null = null;
  private ready = false;

  private constructor(host: HTMLElement, config: VizLabConfig) {
    this.legend = config.legend;
    this.language = config.language ?? "csharp";
    this.runner = new IframeRunner({
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
      language: this.language,
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
      // Count the steps the learner will actually click through (the rendered
      // steps less the terminal "finished" beat), so this stays in step with the
      // stepper after redundant call-entry snapshots are collapsed.
      const n = Math.max(0, this.lastSteps.length - 1);
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

  destroy(): void {
    this.teardownViz();
    this.editor.destroy();
    this.runner.destroy();
    this.root.remove();
  }
}
