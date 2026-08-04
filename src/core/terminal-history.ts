// CommandHistory: the readline-style recall behind LineTerminal's ArrowUp /
// ArrowDown. It is deliberately DOM-free so the walk semantics can be tested
// without a document.
//
// The model is a cursor over `items` (oldest -> newest) plus one extra slot past
// the end: the LIVE line. While the cursor sits on the live line the widget owns
// the text; the first ArrowUp parks that text as `draft` so walking back down
// restores whatever the learner had half-typed - the behaviour a shell user
// expects. Walking past either end is a no-op rather than a wrap-around.

const DEFAULT_LIMIT = 100;

export class CommandHistory {
  private readonly items: string[] = [];
  private readonly limit: number;

  /** Index into `items`; `items.length` means "on the live line". */
  private cursor = 0;
  private draft = "";

  constructor(limit: number = DEFAULT_LIMIT) {
    this.limit = Math.max(1, limit);
  }

  /** Entered commands, oldest first. */
  get entries(): readonly string[] {
    return this.items;
  }

  /** Record a command and return to the live line. Blank lines are not stored,
   *  and a command identical to the previous one is not stored twice. */
  push(line: string): void {
    const value = line.trim();
    if (value !== "" && this.items[this.items.length - 1] !== value) {
      this.items.push(value);
      if (this.items.length > this.limit) this.items.shift();
    }
    this.reset();
  }

  /** Older entry, or `null` when already at the oldest (or history is empty).
   *  `current` is the text on the live line, parked on the first step back. */
  prev(current: string): string | null {
    if (this.cursor === 0) return null;
    if (this.cursor === this.items.length) this.draft = current;
    this.cursor -= 1;
    return this.items[this.cursor] ?? null;
  }

  /** Newer entry, the parked draft when stepping back onto the live line, or
   *  `null` when already on the live line. */
  next(): string | null {
    if (this.cursor >= this.items.length) return null;
    this.cursor += 1;
    return this.cursor === this.items.length ? this.draft : (this.items[this.cursor] ?? null);
  }

  /** Drop the walk position and the parked draft. */
  reset(): void {
    this.cursor = this.items.length;
    this.draft = "";
  }
}
