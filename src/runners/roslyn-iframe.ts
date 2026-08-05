import type { CodeRunner, CompileError, RunResult } from "../types.js";
import type { ExecTrace } from "../core/exec-tracer-model.js";

/** What the host sends back for a trace request, before we parse the payload. */
interface TraceResponse {
  compiled: boolean;
  traceJson?: string | null;
  runtimeError?: string | null;
  errors: CompileError[];
}

/** The parsed outcome of a trace: the ExecTrace when it compiled, plus the same
 *  friendly errors a run would report so a UI can explain a failure. */
export interface TraceOutcome {
  compiled: boolean;
  trace?: ExecTrace;
  runtimeError?: string | null;
  errors: CompileError[];
}

export interface IframeRunnerConfig {
  /** URL of the compiler host page (a Blazor WASM app embedding the contract).
   *  Example: "level3-app/index.html?runner=1". Must be same-origin. */
  url: string;
  /** Max wait for the host to signal ready, in ms. Default 120000 (cold WASM). */
  readyTimeout?: number;
  /** Max wait for a single run, in ms. Default 60000. */
  runTimeout?: number;
  /** Start the runtime download and a throwaway compile on construction so the
   *  first real run skips the cold start. Default true. */
  autoWarm?: boolean;
  /** Complete program compiled during warm-up to JIT the backend. */
  warmProgram?: string;
  /** Called as the host boots, so a UI can show real progress instead of a
   *  fixed "preparing" label. `phase` is "download" while the runtime is being
   *  fetched and "start" once it is in and starting up. */
  onProgress?: (progress: BootProgress) => void;
}

export interface BootProgress {
  phase: "download" | "start" | "warm";
  /** Percent of the runtime downloaded, 0-100. Stays at 100 after "download". */
  percent: number;
}

const DEFAULT_WARM_PROGRAM =
  "public class __Warm { public static void Main() { } }";

