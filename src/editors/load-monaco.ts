// Optional CDN loader for the Monaco editor. Monaco ships as an AMD bundle, so a
// host normally has to add the loader script, wire a cross-origin worker proxy,
// and call require() by hand. This helper does all of that and resolves
// window.monaco, so a consumer can just: await loadMonaco(); new MonacoEditor().
// Kept out of the editor adapter so a read-only embed never pulls Monaco in.
import { scanCSharp, receiverBefore, membersOf } from "../core/csharp-symbols.js";
import type { MemberSymbol, TypeSymbol } from "../core/csharp-symbols.js";

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
  /** Base URL of monaco's "min/vs" folder. Default: {@link DEFAULT_BASE}
   *  (cdnjs 0.52.2). Point this at your own copy to avoid the CDN. */
  base?: string;
  /** Register curated, client-side C# completions. Default true. */
  registerCSharp?: boolean;
}

/** Default Monaco CDN + version used when no `base` is supplied. Consumers that
 *  want a pinned/offline copy should pass their own `base` to loadMonaco(). */
const MONACO_VERSION = "0.52.2";
const DEFAULT_BASE =
  `https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/${MONACO_VERSION}/min/vs`;

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
// server). Mirrors the set used by the reference capstone host, and is joined at
// request time by the symbols the LEARNER declared in the buffer (scanCSharp),
// so `class Dog` is offered back as `Dog` and `dog.` lists Dog's own members.
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
    // `.` so member completions appear as soon as the learner types a dot,
    // instead of only after the next letter.
    triggerCharacters: ["."],
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

      // Read what the learner has actually written. Never let a scan failure
      // break typing - fall back to the curated list.
      let scanned: ReturnType<typeof scanCSharp> = { types: [], vars: [] };
      let lineUpToCursor = "";
      try {
        scanned = scanCSharp(model.getValue());
        lineUpToCursor = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });
      } catch { /* keep the curated list */ }

      const memberKind = (m: MemberSymbol): number =>
        m.kind === "method" ? K.Method
          : m.kind === "property" ? K.Property
            : m.kind === "enumMember" ? K.EnumMember
              : K.Field;

      // After `x.` offer ONLY that receiver's members. When the receiver cannot
      // be resolved, return nothing rather than dumping the global list - a
      // keyword list after a dot is noise, and wrong.
      const receiver = receiverBefore(lineUpToCursor);
      if (receiver) {
        // `ToString()` comes from System.Object, so it is valid after any
        // receiver at all - resolved or not.
        const toStringItem = {
          label: "ToString", kind: K.Method, detail: "string ToString()",
          insertText: "ToString()", insertTextRules: undefined, range,
        };
        const own = membersOf(scanned, receiver);
        if (own) {
          return {
            suggestions: own.map((m) => ({
              label: m.name,
              kind: memberKind(m),
              detail: m.detail,
              insertText: m.kind === "method" ? `${m.name}($0)` : m.name,
              insertTextRules: m.kind === "method" ? R : undefined,
              range,
            })).concat([toStringItem]),
          };
        }
        // Not one of the learner's types - `Console.`, `string.`, an unresolved
        // local. Offer the curated entries written for that receiver, with the
        // receiver trimmed off since it is already typed. Returning nothing
        // here would hide Console.WriteLine the moment the dot is pressed.
        const prefix = `${receiver}.`;
        const curated = members
          .filter((m) => m.label.startsWith(prefix))
          .map((m) => ({
            label: m.label.slice(prefix.length),
            kind: K.Method,
            detail: m.doc,
            insertText: m.insert.startsWith(prefix) ? m.insert.slice(prefix.length) : m.insert,
            insertTextRules: R,
            range,
          }));
        return { suggestions: curated.concat([toStringItem]) };
      }

      const suggestions: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
      // The learner's own symbols go FIRST: sortText "0" outranks the curated
      // entries, so `Dog` beats `double` when they type "Do".
      const typeKind = (t: TypeSymbol): number =>
        t.kind === "interface" ? K.Interface
          : t.kind === "enum" ? K.Enum
            : t.kind === "struct" ? K.Struct : K.Class;
      for (const t of scanned.types) {
        suggestions.push({
          label: t.name, kind: typeKind(t), detail: `${t.kind} ${t.name} (yours)`,
          insertText: t.name, sortText: "0" + t.name, range,
        });
      }
      for (const v of scanned.vars) {
        suggestions.push({
          label: v.name, kind: K.Variable, detail: v.type ? `${v.type} ${v.name}` : v.name,
          insertText: v.name, sortText: "0" + v.name, range,
        });
      }
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
