// Optional CDN loader for the Monaco editor. Monaco ships as an AMD bundle, so a
// host normally has to add the loader script, wire a cross-origin worker proxy,
// and call require() by hand. This helper does all of that and resolves
// window.monaco, so a consumer can just: await loadMonaco(); new MonacoEditor().
// Kept out of the editor adapter so a read-only embed never pulls Monaco in.
type MonacoNamespace = any; // eslint-disable-line @typescript-eslint/no-explicit-any

declare global {
  interface Window {
    monaco?: MonacoNamespace;
    // AMD loader entry points injected by monaco's loader.min.js.
    require?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    MonacoEnvironment?: { getWorkerUrl?: () => string };
  }
}

export interface LoadMonacoConfig {
  /** Base URL of monaco's "min/vs" folder. Default: jsDelivr 0.52.2. */
  base?: string;
  /** Register curated, client-side C# completions. Default true. */
  registerCSharp?: boolean;
}

const DEFAULT_BASE =
  "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs";

let pending: Promise<MonacoNamespace> | undefined;

export function loadMonaco(config: LoadMonacoConfig = {}): Promise<MonacoNamespace> {
  if (window.monaco) return Promise.resolve(window.monaco);
  if (pending) return pending;

  const base = config.base ?? DEFAULT_BASE;
  const registerCSharp = config.registerCSharp ?? true;

  pending = ensureLoaderScript(base)
    .then(() => configureWorker(base))
    .then(() => requireEditorMain(base))
    .then((monaco) => {
      if (registerCSharp) registerCSharpCompletions(monaco);
      return monaco;
    });

  return pending;
}

function ensureLoaderScript(base: string): Promise<void> {
  if (window.require) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${base}/loader.min.js`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("loadMonaco: failed to load loader.min.js"));
    document.head.appendChild(script);
  });
}

function configureWorker(base: string): void {
  // Cross-origin web workers from a CDN must be proxied through a data URL.
  window.MonacoEnvironment = {
    getWorkerUrl: () =>
      `data:text/javascript;charset=utf-8,${encodeURIComponent(`
        self.MonacoEnvironment = { baseUrl: '${base.replace(/\/vs$/, "")}/' };
        importScripts('${base}/base/worker/workerMain.js');
      `)}`,
  };
}

function requireEditorMain(base: string): Promise<MonacoNamespace> {
  return new Promise((resolve) => {
    window.require.config({ paths: { vs: base } });
    window.require(["vs/editor/editor.main"], () => resolve(window.monaco));
  });
}

// Curated C# suggestions so completions work on static hosting (no language
// server). Mirrors the set used by the reference capstone host.
function registerCSharpCompletions(monaco: MonacoNamespace): void {
  const keywords = [
    "public", "private", "protected", "internal", "static", "void", "class",
    "interface", "abstract", "virtual", "override", "sealed", "readonly",
    "const", "new", "return", "if", "else", "for", "foreach", "while", "do",
    "switch", "case", "break", "continue", "using", "namespace", "this",
    "base", "null", "true", "false", "var", "int", "string", "bool", "double",
    "float", "decimal", "char", "object", "enum", "struct", "try", "catch",
    "finally", "throw", "get", "set", "in", "out", "ref", "params", "async", "await",
  ];
  const members = [
    { label: "Console.WriteLine", insert: "Console.WriteLine($0);", doc: "Write a line to the console" },
    { label: "Console.Write", insert: "Console.Write($0);", doc: "Write to the console" },
    { label: "Console.ReadLine", insert: "Console.ReadLine()", doc: "Read a line from the console" },
    { label: "string.IsNullOrEmpty", insert: "string.IsNullOrEmpty($0)", doc: "Check for null or empty string" },
    { label: "List<T>", insert: "List<$0>", doc: "Generic list" },
    { label: "Dictionary<TKey, TValue>", insert: "Dictionary<$1, $2>", doc: "Generic dictionary" },
    { label: "ToString", insert: "ToString()", doc: "Convert to string" },
  ];
  const snippets = [
    { label: "class", insert: "public class ${1:Name}\n{\n    $0\n}", doc: "Class definition" },
    { label: "interface", insert: "public interface I${1:Name}\n{\n    $0\n}", doc: "Interface definition" },
    { label: "ctor", insert: "public ${1:Type}()\n{\n    $0\n}", doc: "Constructor" },
    { label: "method", insert: "public ${1:void} ${2:Name}()\n{\n    $0\n}", doc: "Method" },
    { label: "prop", insert: "public ${1:string} ${2:Name} { get; set; }", doc: "Auto property" },
    { label: "foreach", insert: "foreach (var ${1:item} in ${2:items})\n{\n    $0\n}", doc: "Foreach loop" },
  ];

  monaco.languages.registerCompletionItemProvider("csharp", {
    provideCompletionItems(model: any, position: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const K = monaco.languages.CompletionItemKind;
      const R = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
      const suggestions: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
      for (const kw of keywords) {
        suggestions.push({ label: kw, kind: K.Keyword, insertText: kw, range });
      }
      for (const m of members) {
        suggestions.push({ label: m.label, kind: K.Method, detail: m.doc, insertText: m.insert, insertTextRules: R, range });
      }
      for (const s of snippets) {
        suggestions.push({ label: s.label, kind: K.Snippet, detail: s.doc, insertText: s.insert, insertTextRules: R, range });
      }
      return { suggestions };
    },
  });
}