interface Pending {
  resolve: (r: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Relays code to a compiler host loaded in a hidden, same-origin iframe over
 *  postMessage. Generalized from the C# course: the host URL is configurable,
 *  so any compiler that implements the wire contract can be used.
 *
 *  Wire contract (the host implements the other side):
 *   - host -> parent: { type: "coderunner:ready" }
 *   - parent -> host: { type: "coderunner:run", id, code }
 *   - host -> parent: { type: "coderunner:result", id, result }
 *   - parent -> host: { type: "coderunner:trace", id, code }
 *   - host -> parent: { type: "coderunner:traceResult", id, result }
 */
export class IframeRunner implements CodeRunner {
  private url: string;
  private readyTimeout: number;
  private runTimeout: number;
  private warmProgram: string;

  private onProgress?: (progress: BootProgress) => void;

  private iframe: HTMLIFrameElement | null = null;
  private readyPromise: Promise<void> | null = null;
  private warmPromise: Promise<void> | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private onMessage = (e: MessageEvent) => this.handleMessage(e);

  constructor(config: IframeRunnerConfig) {
    this.url = config.url;
    this.readyTimeout = config.readyTimeout ?? 120000;
    this.runTimeout = config.runTimeout ?? 60000;
    this.warmProgram = config.warmProgram ?? DEFAULT_WARM_PROGRAM;
    this.onProgress = config.onProgress;
    if (config.autoWarm ?? true) {
      // Best effort: kick off the cold start now so it overlaps with the user
      // reading the page. Consumers can await warm() to drive UI state.
      void this.warm().catch(() => {});
    }
  }

  private handleMessage(event: MessageEvent): void {
    if (event.origin !== window.location.origin) return;
    const data = (event.data || {}) as { type?: string; id?: number; result?: unknown };
    const isResult = data.type === "coderunner:result" || data.type === "coderunner:traceResult";
    if (isResult && data.id != null && this.pending.has(data.id)) {
      const entry = this.pending.get(data.id)!;
      clearTimeout(entry.timer);
      this.pending.delete(data.id);
      entry.resolve(data.result);
    }
  }

  private ensureFrame(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;

    window.addEventListener("message", this.onMessage);

    this.iframe = document.createElement("iframe");
    this.iframe.className = "cl-runner-frame";
    this.iframe.setAttribute("aria-hidden", "true");
    this.iframe.setAttribute("tabindex", "-1");
    this.iframe.title = "code runner";
    this.iframe.src = this.url;
    document.body.appendChild(this.iframe);

    this.readyPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        window.removeEventListener("message", boot);
        reject(new Error("The code runner took too long to load."));
      }, this.readyTimeout);

      // One listener for all three boot outcomes. A failed boot used to say
      // nothing, so the caller waited out the whole readyTimeout - two minutes
      // of "preparing" for a fault the host had already detected.
      const boot = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        const data = (event.data || {}) as {
          type?: string;
          phase?: BootProgress["phase"];
          percent?: number;
          message?: string;
        };

        if (data.type === "coderunner:progress") {
          this.onProgress?.({
            phase: data.phase === "start" ? "start" : "download",
            percent: typeof data.percent === "number" ? data.percent : 0,
          });
          return;
        }


        if (data.type === "coderunner:failed") {
          window.removeEventListener("message", boot);
          clearTimeout(timer);
          reject(new Error(data.message || "The code runner failed to load."));
          return;
        }

        if (data.type !== "coderunner:ready") return;
        window.removeEventListener("message", boot);
        clearTimeout(timer);
        resolve();
      };
      window.addEventListener("message", boot);
    });

    return this.readyPromise;
  }

  async preload(): Promise<void> {
    await this.ensureFrame();
  }

  /** Load the runtime and JIT the backend with a throwaway compile so the first
   *  real run is fast. Idempotent: repeated calls share one warm-up. */
  async warm(): Promise<void> {
    if (this.warmPromise) return this.warmPromise;
    this.warmPromise = (async () => {
      await this.ensureFrame();
      // The runtime is up but the compiler has not compiled anything yet, and
      // that first throwaway compile is a slow, silent stretch of its own. The
      // host cannot report it - it is finished booting - so the phase is named
      // here, where it is actually known.
      this.onProgress?.({ phase: "warm", percent: 100 });
      await this.run(this.warmProgram);
    })();
    return this.warmPromise;
  }

  async run(code: string): Promise<RunResult> {
    await this.ensureFrame();
    const id = ++this.seq;
    return new Promise<RunResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("The code took too long to run."));
      }, this.runTimeout);
      this.pending.set(id, { resolve: (r) => resolve(r as RunResult), reject, timer });
      this.iframe!.contentWindow!.postMessage(
        { type: "coderunner:run", id, code },
        window.location.origin,
      );
    });
  }

  /** Trace a program: compile an instrumented copy in the host, run it, and
   *  return the recorded ExecTrace (or the friendly errors if it did not
   *  compile). Mirrors run() over the same iframe wire. */
  async trace(code: string): Promise<TraceOutcome> {
    await this.ensureFrame();
    const id = ++this.seq;
    const response = await new Promise<TraceResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("The code took too long to trace."));
      }, this.runTimeout);
      this.pending.set(id, { resolve: (r) => resolve(r as TraceResponse), reject, timer });
      this.iframe!.contentWindow!.postMessage(
        { type: "coderunner:trace", id, code },
        window.location.origin,
      );
    });
    let trace: ExecTrace | undefined;
    if (response.compiled && response.traceJson) {
      try {
        trace = JSON.parse(response.traceJson) as ExecTrace;
      } catch {
        trace = undefined;
      }
    }
    return {
      compiled: response.compiled,
      trace,
      runtimeError: response.runtimeError ?? null,
      errors: response.errors || [],
    };
  }

  destroy(): void {
    window.removeEventListener("message", this.onMessage);
    this.pending.forEach((p) => clearTimeout(p.timer));
    this.pending.clear();
    this.iframe?.remove();
    this.iframe = null;
    this.readyPromise = null;
    this.warmPromise = null;
  }
}

/** @deprecated Renamed to {@link IframeRunner}. This is a generic postMessage
 *  iframe runner, not tied to Roslyn; the alias is kept for back-compat. */
export const RoslynIframeRunner = IframeRunner;
/** @deprecated Renamed to {@link IframeRunnerConfig}. */
export type RoslynIframeRunnerConfig = IframeRunnerConfig;
