# Code Lab

An embeddable code component: a code block with an optional editor (read-only or
writable), a line-by-line guided tour, and a pluggable compile/run backend.

Extracted and generalized from a C# OO course so any project and any language can
reuse it. Written in TypeScript; ships as ESM, CJS, and an IIFE global, with type
declarations.

## Install

```
npm install code-lab
```

Monaco and Prism are optional peer dependencies, loaded only when used.

## Quick start

```ts
import { CodeLab } from "code-lab";
import "code-lab/code-lab.css";

CodeLab.create(document.getElementById("demo")!, {
  code: 'Console.WriteLine("hi");',
  language: "csharp",
  tour: [{ text: "This prints a line.", lines: 1 }],
});
```

No build step? Use the IIFE global:

```html
<link rel="stylesheet" href="code-lab/dist/code-lab.css" />
<script src="code-lab/dist/code-lab.global.js"></script>
<script>
  CodeLab.CodeLab.create(document.getElementById("demo"), { code: "..." });
</script>
```

## Options

| Option        | Type                       | Default     | Notes                                            |
| ------------- | -------------------------- | ----------- | ------------------------------------------------ |
| `code`        | `string`                   | (required)  | Code shown to the reader.                        |
| `language`    | `string`                   | `"csharp"`  | Highlight + editor language id.                  |
| `editable`    | `boolean`                  | `false`     | `false` = read-only view; `true` = editor.       |
| `editor`      | `"monaco"\|"textarea"\|"readonly"` | `"monaco"` | Editor when editable.                    |
| `tour`        | `TourStep[]`               | -           | Line-by-line walkthrough. Omit to hide.          |
| `runner`      | `CodeRunner`               | -           | Compile/run backend. Omit to hide the Run button. |
| `runCode`     | `string`                   | -           | Compilable twin of `code` (see below).           |
| `onRun`       | `(r: RunResult) => void`   | -           | Hook after a run completes.                       |

### Why `runCode` is separate from `code`

The displayed `code` is often a teaching fragment that is not a runnable program
(no entry point, or declarations after statements). `runCode` holds the
self-contained, compilable twin. The UI always shows `code`; only the runner sees
`runCode`. When omitted, the current editor value is run.

## Running code: pluggable backends

Execution is backend-agnostic. Any object implementing `CodeRunner` works:

```ts
interface RunResult {
  compiled: boolean;
  output: string;
  runtimeError?: string | null;
  errors: { line?: number; column?: number; friendly?: string; raw: string }[];
}

interface CodeRunner {
  run(code: string): Promise<RunResult>;
  preload?(): Promise<void>;
}
```

### Shipped: `RoslynIframeRunner` (C#)

Loads a compiler host (a Blazor WASM app) in a hidden, same-origin iframe and
relays code over `postMessage`:

```ts
import { CodeLab, RoslynIframeRunner } from "code-lab";

const runner = new RoslynIframeRunner({ url: "level3-app/index.html?runner=1" });
runner.preload(); // optional warm-up

CodeLab.create(host, { code, runCode, runner });
```

### Compiler host contract

The host page implements the other side of the wire protocol (same-origin only):

- host to parent: `{ type: "coderunner:ready" }`
- parent to host: `{ type: "coderunner:run", id, code }`
- host to parent: `{ type: "coderunner:result", id, result }` where `result`
  matches `RunResult`.

Any language that compiles to WASM can implement this host. Python (Pyodide) or a
Web Worker backend would instead implement `CodeRunner` directly.

## Editors

- `readonly` - Prism-highlighted block, no external dependency. Used whenever
  `editable` is false.
- `monaco` - the Monaco editor (the default when editable). Resolved at runtime
  from a passed instance, `window.monaco`, or the `monaco-editor` module.
- `textarea` - a styled textarea with a Prism underlay; zero external dependency.

## Theming

Override the CSS variables on `.cl-root` (e.g. `--cl-accent`, `--cl-code-bg`).

## Accessibility

The tour modal uses `role="dialog"`, `aria-modal`, `aria-labelledby`, a focus
trap, Esc to close, focus restore, and arrow-key navigation. The output panel is
an `aria-live` region.

## Build

```
npm run build      # dist: ESM + CJS + IIFE + .d.ts + css
npm run typecheck
```
