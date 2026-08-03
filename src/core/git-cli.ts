// A tiny git command-line parser over the teaching model in `git-model.ts`.
// It tokenizes one command line (respecting double/single quotes so a
// `commit -m "add readme"` message stays one token), dispatches to a pure model
// op, and returns the new RepoState plus terminal text that MIMICS real git and
// the op's Effect. It never throws: a GitError or an unknown/unsupported command
// comes back as the input state unchanged, `effect {kind:"none"}`, a git-like
// error line in `output`, and the message in `error`.
//
// No file contents, no I/O, no clock - everything here is a pure function of the
// input line and state, so it is trivially unit-testable and safe to call from
// the terminal widget.

import {
  GitError,
  init,
  stage,
  commit,
  branch,
  tag,
  checkout,
  merge,
  mergeAbort,
  resolvePaths,
  reset,
  revParse,
  revList,
  type RepoState,
  type Effect,
  type Hash,
} from "./git-model.js";

/** The uniform result of running one command line. */
export interface RunResult {
  state: RepoState;
  output: string;
  effect: Effect;
  error?: string;
}

// --- tokenizer -------------------------------------------------------------

/** Split a command line into tokens, honouring `"..."` and `'...'` quoting so a
 *  quoted commit message is a single token. An empty quoted string (`""`) still
 *  yields an empty token. */
export function tokenize(line: string): string[] {
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
  return tokens;
}

// --- pure helpers (mirrors of git-model internals we cannot import) --------

/** The commit HEAD resolves to, or null when the branch is unborn. */
function headCommit(s: RepoState): Hash | null {
  if (s.head.kind === "detached") return s.head.commit;
  return s.refs.get(s.head.name) ?? null;
}

/** The short branch name HEAD is on, or null when detached. */
function currentBranch(s: RepoState): string | null {
  return s.head.kind === "branch"
    ? s.head.name.replace("refs/heads/", "")
    : null;
}

/** FNV-1a 32-bit, matching git-model's hash so an amended id looks native. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic 7-hex commit id (display-only), same preimage as git-model. */
function makeHash(parents: Hash[], message: string, seq: number): Hash {
  const preimage = parents.join(",") + "\n" + message + "\n" + seq;
  return fnv1a(preimage).toString(16).padStart(8, "0").slice(0, 7);
}

/** Fresh Maps + head/merge; commit objects are immutable so they are reused. */
function cloneState(s: RepoState): RepoState {
  return {
    commits: new Map(s.commits),
    refs: new Map(s.refs),
    head:
      s.head.kind === "branch"
        ? { kind: "branch", name: s.head.name }
        : { kind: "detached", commit: s.head.commit },
    index: new Map(s.index),
    worktree: new Map(s.worktree),
    merge: s.merge
      ? { mergeHead: s.merge.mergeHead, conflicted: [...s.merge.conflicted] }
      : undefined,
    seq: s.seq,
  };
}

/** Move HEAD's branch (or detached HEAD) to a commit. Mutates the clone. */
function moveHead(s: RepoState, to: Hash): void {
  if (s.head.kind === "branch") s.refs.set(s.head.name, to);
  else s.head = { kind: "detached", commit: to };
}

/** git commit --amend: replace the HEAD commit with a new one that keeps the
 *  original parents and folds in whatever is staged, then move the branch. The
 *  old commit is left dangling (unreachable), exactly like real git. Pure. */
function amend(state: RepoState, message?: string): { state: RepoState; effect: Effect } {
  const s = cloneState(state);
  const h = headCommit(s);
  if (h === null) throw new GitError("You do not have anything to amend.");
  const old = s.commits.get(h)!;
  const parents = old.parents;
  const paths = [...new Set([...old.paths, ...s.index.keys()])];
  const msg = message ?? old.message;
  const id = makeHash(parents, msg, s.seq);
  s.seq += 1;
  s.commits.set(id, { id, parents, message: msg, paths });
  moveHead(s, id);
  s.index.clear();
  return { state: s, effect: { kind: "commit", id } };
}

