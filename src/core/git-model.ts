// DOM-free teaching model of git: a commit-DAG plus the working area (index +
// worktree) and pure operations over it. Every op takes a RepoState and returns
// a NEW RepoState (the input is never mutated - the Maps are cloned) alongside
// an Effect the view layer animates. There is no rendering and no file contents
// here; a commit records only which paths it touched, which is exactly enough to
// detect "both sides changed app.js" and raise a merge conflict.
//
// Hashes are deterministic, realistic-looking short hex - DISPLAY-ONLY. They are
// never used for grading or for equivalence beyond object identity. The preimage
// folds in a monotonic `seq` so two sibling commits with the same message off the
// same parent still get different ids.

/** A commit id: 7 lowercase hex chars. Display-only; never graded. */
export type Hash = string;

/** One commit. `paths` are the files this commit touched (no contents). */
export interface Commit {
  id: Hash;
  parents: Hash[];
  message: string;
  paths: string[];
}

/** A fully-qualified ref name, e.g. "refs/heads/main" or "refs/tags/v1". */
export type RefName = string;

/** Where HEAD points: at a branch ref (attached) or straight at a commit
 *  (detached). */
export type Head =
  | { kind: "branch"; name: RefName }
  | { kind: "detached"; commit: Hash };

/** The whole repository state. Pure data; ops clone it. */
export interface RepoState {
  /** All commits by id, in creation order (Map preserves insertion order). */
  commits: Map<Hash, Commit>;
  /** Branches and tags -> the commit they point at. */
  refs: Map<RefName, Hash>;
  /** Where HEAD points. */
  head: Head;
  /** The staging area: paths marked "staged" by `stage` (git add). */
  index: Map<string, "staged">;
  /** Unstaged edits: paths marked "modified". */
  worktree: Map<string, "modified">;
  /** Set only mid-merge-conflict: the other side plus the paths still in conflict. */
  merge?: { mergeHead: Hash; conflicted: string[] };
  /** Monotonic commit counter, folded into every hash preimage. */
  seq: number;
}

/** What an op did, for the animation layer. */
export type Effect =
  | { kind: "none" }
  | { kind: "commit"; id: Hash }
  | { kind: "ff"; from: Hash; to: Hash }
  | { kind: "merge"; id: Hash }
  | { kind: "conflict"; paths: string[] }
  | { kind: "reset"; mode: "soft" | "mixed" | "hard"; to: Hash }
  | { kind: "branch" | "tag" | "checkout"; ref?: string; commit?: Hash };

/** The uniform return of every op: the new state and its effect. */
export interface OpResult {
  state: RepoState;
  effect: Effect;
}

/** Thrown on any invalid operation. The CLI layer catches and formats it. */
export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitError";
  }
}

// --- internals -------------------------------------------------------------

/** FNV-1a 32-bit over a string. Self-contained; no crypto, no timestamp. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic 7-hex commit id. Preimage = parents + message + seq. */
function makeHash(parents: Hash[], message: string, seq: number): Hash {
  const preimage = parents.join(",") + "\n" + message + "\n" + seq;
  return fnv1a(preimage).toString(16).padStart(8, "0").slice(0, 7);
}

/** Deep-enough clone: fresh Maps and head/merge, commit objects reused (they are
 *  immutable once created). */
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

/** The commit HEAD currently points at, or null if the branch is unborn. */
function headCommit(s: RepoState): Hash | null {
  if (s.head.kind === "detached") return s.head.commit;
  return s.refs.get(s.head.name) ?? null;
}

/** Advance HEAD's branch (or move detached HEAD) to a commit. Mutates the
 *  ALREADY-CLONED state passed in. */
function moveHead(s: RepoState, to: Hash): void {
  if (s.head.kind === "branch") {
    s.refs.set(s.head.name, to);
  } else {
    s.head = { kind: "detached", commit: to };
  }
}

/** The inclusive set of a commit and all its ancestors. */
function ancestors(s: RepoState, start: Hash): Set<Hash> {
  const seen = new Set<Hash>();
  const stack = [start];
  while (stack.length) {
    const h = stack.pop()!;
    if (seen.has(h)) continue;
    seen.add(h);
    const c = s.commits.get(h);
    if (c) for (const p of c.parents) stack.push(p);
  }
  return seen;
}

/** Best common ancestors (merge bases) of a and b. Usually one; a criss-cross
 *  history can yield several. */
