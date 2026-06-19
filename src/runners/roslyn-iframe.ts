import type { CodeRunner, RunResult } from "../types.js";

export interface RoslynIframeRunnerConfig {
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
}

const DEFAULT_WARM_PROGRAM =
  "public class __Warm { public static void Main() { } }";

interface Pending {
  resolve: (r: RunResult) => void;
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
 */
export class RoslynIframeRunner implements CodeRunner {
  private url: string;
  private readyTimeout: number;
  private runTimeout: number;
  private warmProgram: string;

  private iframe: HTMLIFrameElement | null = null;
  private readyPromise: Promise<void> | null = null;
  private warmPromise: Promise<void> | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private onMessage = (e: MessageEvent) => this.handleMessage(e);

  constructor(config: RoslynIframeRunnerConfig) {
    this.url = config.url;
    this.readyTimeout = config.readyTimeout ?? 120000;
    this.runTimeout = config.runTimeout ?? 60000;
    this.warmProgram = config.warmProgram ?? DEFAULT_WARM_PROGRAM;
    if (config.autoWarm ?? true) {
      // Best effort: kick off the cold start now so it overlaps with the user
      // reading the page. Consumers can await warm() to drive UI state.
      void this.warm().catch(() => {});
    }
  }

  private handleMessage(event: MessageEvent): void {
    if (event.origin !== window.location.origin) return;
    const data = (event.data || {}) as { type?: string; id?: number; result?: RunResult };
    if (data.type === "coderunner:result" && data.id != null && this.pending.has(data.id)) {
      const entry = this.pending.get(data.id)!;
      clearTimeout(entry.timer);
      this.pending.delete(data.id);
      entry.resolve(data.result as RunResult);
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
        reject(new Error("The code runner took too long to load."));
      }, this.readyTimeout);

      const ready = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if ((event.data || {}).type !== "coderunner:ready") return;
        window.removeEventListener("message", ready);
        clearTimeout(timer);
        resolve();
      };
      window.addEventListener("message", ready);
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
      this.pending.set(id, { resolve, reject, timer });
      this.iframe!.contentWindow!.postMessage(
        { type: "coderunner:run", id, code },
        window.location.origin,
      );
    });
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
