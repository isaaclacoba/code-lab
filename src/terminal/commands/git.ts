// The `git` command set for the terminal shell.
//
// This is the whole command-line side of the teaching git: it takes the words a
// learner typed, dispatches them to a pure op in `git-model.ts`, and turns the
// result into the text real git would print. It owns no state and does no I/O,
// so every line of it is a pure function of (argv, state).
//
// It does NOT tokenize and it does NOT decide what "command not found" looks
// like - the shell owns both. What lives here is only what is git-specific:
// which subcommands exist, what each one does, what each one prints, and the
// help that tells a learner the truth about which of them this model supports.
//
// It never throws. A GitError, a bad revision, an unknown subcommand - each
// comes back as the input state unchanged, `effect {kind:"none"}`, a git-like
// line in `output`, and the message in `error`.

import {
  GitError,
  init,
  stage,
  unstage,
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
} from "../../core/git-model.js";
import { editDistance, type ShellCommand, type ShellResult } from "../shell.js";

/** The uniform result of running one git command line. */
export interface GitRunResult {
  state: RepoState;
  output: string;
  effect: Effect;
  error?: string;
}

// --- what this git supports ------------------------------------------------

/** One subcommand, as `git help` advertises it. `usage` holds the argument
 *  forms without the leading `git `; the first becomes `usage:`, the rest
 *  `   or:`, exactly like real git. */
interface SubcommandDoc {
  name: string;
  summary: string;
  usage: string[];
}

/**
 * Every subcommand this model really implements, in teaching order (the order a
 * learner meets them), which is also the order `git help` prints.
 *
 * Nothing else may be listed here. `rebase`, `cherry-pick`, `stash`, `reflog`
 * and everything remote are deliberately not in the model, so advertising them
 * would be a promise the learner breaks on their next keystroke.
 */
const SUBCOMMANDS: readonly SubcommandDoc[] = [
  {
    name: "init",
    summary: "Start a new, empty repository.",
    usage: ["init"],
  },
  {
    name: "status",
    summary: "Show what is staged, changed, and untracked.",
    usage: ["status"],
  },
  {
    name: "add",
    summary: "Stage a path for the next commit, or mark a conflict resolved.",
    usage: ["add <path>...", "add ."],
  },
  {
    name: "commit",
    summary: "Record the staged changes as a new commit.",
    usage: ["commit -m <message>", "commit --amend [-m <message>]"],
  },
  {
    name: "log",
    summary: "Show the history behind HEAD, newest first.",
    usage: ["log [--oneline]"],
  },
  {
    name: "branch",
    summary: "List the branches, or create one.",
    usage: ["branch", "branch <name> [<start-point>]"],
  },
  {
    name: "switch",
    summary: "Move HEAD to another branch.",
    usage: ["switch <branch>", "switch -c <new-branch>"],
  },
  {
    name: "checkout",
    summary: "Move HEAD to a branch, or straight to a commit (detached HEAD).",
    usage: ["checkout <branch>", "checkout <commit>", "checkout -b <new-branch>"],
  },
  {
    name: "merge",
    summary: "Join another branch into the current one.",
    usage: ["merge <branch>", "merge --abort"],
  },
  {
    name: "reset",
    summary: "Move the current branch to another commit.",
    usage: ["reset [--soft | --mixed | --hard] [<commit>]"],
  },
  {
    name: "tag",
    summary: "List the tags, or put a name on a commit.",
    usage: ["tag", "tag <name> [<commit>]"],
  },
  {
    name: "rev-parse",
    summary: "Print the commit a revision resolves to.",
    usage: ["rev-parse <revision>"],
  },
  {
    name: "rev-list",
    summary: "List the commits in a range.",
    usage: ["rev-list <revision>", "rev-list <a>..<b>", "rev-list <a>...<b>", "rev-list --all"],
  },
  {
    name: "help",
    summary: "List these commands, or explain one.",
    usage: ["help [<command>]"],
  },
];

const DOC_BY_NAME = new Map(SUBCOMMANDS.map((d) => [d.name, d]));

/** How far a typo may be from a real subcommand and still be suggested. */
const SUGGEST_MAX_DISTANCE = 2;

// --- help text -------------------------------------------------------------

/** The `git help` / `git --help` listing. */
function helpList(): string {
  const width = SUBCOMMANDS.reduce((w, d) => Math.max(w, d.name.length), 0);
  return [
    "usage: git <command> [<args>]",
    "",
    "These are the git commands this course supports:",
    "",
    ...SUBCOMMANDS.map((d) => `   ${d.name.padEnd(width)}   ${d.summary}`),
    "",
    "Run 'git help <command>' to see one command's usage.",
  ].join("\n");
}

/** The usage block for one subcommand. */
function helpFor(doc: SubcommandDoc): string {
  const lines = doc.usage.map((u, i) => `${i === 0 ? "usage:" : "   or:"} git ${u}`);
  return lines.join("\n") + "\n\n" + doc.summary;
}