function mergeBases(s: RepoState, a: Hash, b: Hash): Hash[] {
  const aAnc = ancestors(s, a);
  const common = [...ancestors(s, b)].filter((h) => aAnc.has(h));
  const bases: Hash[] = [];
  for (const c of common) {
    let isBase = true;
    for (const d of common) {
      if (d === c) continue;
      const dAnc = ancestors(s, d);
      dAnc.delete(d);
      if (dAnc.has(c)) {
        // c is a proper ancestor of another common ancestor -> not a best base
        isBase = false;
        break;
      }
    }
    if (isBase) bases.push(c);
  }
  return bases;
}

/** Union of the paths touched by commits reachable from `tip` but not from
 *  `base` (base=null means "no base": everything reachable from tip). */
function changedPaths(s: RepoState, tip: Hash, base: Hash | null): Set<string> {
  const baseAnc = base ? ancestors(s, base) : new Set<Hash>();
  const paths = new Set<string>();
  for (const h of ancestors(s, tip)) {
    if (baseAnc.has(h)) continue;
    const c = s.commits.get(h);
    if (c) for (const p of c.paths) paths.add(p);
  }
  return paths;
}

/** The union of both sides' changed paths since their merge base - the `paths`
 *  a merge commit records. */
function mergeCommitPaths(s: RepoState, h: Hash, o: Hash): string[] {
  const base = mergeBases(s, h, o)[0] ?? null;
  const hp = changedPaths(s, h, base);
  const op = changedPaths(s, o, base);
  return [...new Set([...hp, ...op])];
}

/** First parent of a commit (throws if none). */
function firstParent(s: RepoState, h: Hash): Hash {
  const c = s.commits.get(h);
  if (!c || c.parents.length === 0) {
    throw new GitError(`revision ${h} has no parent`);
  }
  return c.parents[0];
}

/** Nth parent (1-based) of a commit (throws if it does not exist). */
function nthParent(s: RepoState, h: Hash, n: number): Hash {
  const c = s.commits.get(h);
  if (!c || c.parents.length < n) {
    throw new GitError(`revision ${h} has no parent ${n}`);
  }
  return c.parents[n - 1];
}

/** Resolve a bare rev token (no ~/^ suffix) to a commit. */
function resolveBase(s: RepoState, tok: string): Hash {
  if (tok === "HEAD" || tok === "@") {
    const h = headCommit(s);
    if (h === null) throw new GitError("HEAD is unborn");
    return h;
  }
  if (s.refs.has(tok)) return s.refs.get(tok)!;
  const bref = `refs/heads/${tok}`;
  if (s.refs.has(bref)) return s.refs.get(bref)!;
  const tref = `refs/tags/${tok}`;
  if (s.refs.has(tref)) return s.refs.get(tref)!;
  if (s.commits.has(tok)) return tok;
  if (/^[0-9a-f]{4,40}$/.test(tok)) {
    const matches = [...s.commits.keys()].filter((h) => h.startsWith(tok));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new GitError(`ambiguous short id: ${tok}`);
  }
  throw new GitError(`unknown revision: ${tok}`);
}

// --- ops -------------------------------------------------------------------

/** A fresh, empty repo. HEAD is an unborn branch on refs/heads/main (no ref
 *  entry exists until the first commit). */
export function init(): RepoState {
  return {
    commits: new Map(),
    refs: new Map(),
    head: { kind: "branch", name: "refs/heads/main" },
    index: new Map(),
    worktree: new Map(),
    seq: 0,
  };
}

/** git add: mark each path staged and drop it from the worktree. */
export function stage(state: RepoState, paths: string[]): OpResult {
  const s = cloneState(state);
  for (const p of paths) {
    s.index.set(p, "staged");
    s.worktree.delete(p);
  }
  return { state: s, effect: { kind: "none" } };
}

/** git commit -m. Creates a merge commit if a resolved merge is pending,
 *  otherwise a normal commit from the staged index. Advances the current branch
 *  (or detached HEAD). */