// --- terminal-text builders ------------------------------------------------

/** The `[branch (root-commit) 1234567] message` line git prints after a commit. */
function commitLine(s: RepoState, id: Hash): string {
  const c = s.commits.get(id)!;
  const label = currentBranch(s) ?? "detached HEAD";
  const root = c.parents.length === 0 ? " (root-commit)" : "";
  return `[${label}${root} ${id}] ${c.message}`;
}

/** The ref decoration git appends in `log`, e.g. ` (HEAD -> main, tag: v1)`. */
function decorate(s: RepoState, id: Hash): string {
  const parts: string[] = [];
  if (s.head.kind === "branch" && s.refs.get(s.head.name) === id) {
    parts.push(`HEAD -> ${s.head.name.replace("refs/heads/", "")}`);
  } else if (s.head.kind === "detached" && s.head.commit === id) {
    parts.push("HEAD");
  }
  const branches: string[] = [];
  const tags: string[] = [];
  for (const [ref, h] of s.refs) {
    if (h !== id) continue;
    if (ref.startsWith("refs/heads/")) {
      const name = ref.replace("refs/heads/", "");
      if (!(s.head.kind === "branch" && s.head.name === ref)) branches.push(name);
    } else if (ref.startsWith("refs/tags/")) {
      tags.push("tag: " + ref.replace("refs/tags/", ""));
    }
  }
  parts.push(...branches.sort(), ...tags.sort());
  return parts.length ? ` (${parts.join(", ")})` : "";
}

/** `git status` - a plausible subset of real git's porcelain. */
function statusText(s: RepoState): string {
  const lines: string[] = [];
  if (s.head.kind === "branch") {
    lines.push(`On branch ${s.head.name.replace("refs/heads/", "")}`);
    if (headCommit(s) === null) lines.push("No commits yet");
  } else {
    lines.push(`HEAD detached at ${s.head.commit}`);
  }

  if (s.merge && s.merge.conflicted.length > 0) {
    lines.push("You have unmerged paths.");
    lines.push('  (fix conflicts and run "git commit")');
    lines.push("Unmerged paths:");
    lines.push('  (use "git add <file>..." to mark resolution)');
    for (const p of [...s.merge.conflicted].sort()) {
      lines.push(`\tboth modified:   ${p}`);
    }
  }

  const staged = [...s.index.keys()].sort();
  if (staged.length > 0) {
    lines.push("Changes to be committed:");
    lines.push('  (use "git restore --staged <file>..." to unstage)');
    for (const p of staged) lines.push(`\tmodified:   ${p}`);
  }

  const modified = [...s.worktree.keys()].sort();
  if (modified.length > 0) {
    lines.push("Changes not staged for commit:");
    lines.push('  (use "git add <file>..." to update what will be committed)');
    for (const p of modified) lines.push(`\tmodified:   ${p}`);
  }

  if (!s.merge && staged.length === 0 && modified.length === 0) {
    lines.push("nothing to commit, working tree clean");
  }
  return lines.join("\n");
}

/** `git log [--oneline]` over HEAD's ancestors, newest-first. */
function logText(s: RepoState, oneline: boolean): string {
  const ids = revList(s, "HEAD"); // may throw GitError on an unborn branch
  if (oneline) {
    return ids.map((id) => `${id}${decorate(s, id)} ${s.commits.get(id)!.message}`).join("\n");
  }
  return ids
    .map((id) => {
      const c = s.commits.get(id)!;
      return `commit ${id}${decorate(s, id)}\n\n    ${c.message}`;
    })
    .join("\n\n");
}

// --- dispatch --------------------------------------------------------------

const KNOWN = new Set([
  "init",
  "add",
  "status",
  "commit",
  "branch",
  "switch",
  "checkout",
  "merge",
  "reset",
  "tag",
  "log",
  "rev-parse",
  "rev-list",
]);

