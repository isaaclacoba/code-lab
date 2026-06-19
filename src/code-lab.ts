import type {
  CodeLabLabels,
  CodeLabOptions,
  EditorAdapter,
  EditorKind,
  Highlighter,
  RunResult,
} from "./types.js";
import { defaultHighlighter } from "./highlighter.js";
import { presentRun, selectRunCode } from "./core/present.js";
import { Tour } from "./tour.js";
import { ReadOnlyView } from "./editors/readonly.js";
import { TextareaEditor } from "./editors/textarea.js";
import { MonacoEditor } from "./editors/monaco.js";

const DEFAULT_LABELS: CodeLabLabels = {
  run: "Run this example",
  running: "Running...",
  tour: "Walk me through the code",
  noOutput: "(no output)",
  runFailed: "Could not run the example.",
};

function buildEditor(
  editable: boolean,
  kind: EditorKind,
  highlighter: Highlighter,
): EditorAdapter {
  if (!editable || kind === "readonly") return new ReadOnlyView(highlighter);
  if (kind === "textarea") return new TextareaEditor(highlighter);
  return new MonacoEditor();
}

/** The public facade: mounts an editor (read-only or writable), an optional
 *  line-by-line tour, and an optional Run button wired to a pluggable runner. */
export class CodeLab {
  private opts: CodeLabOptions;
  private labels: CodeLabLabels;
  private highlighter: Highlighter;
  private editor: EditorAdapter;
  private tour: Tour | null = null;
  private editable: boolean;

  private root: HTMLElement;
  private editorHost!: HTMLElement;
  private tourBtn?: HTMLButtonElement;
  private runBtn?: HTMLButtonElement;
  private output?: HTMLPreElement;

  private constructor(host: HTMLElement, opts: CodeLabOptions) {
    this.opts = opts;
    this.labels = { ...DEFAULT_LABELS, ...(opts.labels ?? {}) };
    this.highlighter = opts.highlighter ?? defaultHighlighter();
    this.editable = opts.editable ?? false;
    const kind: EditorKind = opts.editor ?? "monaco";
    this.editor = buildEditor(this.editable, kind, this.highlighter);

    this.root = document.createElement("div");
    this.root.className = "cl-root";
    host.appendChild(this.root);
  }

  static create(host: HTMLElement, opts: CodeLabOptions): CodeLab {
    const lab = new CodeLab(host, opts);
    void lab.init();
    return lab;
  }

  private async init(): Promise<void> {
    const language = this.opts.language ?? "csharp";

    this.editorHost = document.createElement("div");
    this.editorHost.className = "cl-editor-host";
    this.root.appendChild(this.editorHost);

    await this.editor.mount(this.editorHost, {
      value: this.opts.code,
      language,
      readOnly: !this.editable,
    });

    const actions = document.createElement("div");
    actions.className = "cl-actions";

    if (this.opts.tour && this.opts.tour.length) {
      this.tour = new Tour({ highlighter: this.highlighter, language });
      this.tourBtn = document.createElement("button");
      this.tourBtn.type = "button";
      this.tourBtn.className = "cl-btn cl-primary";
      this.tourBtn.textContent = this.labels.tour;
      this.tourBtn.addEventListener("click", () => this.openTour());
      actions.appendChild(this.tourBtn);
    }

    if (this.opts.runner) {
      this.runBtn = document.createElement("button");
      this.runBtn.type = "button";
      this.runBtn.className = "cl-btn";
      this.runBtn.textContent = this.labels.run;
      this.runBtn.addEventListener("click", () => void this.run());
      actions.appendChild(this.runBtn);
    }

    if (actions.childElementCount) this.root.appendChild(actions);

    if (this.opts.runner) {
      this.output = document.createElement("pre");
      this.output.className = "cl-output";
      this.output.hidden = true;
      this.output.setAttribute("aria-live", "polite");
      this.root.appendChild(this.output);
    }
  }

  openTour(): void {
    if (!this.tour || !this.opts.tour) return;
    this.tour.open({
      title: this.labels.tour,
      code: this.opts.code,
      steps: this.opts.tour,
    });
  }

  async run(): Promise<RunResult | undefined> {
    const runner = this.opts.runner;
    if (!runner) return undefined;

    const code = selectRunCode(this.opts.runCode, this.getValue());
    if (this.runBtn) {
      this.runBtn.disabled = true;
      this.runBtn.textContent = this.labels.running;
    }
    this.showOutput(this.labels.running, false);

    let result: RunResult | undefined;
    try {
      result = await runner.run(code);
      const view = presentRun(result, { noOutput: this.labels.noOutput });
      if (view.markers.length) this.editor.setMarkers?.(view.markers);
      this.showOutput(view.text, view.isError);
      this.opts.onRun?.(result);
    } catch (err) {
      this.showOutput((err as Error).message || this.labels.runFailed, true);
    } finally {
      if (this.runBtn) {
        this.runBtn.disabled = false;
        this.runBtn.textContent = this.labels.run;
      }
    }
    return result;
  }

  private showOutput(text: string, isError: boolean): void {
    if (!this.output) return;
    this.output.hidden = false;
    this.output.textContent = text;
    this.output.classList.toggle("is-error", isError);
  }

  getValue(): string {
    return this.editor.getValue();
  }

  setValue(value: string): void {
    this.opts.code = value;
    this.editor.setValue(value);
  }

  setEditable(editable: boolean): void {
    this.editable = editable;
    this.editor.setReadOnly(!editable);
  }

  destroy(): void {
    this.tour?.destroy();
    this.editor.destroy();
    this.root.remove();
  }
}