export function commit(state: RepoState, message: string): OpResult {
  const s = cloneState(state);
  const head = headCommit(s);

  if (s.merge) {
    if (s.merge.conflicted.length > 0) {
      throw new GitError("cannot commit: unresolved conflicts remain");
    }
    if (head === null) throw new GitError("cannot merge into an unborn branch");
    const other = s.merge.mergeHead;
    const parents = [head, other];
    const paths = mergeCommitPaths(s, head, other);
    const id = makeHash(parents, message, s.seq);
    s.seq += 1;
    s.commits.set(id, { id, parents, message, paths });
    moveHead(s, id);
    s.merge = undefined;
    s.index.clear();
    return { state: s, effect: { kind: "merge", id } };
  }

  if (s.index.size === 0) throw new GitError("nothing to commit");
  const parents = head === null ? [] : [head];
  const paths = [...s.index.keys()];
  const id = makeHash(parents, message, s.seq);
  s.seq += 1;
  s.commits.set(id, { id, parents, message, paths });
  moveHead(s, id);
  s.index.clear();
  return { state: s, effect: { kind: "commit", id } };
}

/** git branch <name> [at]. Creates refs/heads/<name> at HEAD (or the resolved
 *  `at`). Throws if it exists or HEAD is unborn. */
export function branch(state: RepoState, name: string, at?: string): OpResult {
  const s = cloneState(state);
  const ref = `refs/heads/${name}`;
  if (s.refs.has(ref)) throw new GitError(`branch '${name}' already exists`);
  const target = at !== undefined ? revParse(s, at) : headCommit(s);
  if (target === null) throw new GitError("cannot create a branch: HEAD is unborn");
  s.refs.set(ref, target);
  return { state: s, effect: { kind: "branch", ref, commit: target } };
}

/** git tag <name> [at]. Creates refs/tags/<name>. */
export function tag(state: RepoState, name: string, at?: string): OpResult {
  const s = cloneState(state);
  const ref = `refs/tags/${name}`;
  if (s.refs.has(ref)) throw new GitError(`tag '${name}' already exists`);
  const target = at !== undefined ? revParse(s, at) : headCommit(s);
  if (target === null) throw new GitError("cannot create a tag: HEAD is unborn");
  s.refs.set(ref, target);
  return { state: s, effect: { kind: "tag", ref, commit: target } };
}

/** git switch / checkout [-b]. With create: make a branch at HEAD and attach to
 *  it. Otherwise attach to a branch by name, or detach onto any other rev (tag,
 *  commit, short id). Does not touch index/worktree (clean-tree model). */
export function checkout(
  state: RepoState,
  target: string,
  opts?: { create?: boolean },
): OpResult {
  const s = cloneState(state);
  if (opts?.create) {
    const ref = `refs/heads/${target}`;
    if (s.refs.has(ref)) throw new GitError(`branch '${target}' already exists`);
    const at = headCommit(s);
    if (at === null) throw new GitError("cannot create a branch: HEAD is unborn");
    s.refs.set(ref, at);
    s.head = { kind: "branch", name: ref };
    return { state: s, effect: { kind: "checkout", ref } };
  }
  const bref = `refs/heads/${target}`;
  if (s.refs.has(bref)) {
    s.head = { kind: "branch", name: bref };
    return { state: s, effect: { kind: "checkout", ref: bref } };
  }
  if (target.startsWith("refs/heads/") && s.refs.has(target)) {
    s.head = { kind: "branch", name: target };
    return { state: s, effect: { kind: "checkout", ref: target } };
  }
  const commitId = revParse(s, target);
  s.head = { kind: "detached", commit: commitId };
  return { state: s, effect: { kind: "checkout", commit: commitId } };
}

/** git merge <rev>. Up-to-date -> none; fast-forward -> move the pointer;
 *  else 3-way: a clean merge commits immediately, a conflicting one sets the
 *  transient merge state instead. */
export function merge(state: RepoState, otherRev: string): OpResult {
  const s = cloneState(state);
  const h = headCommit(s);
  if (h === null) throw new GitError("cannot merge into an unborn branch");
  const o = revParse(s, otherRev);

  const hAnc = ancestors(s, h);
  if (hAnc.has(o)) {
    // other is already reachable from HEAD - nothing to do
    return { state: s, effect: { kind: "none" } };
  }
  const oAnc = ancestors(s, o);
  if (oAnc.has(h)) {
    // HEAD is an ancestor of other - fast-forward
    moveHead(s, o);
    return { state: s, effect: { kind: "ff", from: h, to: o } };
  }

  const base = mergeBases(s, h, o)[0] ?? null;
  const hPaths = changedPaths(s, h, base);
  const oPaths = changedPaths(s, o, base);
  const conflicted = [...hPaths].filter((p) => oPaths.has(p)).sort();
  if (conflicted.length > 0) {
    s.merge = { mergeHead: o, conflicted };
    return { state: s, effect: { kind: "conflict", paths: conflicted } };
  }

  const message = `Merge ${otherRev}`;
  const parents = [h, o];
  const paths = mergeCommitPaths(s, h, o);
  const id = makeHash(parents, message, s.seq);
  s.seq += 1;
  s.commits.set(id, { id, parents, message, paths });
  moveHead(s, id);
  return { state: s, effect: { kind: "merge", id } };
}