function ok(state: RepoState, output: string, effect: Effect): RunResult {
  return { state, output, effect };
}

/** Unknown/unsupported command: input unchanged, git-like error, `error` set. */
function unknown(state: RepoState, sub: string): RunResult {
  const msg = `git: '${sub}' is not a git command. See 'git --help'.`;
  return { state, output: msg, effect: { kind: "none" }, error: msg };
}

/**
 * Run one git command line against a RepoState.
 *
 * @param line  the raw command, e.g. `git commit -m "add readme"`.
 * @param state the current repository state (never mutated).
 * @returns the new state + terminal output + the op's Effect (+ `error` on failure).
 */
export function run(line: string, state: RepoState): RunResult {
  let tokens = tokenize(line);
  if (tokens.length && tokens[0] === "git") tokens = tokens.slice(1);
  if (tokens.length === 0) {
    return ok(state, "", { kind: "none" });
  }
  const sub = tokens[0];
  const args = tokens.slice(1);

  try {
    switch (sub) {
      case "init": {
        return ok(init(), "Initialized empty Git repository", { kind: "none" });
      }

      case "add": {
        // During a merge, `git add <path>` marks a conflict resolved.
        if (state.merge) {
          const paths = args.includes(".")
            ? [...state.merge.conflicted]
            : args;
          if (paths.length === 0) {
            return { state, output: "Nothing specified, nothing added.", effect: { kind: "none" }, error: "Nothing specified, nothing added." };
          }
          const r = resolvePaths(state, paths);
          return ok(r.state, "", r.effect);
        }
        // Normal add: `.` expands to every modified worktree path.
        const paths: string[] = [];
        for (const a of args) {
          if (a === ".") paths.push(...state.worktree.keys());
          else paths.push(a);
        }
        if (args.length === 0) {
          return { state, output: "Nothing specified, nothing added.", effect: { kind: "none" }, error: "Nothing specified, nothing added." };
        }
        const r = stage(state, paths);
        return ok(r.state, "", r.effect);
      }

      case "status": {
        return ok(state, statusText(state), { kind: "none" });
      }

      case "commit": {
        const amendFlag = args.includes("--amend");
        const mi = args.indexOf("-m");
        const message = mi >= 0 ? args[mi + 1] : undefined;
        if (amendFlag) {
          const r = amend(state, message);
          return ok(r.state, commitLine(r.state, (r.effect as { id: Hash }).id), r.effect);
        }
        if (message === undefined || message === "") {
          const msg = "Aborting commit due to empty commit message.";
          return { state, output: msg, effect: { kind: "none" }, error: msg };
        }
        const r = commit(state, message);
        const id = (r.effect as { id: Hash }).id;
        return ok(r.state, commitLine(r.state, id), r.effect);
      }

      case "branch": {
        const positional = args.filter((a) => !a.startsWith("-"));
        if (positional.length === 0) {
          // list branches, '*' on the current one
          const names = [...state.refs.keys()]
            .filter((r) => r.startsWith("refs/heads/"))
            .map((r) => r.replace("refs/heads/", ""))
            .sort();
          const cur = currentBranch(state);
          const out = names.map((n) => (n === cur ? `* ${n}` : `  ${n}`)).join("\n");
          return ok(state, out, { kind: "none" });
        }
        const r = branch(state, positional[0], positional[1]);
        return ok(r.state, "", r.effect);
      }

      case "switch":
      case "checkout": {
        const create = args.includes("-c") || args.includes("-b");
        const positional = args.filter((a) => !a.startsWith("-"));
        if (positional.length === 0) {
          const msg = "fatal: missing branch or commit argument";
          return { state, output: msg, effect: { kind: "none" }, error: "missing branch or commit argument" };
        }
        const target = positional[0];
        const r = checkout(state, target, { create });
        let out: string;
        if (create) {
          out = `Switched to a new branch '${target}'`;
        } else if (r.effect.kind === "checkout" && "commit" in r.effect && r.effect.commit) {
          const c = r.state.commits.get(r.effect.commit)!;
          out = `HEAD is now at ${r.effect.commit} ${c.message}`;
        } else {
          out = `Switched to branch '${target}'`;
        }
        return ok(r.state, out, r.effect);
      }

      case "merge": {
        if (args.includes("--abort")) {
          const r = mergeAbort(state);
          return ok(r.state, "", r.effect);
        }
        const rev = args.find((a) => !a.startsWith("-"));
        if (rev === undefined) {
          const msg = "fatal: No commit specified and merge.defaultToUpstream not set.";
          return { state, output: msg, effect: { kind: "none" }, error: "No commit specified" };
        }
        const r = merge(state, rev);
        let out: string;
        switch (r.effect.kind) {
          case "none":
            out = "Already up to date.";
            break;
          case "ff":
            out = `Updating ${r.effect.from}..${r.effect.to}\nFast-forward`;
            break;
          case "merge":
            out = "Merge made by the 'ort' strategy.";
            break;
          case "conflict":
            out =
              r.effect.paths.map((p) => `CONFLICT (content): Merge conflict in ${p}`).join("\n") +
              "\nAutomatic merge failed; fix conflicts and then commit the result.";
            break;
          default:
            out = "";
        }
        return ok(r.state, out, r.effect);
      }

      case "reset": {
        let mode: "soft" | "mixed" | "hard" = "mixed";
        if (args.includes("--soft")) mode = "soft";
        else if (args.includes("--hard")) mode = "hard";
        else if (args.includes("--mixed")) mode = "mixed";
        const rev = args.find((a) => !a.startsWith("-")) ?? "HEAD";
        const r = reset(state, mode, rev);
        let out = "";
        if (mode === "hard") {
          const to = (r.effect as { to: Hash }).to;
          out = `HEAD is now at ${to} ${r.state.commits.get(to)!.message}`;
        }
        return ok(r.state, out, r.effect);
      }

      case "tag": {
        const positional = args.filter((a) => !a.startsWith("-"));
        if (positional.length === 0) {
          const names = [...state.refs.keys()]
            .filter((ref) => ref.startsWith("refs/tags/"))
            .map((ref) => ref.replace("refs/tags/", ""))
            .sort();
          return ok(state, names.join("\n"), { kind: "none" });
        }
        const r = tag(state, positional[0], positional[1]);
        return ok(r.state, "", r.effect);
      }

      case "log": {
        const oneline = args.includes("--oneline");
        return ok(state, logText(state, oneline), { kind: "none" });
      }

      case "rev-parse": {
        const rev = args.find((a) => !a.startsWith("-"));
        if (rev === undefined) {
          const msg = "fatal: rev-parse: no revision given";
          return { state, output: msg, effect: { kind: "none" }, error: "no revision given" };
        }
        return ok(state, revParse(state, rev), { kind: "none" });
      }

      case "rev-list": {
        const range = args.find((a) => a === "--all" || !a.startsWith("-"));
        if (range === undefined) {
          const msg = "fatal: rev-list: no revision given";
          return { state, output: msg, effect: { kind: "none" }, error: "no revision given" };
        }
        return ok(state, revList(state, range).join("\n"), { kind: "none" });
      }

      default:
        if (KNOWN.has(sub)) {
          // Should be unreachable; keeps the exhaustive intent honest.
          return unknown(state, sub);
        }
        return unknown(state, sub);
    }
  } catch (e) {
    if (e instanceof GitError) {
      return { state, output: e.message, effect: { kind: "none" }, error: e.message };
    }
    // Any other unexpected error is still surfaced git-like, never thrown.
    const msg = e instanceof Error ? e.message : String(e);
    return { state, output: `fatal: ${msg}`, effect: { kind: "none" }, error: msg };
  }
}
