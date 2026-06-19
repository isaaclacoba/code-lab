# Code Lab — design spec

An embeddable code component that combines three capabilities behind one
configurable widget:

1. A code block with an optional editor (read-only or writable, toggleable).
2. A line-by-line guided explanation ("tour").
3. A compile/run environment, with the language backend pluggable.

Extracted from the C# OO course (`code-tour.js`, `code-runner.js`, and the
Roslyn-in-WASM bridge), generalized so any project and any language can reuse it.

## Language and toolchain

The component is two parts that need not share a language:

| Part | Language | Why |
| --- | --- | --- |
| The widget (editor + tour + output UI) | **TypeScript** | Browser/DOM code; the spec is full of contracts (`CodeRunner`, `EditorAdapter`, `RunResult`) that consumers code against, so enforced types and autocomplete earn their keep. Monaco itself is TypeScript, so the editor adapter integrates cleanly. |
| The compiler host (a runner backend) | **Per language** | Whatever that language already compiles to WASM. C# uses the existing Roslyn-in-Blazor host. Python would use Pyodide. Rust would use a Rust-playground-style WASM host. These are pluggable adapters, added independently of the widget. |

Decisions:

- The widget is **TypeScript**, not plain JS (contracts are first-class) and not
  Rust/WASM (heavy toolchain and awkward npm/`<script>` consumption for what is
  lightweight UI glue).
- Compiler hosts stay in each language's natural stack. **Rust is only relevant
  as a future compiler host** (e.g. a Rust-teaching course), never for the UI.
- Build toolchain: **tsup** (esbuild-based) to emit both an ES module and a
  bundled IIFE from one TypeScript source, with `.d.ts` type declarations.

## Goals

- One component, mounted onto a container element, configured by a plain object.
- Editor is optional and toggleable: read-only viewing or writable editing.
- Line-by-line explanation is optional.
- Execution is optional and backend-agnostic: C# (Roslyn/WASM) today, others later.
- No build step required to consume it (ship an ES module + a bundled IIFE).

## Non-goals

- Not a full IDE. No file tree, no multi-file projects, no debugging.
- Not a language server. Autocomplete is whatever the editor adapter provides.
- Not tied to any one runtime. The component never imports a compiler directly.

## Public API

```ts
import { CodeLab } from "code-lab";

const lab = CodeLab.create(container, {
  code: "Console.WriteLine(\"hi\");",
  language: "csharp",        // drives the highlighter + editor adapter
  editable: false,           // false = read-only block; true = writable editor
  editor: "monaco",          // "monaco" (default when editable) | "textarea"
  tour: [                     // optional line-by-line explanation
    { text: "This prints a line.", lines: 1 },
  ],
  runner: roslynRunner,      // optional CodeRunner; omit to hide the Run button
  runCode: undefined,        // optional compilable twin of `code` (see below)
  onRun: (result) => {},     // optional hook after a run completes
});

lab.getValue();              // current editor text
lab.setValue(text);
lab.setEditable(true|false); // toggle at runtime
lab.openTour();              // open the line-by-line walkthrough
lab.run();                   // compile + run via the configured runner
lab.destroy();
```

### Why `runCode` is separate from `code`

The displayed `code` is often a teaching fragment that is not a compilable
program (no entry point, or declarations after statements). `runCode` holds the
self-contained, compilable twin. When omitted, the component runs `code` as-is.
The UI always shows `code`; only the runner ever sees `runCode`.

## Architecture

Three internal modules behind one facade, so each can be reused alone:

```
CodeLab (facade)
├── Highlighter      pluggable: PrismHighlighter (default)
├── Editor adapter   pluggable: MonacoEditor (default) | TextareaEditor | ReadOnlyView
├── Tour             the line-by-line modal (from code-tour.js)
└── Runner           pluggable backend (interface below)
```

### CodeRunner interface

The single seam that makes the component language-agnostic. Any backend that
satisfies this can be dropped in.

```ts
interface RunResult {
  compiled: boolean;
  output: string;
  runtimeError?: string | null;
  errors: Array<{ line?: number; column?: number; friendly?: string; raw: string }>;
}

interface CodeRunner {
  run(code: string): Promise<RunResult>;
  preload?(): Promise<void>;   // optional warm-up
}
```

Shipped adapters:

- `RoslynIframeRunner({ url })` — generalized from `code-runner.js`. Loads a
  compiler host (the Blazor WASM app) in a hidden, same-origin iframe and relays
  code over `postMessage`. URL is configurable instead of hard-coded.
