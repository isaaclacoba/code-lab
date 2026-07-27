// ProgressStore: the one place that persists a lesson's completion and the course
// XP total. Kept out of MemoryViz (which composes and drives panels) so the
// persistence concern is separate and testable - the backing store is injected
// and defaults to localStorage, so a test passes a plain in-memory map.

/** The slice of the Web Storage API this needs. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class ProgressStore {
  private awarded = false;

  constructor(
    private readonly xpKey: string,
    private readonly awardedKey: string | undefined,
    private readonly awardAmount: number,
    private readonly store: KeyValueStore = globalThis.localStorage,
  ) {}

  /** The course XP total held in the store. */
  xp(): number {
    return parseInt(this.store.getItem(this.xpKey) || "0", 10);
  }

  /** Grant this lesson's XP the first time it is completed, once per store and
   *  once per session. No-ops when there is no awardedKey; never throws when the
   *  store is unavailable - progress simply is not saved. Returns the XP total. */
  awardOnce(): number {
    if (this.awarded || !this.awardedKey) return this.xp();
    this.awarded = true;
    try {
      const done = JSON.parse(this.store.getItem(this.awardedKey) || "{}");
      if (!done.done) {
        this.store.setItem(this.awardedKey, JSON.stringify({ done: true }));
        this.store.setItem(this.xpKey, String(this.xp() + this.awardAmount));
      }
    } catch {
      /* storage unavailable - progress simply is not saved */
    }
    return this.xp();
  }
}
