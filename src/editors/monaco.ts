import type {
  CompileError,
  EditorAdapter,
  EditorMountOptions,
} from "../types.js";

// Monaco is an optional peer dependency. We avoid a static import so the package
// type-checks and bundles without it. The host can provide a monaco namespace
// three ways: passed to the constructor, present as window.monaco (AMD loader,
// as the reference C# capstone does), or dynamically imported from the
// "monaco-editor" module.
type MonacoNamespace = any; // eslint-disable-line @typescript-eslint/no-explicit-any

declare global {
  interface Window {
    monaco?: MonacoNamespace;
  }
}

export interface MonacoEditorConfig {
  /** A monaco namespace to use directly (skips global/dynamic resolution). */
  monaco?: MonacoNamespace;
  /** Editor theme. Default "vs-dark" to match the reference capstone. */
  theme?: string;
}

export class MonacoEditor implements EditorAdapter {
  private monaco: MonacoNamespace | undefined;
  private theme: string;
  private editor: any; // eslint-disable-line @typescript-eslint/no-explicit-any

  constructor(config: MonacoEditorConfig = {}) {
    this.monaco = config.monaco;
    this.theme = config.theme ?? "vs-dark";
  }

  private async resolveMonaco(): Promise<MonacoNamespace> {
    if (this.monaco) return this.monaco;
    if (window.monaco) return (this.monaco = window.monaco);
    try {
      // Indirect specifier so the compiler does not require the optional
      // peer dependency to be installed to type-check this package.
      const specifier = "monaco-editor";
      this.monaco = await import(/* @vite-ignore */ specifier);
      return this.monaco;
    } catch {
      throw new Error(
        "MonacoEditor: monaco-editor is not available. Install it, expose " +
          "window.monaco, or pass { monaco } to the adapter.",
      );
    }
  }

  async mount(host: HTMLElement, opts: EditorMountOptions): Promise<void> {
    const monaco = await this.resolveMonaco();
    this.editor = monaco.editor.create(host, {
      value: opts.value,
      language: opts.language,
      theme: this.theme,
      readOnly: opts.readOnly,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 14,
      lineNumbers: "on",
      tabSize: 4,
      insertSpaces: true,
      scrollBeyondLastLine: false,
      bracketPairColorization: { enabled: true },
    });
  }

  getValue(): string {
    return this.editor ? this.editor.getValue() : "";
  }

  setValue(value: string): void {
    if (this.editor) this.editor.setValue(value);
  }

  setReadOnly(readOnly: boolean): void {
    if (this.editor) this.editor.updateOptions({ readOnly });
  }

  setMarkers(errors: CompileError[]): void {
    if (!this.editor || !this.monaco) return;
    const model = this.editor.getModel();
    if (!model) return;
    const markers = errors.map((e) => ({
      severity: this.monaco.MarkerSeverity.Error,
      message: e.friendly || e.raw,
      startLineNumber: e.line || 1,
      startColumn: e.column || 1,
      endLineNumber: e.line || 1,
      endColumn: (e.column || 1) + 1,
    }));
    this.monaco.editor.setModelMarkers(model, "code-lab", markers);
  }

  destroy(): void {
    this.editor?.dispose?.();
    this.editor = undefined;
  }
}