- Reference stubs documented for `PyodideRunner` and `WorkerRunner` so other
  languages have a clear template. Not implemented in v1.

### Editor adapter interface

```ts
interface EditorAdapter {
  mount(host: HTMLElement, opts: { value: string; language: string; readOnly: boolean }): Promise<void>;
  getValue(): string;
  setValue(v: string): void;
  setReadOnly(b: boolean): void;
  setMarkers?(errors: RunResult["errors"]): void;  // optional inline error markers
  destroy(): void;
}
```

- `MonacoEditor` — Monaco 0.52.2 (the version the Capstone already uses),
  `vs-dark`, with the same C# completion provider lifted from the Capstone host.
- `TextareaEditor` — a styled `<textarea>` with a Prism highlight underlay.
  Zero external dependency.
- `ReadOnlyView` — Prism-highlighted, non-editable block (used when
  `editable: false`); also what the tour renders per line.

## Coupling to remove during extraction

From the current course code:

- `code-runner.js` hard-codes `CAPSTONE_URL = "level3-app/index.html?runner=1"`
  → becomes the `url` option of `RoslynIframeRunner`.
- `code-tour.js` is a single `window.codeTour` singleton and assumes Prism +
  C# → becomes an instance, with the highlighter and language injected.
- The postMessage contract (`coderunner:ready` / `coderunner:run` /
  `coderunner:result`, same-origin checked) is kept as the stable wire protocol
  between widget and compiler host, and documented so any host can implement it.

## Compiler host contract

Any language backend that wants to use `RoslynIframeRunner`-style embedding
implements this host side (the course's `RunnerBridge.razor` +
`codeRunnerHost` are the reference implementation):

- On ready: `postMessage({ type: "coderunner:ready" }, parentOrigin)`.
- On `{ type: "coderunner:run", id, code }` (same-origin only): compile + run,
  then `postMessage({ type: "coderunner:result", id, result }, origin)`.
- `result` matches `RunResult`.

## Security

- The iframe runner enforces same-origin on every message (both directions).
- Untrusted code runs inside the compiler host's sandbox (e.g. Blazor WASM), not
  in the host page. The widget never `eval`s user code itself.
- The host page passes only strings across the boundary; no DOM or function refs.

## Packaging

- TypeScript source (`src/index.ts`); built with **tsup** into an ES module
  (`dist/code-lab.js`), a bundled IIFE (`dist/code-lab.global.js`) attaching
  `window.CodeLab` for no-build `<script>` use, and `.d.ts` type declarations.
- `package.json` with `main`/`module`/`types`/`exports`, publishable to npm.
- Monaco and Prism are peer/optional dependencies loaded on demand, so a
  read-only, no-runner embed pulls in nothing heavy.
- CSS shipped as a single `code-lab.css`; class names namespaced under `cl-`.

## Accessibility (carried over from the tour)

- Modal: `role="dialog"`, `aria-modal`, `aria-labelledby`, focus trap, Esc to
  close, focus restore on close, arrow-key step navigation.
- Editor and Run button reachable by keyboard; output panel is a live region.

## Migration of the existing course

Once the component exists, `level4.js` stops embedding code/tour/run logic and
instead calls `CodeLab.create(...)` per card, passing the lesson's `code`,
`walk` (as `tour`), and `runCode`, with a shared `RoslynIframeRunner` pointed at
`level3-app/index.html?runner=1`. The Capstone can optionally adopt the same
`MonacoEditor` adapter to deduplicate its editor setup.

## Open questions

- Repo name: `code-lab` placeholder. Final name TBD.
- Do we ship the Roslyn compiler host as part of this repo (a reusable
  `coderunner` Blazor template), or keep hosts in consuming projects?
- Theming: expose CSS variables vs. a small theme object.

## Rollout

1. Scaffold the standalone TypeScript repo (this folder): tsup build emitting
   ES module + IIFE + `.d.ts`.
2. Port `code-tour.js` -> `Tour` (instance-based, injectable highlighter).
3. Port `code-runner.js` -> `RoslynIframeRunner` (configurable URL).
4. Add editor adapters: `ReadOnlyView`, then `MonacoEditor`, then `TextareaEditor`.
5. Build the `CodeLab` facade + CSS.
6. Prove it by refactoring one Level 4 card to consume the published component.