/** The closest supported subcommand to `name`, or null when nothing is near.
 *  Ties break in the table's own order, so the message is stable. */
function suggest(name: string): string | null {
  let best: string | null = null;
  let bestDistance = SUGGEST_MAX_DISTANCE + 1;
  for (const { name: candidate } of SUBCOMMANDS) {
    const d = editDistance(name, candidate);
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return bestDistance <= SUGGEST_MAX_DISTANCE ? best : null;
}

/** Real git's wording for an unknown subcommand - but pointing at `git help`,
 *  which exists here, and naming the nearest real command when there is one. */
function unknownText(sub: string): string {
  const near = suggest(sub);
  const head = `git: '${sub}' is not a git command. See 'git help'.`;
  return near ? `${head}\n\nThe most similar command is\n\t${near}` : head;
}

// --- pure helpers (mirrors of git-model internals we cannot import) --------

/** The commit HEAD resolves to, or null when the branch is unborn. */
function headCommit(s: RepoState): Hash | null {
  if (s.head.kind === "detached") return s.head.commit;
  return s.refs.get(s.head.name) ?? null;
}

/** The short branch name HEAD is on, or null when detached. */
function currentBranch(s: RepoState): string | null {
  return s.head.kind === "branch" ? s.head.name.replace("refs/heads/", "") : null;
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

/** What a worktree entry can be. Pinned here so status reads both the current
 *  model ("modified" only) and the seeded one that adds "untracked". */
type WorktreeStatus = "modified" | "untracked";

/** The worktree, widened to the shape status reads. `ReadonlyMap` is covariant
 *  in its value, so this is a plain assignment either way. */
function worktreeOf(s: RepoState): ReadonlyMap<string, WorktreeStatus> {
  return s.worktree;
}

/** `git status` - a plausible subset of real git's porcelain. */
function statusText(s: RepoState): string {
  const blocks: string[][] = [];

  const header: string[] = [];
  if (s.head.kind === "branch") {
    header.push(`On branch ${s.head.name.replace("refs/heads/", "")}`);
    if (headCommit(s) === null) header.push("No commits yet");
  } else {
    header.push(`HEAD detached at ${s.head.commit}`);
  }
  blocks.push(header);

  if (s.merge && s.merge.conflicted.length > 0) {
    const block = [
      "You have unmerged paths.",
      '  (fix conflicts and run "git commit")',
      "Unmerged paths:",
      '  (use "git add <file>..." to mark resolution)',
    ];
    for (const p of [...s.merge.conflicted].sort()) block.push(`\tboth modified:   ${p}`);
    blocks.push(block);
  }

  const staged = [...s.index.keys()].sort();
  if (staged.length > 0) {
    const block = [
      "Changes to be committed:",
      '  (use "git reset <file>..." to unstage)',
    ];
    for (const p of staged) block.push(`\tmodified:   ${p}`);
    blocks.push(block);
  }

  const modified: string[] = [];
  const untracked: string[] = [];
  for (const [path, kind] of worktreeOf(s)) {
    if (kind === "untracked") untracked.push(path);
    else modified.push(path);
  }
  modified.sort();
  untracked.sort();

  if (modified.length > 0) {
    const block = [
      "Changes not staged for commit:",
      '  (use "git add <file>..." to update what will be committed)',
    ];
    for (const p of modified) block.push(`\tmodified:   ${p}`);
    blocks.push(block);
  }

  if (untracked.length > 0) {
    const block = [
      "Untracked files:",
      '  (use "git add <file>..." to include in what will be committed)',
    ];
    for (const p of untracked) block.push(`\t${p}`);
    blocks.push(block);
  }

  if (!s.merge && staged.length === 0 && modified.length === 0) {
    blocks.push([
      untracked.length > 0
        ? 'nothing added to commit but untracked files present (use "git add" to track)'
        : "nothing to commit, working tree clean",
    ]);
  }

  return blocks.map((b) => b.join("\n")).join("\n\n");
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

function ok(state: RepoState, output: string, effect: Effect): GitRunResult {
  return { state, output, effect };
}

/** A failure: state unchanged, no effect, the message both printed and flagged. */
function fail(state: RepoState, output: string, message = output): GitRunResult {
  return { state, output, effect: { kind: "none" }, error: message };
}

/** Is this a request for help rather than for work? */
function wantsHelp(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

/**
 * Run one git command line, already split into words.
 *
 * @param argv  the words AFTER `git`, e.g. `["commit", "-m", "add readme"]`.
 *              A leading `git` is tolerated so a raw line works too.
 * @param state the current repository state (never mutated).
 */
export function runGit(argv: string[], state: RepoState): GitRunResult {
  const tokens = argv[0] === "git" ? argv.slice(1) : argv;

  // Bare `git`: show what this git can do, rather than a usage error.
  if (tokens.length === 0) return ok(state, helpList(), { kind: "none" });

  const sub = tokens[0];
  const args = tokens.slice(1);

  // `git help [<sub>]`, `git --help`, `git -h`.
  if (sub === "help" || sub === "--help" || sub === "-h") {
    const wanted = args.find((a) => !a.startsWith("-"));
    if (wanted === undefined) return ok(state, helpList(), { kind: "none" });
    const doc = DOC_BY_NAME.get(wanted);
    return doc ? ok(state, helpFor(doc), { kind: "none" }) : fail(state, unknownText(wanted));
  }

  const doc = DOC_BY_NAME.get(sub);
  if (!doc) return fail(state, unknownText(sub));
  // `git <sub> --help`.
  if (wantsHelp(args)) return ok(state, helpFor(doc), { kind: "none" });

  try {
    switch (sub) {
      case "init": {
        // `git init` never destroys anything. Run it in a folder that is already
        // a repository and real git just says so and leaves your history alone -
        // which matters here, because typing it twice is a normal beginner move.
        if (state.commits.size > 0 || state.refs.size > 0) {
          return ok(state, "Reinitialized existing Git repository", { kind: "none" });
        }
        // Otherwise it starts watching the folder - it does not empty it. The
        // files already sitting there stay, still untracked.
        const fresh = init();
        return ok(
          { ...fresh, index: new Map(state.index), worktree: new Map(state.worktree) },
          "Initialized empty Git repository",
          { kind: "none" },
        );
      }

      case "add": {
        // During a merge, `git add <path>` marks a conflict resolved.
        if (state.merge) {
          const paths = args.includes(".") ? [...state.merge.conflicted] : args;
          if (paths.length === 0) return fail(state, "Nothing specified, nothing added.");
          const r = resolvePaths(state, paths);
          return ok(r.state, "", r.effect);
        }
        // Normal add: `.` expands to every path the worktree is holding.
        if (args.length === 0) return fail(state, "Nothing specified, nothing added.");
        const paths: string[] = [];
        for (const a of args) {
          if (a === ".") paths.push(...state.worktree.keys());
          else paths.push(a);
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
          return fail(state, "Aborting commit due to empty commit message.");
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
          return fail(
            state,
            "fatal: missing branch or commit argument",
            "missing branch or commit argument",
          );
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
          return fail(
            state,
            "fatal: No commit specified and merge.defaultToUpstream not set.",
            "No commit specified",
          );
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
        // `git reset <paths>` (what the status hint tells you to type) is a
        // different command from `git reset <commit>`: it unstages. Real git
        // tells them apart by whether the name is a revision, so do the same.
        const positional = args.filter((a) => !a.startsWith("-"));
        const looksLikeRev = (name: string) => {
          try { revParse(state, name); return true; } catch { return false; }
        };
        if (positional.length > 0 && !positional.some(looksLikeRev)) {
          const r = unstage(state, positional);
          return ok(r.state, "", r.effect);
        }
        const rev = positional[0] ?? "HEAD";
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
          return fail(state, "fatal: rev-parse: no revision given", "no revision given");
        }
        return ok(state, revParse(state, rev), { kind: "none" });
      }

      case "rev-list": {
        const range = args.find((a) => a === "--all" || !a.startsWith("-"));
        if (range === undefined) {
          return fail(state, "fatal: rev-list: no revision given", "no revision given");
        }
        return ok(state, revList(state, range).join("\n"), { kind: "none" });
      }

      default:
        // Unreachable: `doc` above already rejected anything not in the table.
        return fail(state, unknownText(sub));
    }
  } catch (e) {
    if (e instanceof GitError) return fail(state, e.message);
    // Any other unexpected error is still surfaced git-like, never thrown.
    const msg = e instanceof Error ? e.message : String(e);
    return fail(state, `fatal: ${msg}`, msg);
  }
}

/** The names `git help` advertises, in listing order. Exported so a test can
 *  assert that nothing deferred ever creeps into the list. */
export function gitSubcommands(): string[] {
  return SUBCOMMANDS.map((d) => d.name);
}

/** The `git` command, ready to `shell.register(...)`. */
export function createGitCommand(): ShellCommand<RepoState> {
  return {
    name: "git",
    summary: "Run a git command against the lesson's repository.",
    run(argv: string[], state: RepoState): ShellResult<RepoState> {
      const r = runGit(argv, state);
      return {
        state: r.state,
        output: r.output,
        error: r.error === undefined ? undefined : true,
        effect: r.effect,
      };
    },
    help(argv: string[]): string {
      const wanted = argv.find((a) => !a.startsWith("-"));
      if (wanted === undefined) return helpList();
      const doc = DOC_BY_NAME.get(wanted);
      return doc ? helpFor(doc) : unknownText(wanted);
    },
  };
}
