// Shell: the terminal emulator's command layer.
//
// It is DOM-free and knows nothing about any particular command. A host
// registers command sets - git, a file lister, whatever a lesson needs - and the
// shell does the boring, universal part: split the line into tokens the way a
// real shell does, find the command, hand it its arguments, and turn anything
// that goes wrong into readable text. Everything specific lives in the commands.
//
// The shell is generic over the world the commands act on (`S` - a repo, a
// filesystem, a lesson's state) and stores none of it: `run` takes the state in
// and hands the new state back, so the shell itself is pure and the host stays
// the single owner of state.
//
// It never throws. A learner typing nonsense - or a command with a bug in it -
// comes back as `error: true` and a line of text, never as a broken page.

/** What running one line produced: the state afterwards, the text to print, and
 *  optionally a side effect for the VIEW to carry out. */
export interface ShellResult<S> {
  state: S;
  output: string;
  error?: boolean;
  effect?: unknown;
}

/** One command the shell can dispatch to. */
export interface ShellCommand<S = unknown> {
  /** The word typed first: `git`, `ls`, `reset`. */
  name: string;
  /** One line, shown by `help`. */
  summary: string;
  /** Run it. `argv` EXCLUDES the command name. */
  run(argv: string[], state: S): ShellResult<S>;
  /** Long help for `help <name>`. Falls back to `summary` when absent. */
  help?(argv: string[]): string;
}

/** The effect `clear` returns; the view wipes its scrollback when it sees it. */
export interface ClearEffect {
  kind: "clear";
}

interface Builtin {
  name: string;
  summary: string;
}

const BUILTINS: readonly Builtin[] = [
  { name: "clear", summary: "Clear the terminal screen." },
  { name: "help", summary: "List the commands, or explain one: help <name>." },
];

/** How far apart a typo may be from a real command and still be suggested. */
const SUGGEST_MAX_DISTANCE = 2;

// --- tokenizer -------------------------------------------------------------

/** Split a command line into tokens, honouring `"..."` and `'...'` so a quoted
 *  message stays one token. An empty quoted string (`""`) still yields a token,
 *  which is how `commit -m ""` reaches a command as an explicit empty argument. */
export function tokenize(line: string): string[] {
  return tokenizeLine(line).tokens;
}

/** What splitting a line produced. `error` is set when a quote is opened and
 *  never closed: a real shell would sit there waiting for the rest of the line,
 *  and the one thing it would NOT do is pretend the quote was closed for you. */
export interface TokenizeResult {
  tokens: string[];
  error?: string;
}

export function tokenizeLine(line: string): TokenizeResult {
  const tokens: string[] = [];
  let cur = "";
  let quoted = false; // this token contained a quote (so "" -> a real token)
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inDouble) {
      if (ch === '"') inDouble = false;
      else cur += ch;
    } else if (inSingle) {
      if (ch === "'") inSingle = false;
      else cur += ch;
    } else if (ch === '"') {
      inDouble = true;
      quoted = true;
    } else if (ch === "'") {
      inSingle = true;
      quoted = true;
    } else if (ch === " " || ch === "\t") {
      if (cur !== "" || quoted) {
        tokens.push(cur);
        cur = "";
        quoted = false;
      }
    } else {
      cur += ch;
    }
  }
  if (cur !== "" || quoted) tokens.push(cur);
  if (inDouble || inSingle) {
    const mark = inDouble ? '"' : "'";
    return {
      tokens,
      error:
        `unexpected EOF while looking for matching ${mark}\n` +
        `(the ${mark} you opened is never closed)`,
    };
  }
  return { tokens };
}

// --- did-you-mean ----------------------------------------------------------

/** Levenshtein distance - the number of single-character edits between two
 *  words. Two rolling rows, so it costs no more than the words are long. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a === "") return b.length;
  if (b === "") return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let row = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1] + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    const swap = prev;
    prev = row;
    row = swap;
  }
  return prev[b.length] ?? 0;
}

// --- the shell -------------------------------------------------------------

export class Shell<S = unknown> {
  private readonly registry = new Map<string, ShellCommand<S>>();

  /** Add a command set. Registering a name twice replaces the first. The
   *  built-ins (`help`, `clear`) always win at dispatch time. */
  register(cmd: ShellCommand<S>): this {
    this.registry.set(cmd.name, cmd);
    return this;
  }

  /** The registered commands, sorted by name. Built-ins are not in here - they
   *  belong to the shell, not to a command set. */
  commands(): ShellCommand<S>[] {
    return [...this.registry.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Run one typed line. Never throws. */
  run(line: string, state: S): ShellResult<S> {
    const { tokens: argv, error: syntax } = tokenizeLine(line);
    // A line that does not parse never reaches a command - otherwise an unclosed
    // quote would silently run as if you had closed it.
    if (syntax) return { state, output: syntax, error: true };
    const name = argv[0];
    if (name === undefined) return { state, output: "" };
    const rest = argv.slice(1);

    if (name === "clear") return { state, output: "", effect: { kind: "clear" } as ClearEffect };
    if (name === "help") return { state, output: this.helpText(rest), error: this.helpMissing(rest) };

    const cmd = this.registry.get(name);
    if (!cmd) return { state, output: this.notFound(name), error: true };

    try {
      return cmd.run(rest, state);
    } catch (err) {
      return { state, output: err instanceof Error ? err.message : String(err), error: true };
    }
  }

  // --- built-ins ---------------------------------------------------------

  /** Every name the shell answers to, with its one-line summary, sorted. A
   *  built-in's summary wins over a registered command of the same name,
   *  because the built-in is what actually runs. */
  private catalogue(): Builtin[] {
    const byName = new Map<string, string>();
    for (const cmd of this.registry.values()) byName.set(cmd.name, cmd.summary);
    for (const b of BUILTINS) byName.set(b.name, b.summary);
    return [...byName.entries()]
      .map(([name, summary]) => ({ name, summary }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private helpText(argv: string[]): string {
    const wanted = argv[0];
    if (wanted === undefined) {
      const all = this.catalogue();
      const width = all.reduce((w, c) => Math.max(w, c.name.length), 0);
      return all.map((c) => `${c.name.padEnd(width)}  ${c.summary}`).join("\n");
    }
    const builtin = BUILTINS.find((b) => b.name === wanted);
    if (builtin) return builtin.summary;
    const cmd = this.registry.get(wanted);
    if (!cmd) return `help: no such command: ${wanted}`;
    return cmd.help ? cmd.help(argv.slice(1)) : cmd.summary;
  }

  private helpMissing(argv: string[]): true | undefined {
    const wanted = argv[0];
    if (wanted === undefined) return undefined;
    if (BUILTINS.some((b) => b.name === wanted)) return undefined;
    return this.registry.has(wanted) ? undefined : true;
  }

  private notFound(name: string): string {
    const near = this.suggest(name);
    return `${name}: command not found` + (near ? `  Did you mean '${near}'?` : "");
  }

  /** The closest known name within `SUGGEST_MAX_DISTANCE` edits, ties broken
   *  alphabetically so the message is stable. */
  private suggest(name: string): string | null {
    let best: string | null = null;
    let bestDistance = SUGGEST_MAX_DISTANCE + 1;
    for (const { name: candidate } of this.catalogue()) {
      const d = editDistance(name, candidate);
      if (d < bestDistance) {
        best = candidate;
        bestDistance = d;
      }
    }
    return bestDistance <= SUGGEST_MAX_DISTANCE ? best : null;
  }
}
