// Autoplay: the timer that advances a MemoryViz on its own. Pulled out of the
// facade so the "hold each step, then step forward, then stop at the end" loop is
// one small unit with no knowledge of panels or the DOM. It talks to its host only
// through hooks, so control-button state stays owned by MemoryViz (no split of the
// playing/paused source of truth).

export interface AutoplayHooks {
  /** How long to hold the current step before advancing, in milliseconds. */
  stepMs(): number;
  /** True when there is no further step to advance to. */
  atEnd(): boolean;
  /** Advance one step forward. */
  advance(): void;
  /** Called whenever playback stops - reached the end, or toggled off. */
  onStop(): void;
}

export class Autoplay {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private playing = false;

  constructor(private readonly hooks: AutoplayHooks) {}

  get isPlaying(): boolean {
    return this.playing;
  }

  start(): void {
    if (this.playing) return;
    this.playing = true;
    this.schedule();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.playing = false;
    this.hooks.onStop();
  }

  private schedule(): void {
    this.timer = setTimeout(() => {
      if (!this.playing) return;
      if (this.hooks.atEnd()) return this.stop();
      this.hooks.advance();
      if (this.hooks.atEnd()) this.stop();
      else this.schedule();
    }, this.hooks.stepMs());
  }
}