/** git merge --abort. Drop the transient merge state (nothing was committed). */
export function mergeAbort(state: RepoState): OpResult {
  const s = cloneState(state);
  if (!s.merge) throw new GitError("no merge in progress");
  s.merge = undefined;
  return { state: s, effect: { kind: "none" } };
}

/** Mark conflicted paths resolved (git add during a merge). */
export function resolvePaths(state: RepoState, paths: string[]): OpResult {
  const s = cloneState(state);
  if (!s.merge) throw new GitError("no merge in progress");
  const remaining = s.merge.conflicted.filter((p) => !paths.includes(p));
  s.merge = { mergeHead: s.merge.mergeHead, conflicted: remaining };
  return { state: s, effect: { kind: "none" } };
}

/** git reset --soft/--mixed/--hard <rev>. Moves the branch; the three modes
 *  differ only in what they do to the index/worktree tags. */
export function reset(
  state: RepoState,
  mode: "soft" | "mixed" | "hard",
  targetRev: string,
): OpResult {
  const s = cloneState(state);
  const target = revParse(s, targetRev);
  moveHead(s, target);
  if (mode === "mixed") {
    // staged changes become unstaged; worktree otherwise unchanged
    for (const p of s.index.keys()) s.worktree.set(p, "modified");
    s.index.clear();
  } else if (mode === "hard") {
    // discard everything not committed
    s.index.clear();
    s.worktree.clear();
  }
  // soft: index + worktree untouched
  return { state: s, effect: { kind: "reset", mode, to: target } };
}

/** git rev-parse. Resolves HEAD/@, a branch, a tag, a (short) hash, and the
 *  suffixes ~n (first-parent n times), ^ (=^1), and ^n (nth parent). */
export function revParse(state: RepoState, rev: string): Hash {
  const m = rev.match(/^([^~^]+)(.*)$/);
  if (!m) throw new GitError(`unknown revision: ${rev}`);
  let commitId = resolveBase(state, m[1]);
  const ops = m[2];
  let i = 0;
  while (i < ops.length) {
    const ch = ops[i];
    i++;
    let num = "";
    while (i < ops.length && ops[i] >= "0" && ops[i] <= "9") {
      num += ops[i];
      i++;
    }
    if (ch === "~") {
      const n = num === "" ? 1 : parseInt(num, 10);
      for (let k = 0; k < n; k++) commitId = firstParent(state, commitId);
    } else if (ch === "^") {
      const n = num === "" ? 1 : parseInt(num, 10);
      commitId = nthParent(state, commitId, n);
    } else {
      throw new GitError(`unknown revision: ${rev}`);
    }
  }
  return commitId;
}

/** git rev-list. Supports `A..B` (reachable from B not A), `A...B` (symmetric
 *  difference), `--all`, and a single rev (its ancestors). Newest-first. */
export function revList(state: RepoState, range: string): Hash[] {
  let set: Set<Hash>;
  if (range.trim() === "--all") {
    set = new Set();
    for (const ref of state.refs.values()) {
      for (const h of ancestors(state, ref)) set.add(h);
    }
    if (state.head.kind === "detached") {
      for (const h of ancestors(state, state.head.commit)) set.add(h);
    }
  } else if (range.includes("...")) {
    const [a, b] = range.split("...");
    const aAnc = ancestors(state, revParse(state, a.trim()));
    const bAnc = ancestors(state, revParse(state, b.trim()));
    set = new Set();
    for (const h of aAnc) if (!bAnc.has(h)) set.add(h);
    for (const h of bAnc) if (!aAnc.has(h)) set.add(h);
  } else if (range.includes("..")) {
    const [a, b] = range.split("..");
    const aAnc = ancestors(state, revParse(state, a.trim()));
    set = new Set();
    for (const h of ancestors(state, revParse(state, b.trim()))) {
      if (!aAnc.has(h)) set.add(h);
    }
  } else {
    set = ancestors(state, revParse(state, range.trim()));
  }
  // newest-first: reverse of creation (Map insertion) order
  return [...state.commits.keys()].filter((h) => set.has(h)).reverse();
}
