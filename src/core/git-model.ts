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

/** One commit.
 *
 *  `blobs` is the WHOLE tree at this commit, not just what changed - a commit is
 *  a snapshot, and the model has to say so, because a theory lesson asks exactly
 *  that question. `paths` is the derived answer to "what did this commit touch?":
 *  the entries whose text differs from the first parent's. It stays a stored
 *  field so its three readers (`state-match.js` x2, `git-progress.js`) keep the
 *  shape they already have. */
export interface Commit {
  id: Hash;
  parents: Hash[];
  message: string;
  paths: string[];
  blobs: Map<string, string>;
}

/** A fully-qualified ref name, e.g. "refs/heads/main" or "refs/tags/v1". */
export type RefName = string;

/** Where HEAD points: at a branch ref (attached) or straight at a commit
 *  (detached). */
export type Head =
  | { kind: "branch"; name: RefName }
  | { kind: "detached"; commit: Hash };

/** How a path sits in the working tree. `untracked` is a file that exists on
 *  disk but git has never recorded; `modified` is a tracked file edited since
 *  the last commit. Both genuinely live in the working tree, so they share one
 *  map - there is no fourth zone. */
export type WorktreeStatus = "modified" | "untracked";

/** A file sitting in the working tree: how it stands, plus what is in it. */
export interface WorktreeEntry {
  status: WorktreeStatus;
  text: string;
}

/** The whole repository state. Pure data; ops clone it. */
export interface RepoState {
  /** All commits by id, in creation order (Map preserves insertion order). */
  commits: Map<Hash, Commit>;
  /** Branches and tags -> the commit they point at. */
  refs: Map<RefName, Hash>;
  /** Where HEAD points. */
  head: Head;
  /** The staging area: path -> the text `git add` captured. A staged file is a
   *  snapshot of the content at the moment you added it, which is why editing
   *  after `add` leaves the file in both zones at once. */
  index: Map<string, string>;
  /** The working tree: files that exist but are not staged - either "modified"
   *  (tracked, edited) or "untracked" (git is not watching it yet). */
  worktree: Map<string, WorktreeEntry>;
  /** Set only mid-merge-conflict: the other side plus the paths still in conflict. */
  merge?: { mergeHead: Hash; conflicted: string[] };
  /** Where HEAD has BEEN, oldest first. Git keeps this so that work you can no
   *  longer reach by any branch name is still findable for a while - which is
   *  the difference between "undone" and "gone", and the only honest answer to
   *  "I just reset --hard, is my commit lost?". */
  reflog: ReflogEntry[];
  /** Monotonic commit counter, folded into every hash preimage. */
  seq: number;
}

/** One line of the reflog: where HEAD landed, and what put it there. */
export interface ReflogEntry {
  commit: Hash;
  /** Written the way git writes it: "commit: add cat", "reset: moving to HEAD~1". */
  label: string;
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

import { merge3 } from "./text-merge.js";

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
    worktree: new Map(
      [...s.worktree].map(([p, e]) => [p, { status: e.status, text: e.text }] as const),
    ),
    merge: s.merge
      ? { mergeHead: s.merge.mergeHead, conflicted: [...s.merge.conflicted] }
      : undefined,
    reflog: (s.reflog || []).map((e) => ({ commit: e.commit, label: e.label })),
    seq: s.seq,
  };
}

/** The short name of the branch HEAD is on, for a conflict marker. Null when
 *  HEAD is detached - there is no branch name to write. */
function refLabel(s: RepoState): string | null {
  return s.head.kind === "branch" ? s.head.name.replace(/^refs\/heads\//, "") : null;
}

/** The commit HEAD currently points at, or null if the branch is unborn. */
export function headCommit(s: RepoState): Hash | null {
  if (s.head.kind === "detached") return s.head.commit;
  return s.refs.get(s.head.name) ?? null;
}

/** Advance HEAD's branch (or move detached HEAD) to a commit. Mutates the
 *  ALREADY-CLONED state passed in. */
function moveHead(s: RepoState, to: Hash, why?: string): void {
  if (why) {
    if (!s.reflog) s.reflog = [];
    s.reflog.push({ commit: to, label: why });
  }
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

/** The whole tree a commit recorded - a fresh Map, safe for the caller to edit.
 *  An unborn HEAD has an empty tree. */
export function treeAt(s: RepoState, h: Hash | null): Map<string, string> {
  if (h === null) return new Map();
  const c = s.commits.get(h);
  return c && c.blobs ? new Map(c.blobs) : new Map();
}

/** What one file held at a commit, or null if that commit did not have it. */
export function fileAt(s: RepoState, h: Hash | null, path: string): string | null {
  if (h === null) return null;
  const c = s.commits.get(h);
  // `blobs` can be absent: a commit cloned for the ghost graph carries only its
  // shape. A commit with no contents recorded simply has no text to give.
  if (!c || !c.blobs) return null;
  return c.blobs.has(path) ? c.blobs.get(path)! : null;
}

/** The tree a new commit would record: the parent's snapshot with everything
 *  staged written over it. */
function treeWithIndex(s: RepoState, parent: Hash | null): Map<string, string> {
  const blobs = treeAt(s, parent);
  for (const [p, text] of s.index) blobs.set(p, text);
  return blobs;
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
  // `HEAD@{2}` - two moves ago, counted in the reflog. This is the form a
  // learner will have seen in every answer they read, so it has to work: while
  // it did not parse, `git reset --hard HEAD@{1}` fell through to the pathspec
  // branch, quietly unstaged nothing, and reported success. A wrong answer that
  // looks like a right one is worse than an error.
  const back = /^(?:HEAD|@)@\{(\d+)\}$/.exec(tok);
  if (back) {
    const log = s.reflog || [];
    const i = log.length - 1 - Number(back[1]);
    if (i < 0) throw new GitError(`fatal: log for 'HEAD' only has ${log.length} entries`);
    return log[i].commit;
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
    reflog: [],
    seq: 0,
  };
}

/** Lesson setup, NOT a git command: declare that these files exist in the
 *  folder, each with its text. Each lands in the working tree as "untracked" -
 *  git can see it but is not watching it yet. A bare string means an empty file.
 *  Idempotent, and a path already staged or already modified is left exactly as
 *  it is. */
export function addFiles(
  state: RepoState,
  files: Array<string | { path: string; text?: string }>,
): OpResult {
  const s = cloneState(state);
  for (const f of files) {
    const path = typeof f === "string" ? f : f.path;
    const text = typeof f === "string" ? "" : (f.text ?? "");
    if (s.index.has(path) || s.worktree.has(path)) continue;
    s.worktree.set(path, { status: "untracked", text });
  }
  return { state: s, effect: { kind: "none" } };
}

/** Lesson setup or an editor save: put this text in the file. A tracked file
 *  whose text now differs from HEAD reads as "modified"; a file git has never
 *  seen stays "untracked". Editing a file that is already staged leaves the
 *  staged copy alone - that is the whole point of a staging area. */
export function edit(state: RepoState, path: string, text: string): OpResult {
  const s = cloneState(state);
  const tracked = trackedPaths(s, headCommit(s));
  s.worktree.set(path, {
    status: tracked.has(path) ? "modified" : "untracked",
    text,
  });
  return { state: s, effect: { kind: "none" } };
}

/** git add: mark each path staged and drop it from the working tree. A path git
 *  has never seen - not in the working tree, not already staged - is an error,
 *  exactly as in real git. */
export function stage(state: RepoState, paths: string[]): OpResult {
  const s = cloneState(state);
  for (const p of paths) {
    if (!s.worktree.has(p) && !s.index.has(p)) {
      throw new GitError(`fatal: pathspec '${p}' did not match any files`);
    }
    const entry = s.worktree.get(p);
    if (entry) s.index.set(p, entry.text);
    else if (!s.index.has(p)) s.index.set(p, "");
    s.worktree.delete(p);
  }
  return { state: s, effect: { kind: "none" } };
}

/** git commit --amend: replace the HEAD commit with a new one that keeps the
 *  original parents and folds in whatever is staged, then move the branch. The
 *  old commit is left dangling (unreachable), exactly like real git. */
export function amend(state: RepoState, message?: string): OpResult {
  const s = cloneState(state);
  const h = headCommit(s);
  if (h === null) throw new GitError("You do not have anything to amend.");
  const old = s.commits.get(h)!;
  const parents = old.parents;
  const paths = [...new Set([...old.paths, ...s.index.keys()])];
  const msg = message ?? old.message;
  const id = makeHash(parents, msg, s.seq);
  s.seq += 1;
  const blobs = new Map(old.blobs);
  for (const [p, text] of s.index) blobs.set(p, text);
  s.commits.set(id, { id, parents, message: msg, paths, blobs });
  moveHead(s, id, `commit (amend): ${msg}`);
  s.index.clear();
  return { state: s, effect: { kind: "commit", id } };
}

/** git reset <paths>: the inverse of `git add`. Each path leaves the index and
 *  goes back to the folder - untracked if no reachable commit ever recorded it,
 *  otherwise a modification you have not staged. A path that is not staged is
 *  quietly left alone, exactly as in real git. */
export function unstage(state: RepoState, paths: string[]): OpResult {
  const s = cloneState(state);
  const tracked = trackedPaths(s, headCommit(s));
  for (const p of paths) {
    if (!s.index.has(p)) continue;
    const text = s.index.get(p)!;
    s.index.delete(p);
    s.worktree.set(p, {
      status: tracked.has(p) ? "modified" : "untracked",
      text,
    });
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
    // The merged tree: our side, with the other side's files written over it,
    // then whatever the learner staged while resolving.
    const blobs = treeAt(s, head);
    for (const [p, text] of treeAt(s, other)) if (!blobs.has(p)) blobs.set(p, text);
    for (const [p, text] of s.index) blobs.set(p, text);
    s.commits.set(id, { id, parents, message, paths, blobs });
    moveHead(s, id, `commit (merge): ${message}`);
    s.merge = undefined;
    s.index.clear();
    return { state: s, effect: { kind: "merge", id } };
  }

  if (s.index.size === 0) throw new GitError("nothing to commit");
  const parents = head === null ? [] : [head];
  const paths = [...s.index.keys()];
  const id = makeHash(parents, message, s.seq);
  s.seq += 1;
  const blobs = treeWithIndex(s, head);
  s.commits.set(id, { id, parents, message, paths, blobs });
  moveHead(s, id, `commit: ${message}`);
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
    moveWorktreeTo(s, s.refs.get(bref)!);
    s.head = { kind: "branch", name: bref };
    s.reflog.push({ commit: s.refs.get(bref)!, label: `checkout: moving to ${target}` });
    return { state: s, effect: { kind: "checkout", ref: bref } };
  }
  if (target.startsWith("refs/heads/") && s.refs.has(target)) {
    moveWorktreeTo(s, s.refs.get(target)!);
    s.head = { kind: "branch", name: target };
    return { state: s, effect: { kind: "checkout", ref: target } };
  }
  const commitId = revParse(s, target);
  moveWorktreeTo(s, commitId);
  s.head = { kind: "detached", commit: commitId };
  s.reflog.push({ commit: commitId, label: `checkout: moving to ${target}` });
  return { state: s, effect: { kind: "checkout", commit: commitId } };
}

/** Switching branches REPLACES the files in the folder with that commit's
 *  versions - that is the whole answer to "if a branch is just a name, what
 *  happens to my work when I switch?", and a lesson asks exactly that.
 *
 *  A tracked file the learner has edited would be overwritten, so git refuses
 *  rather than destroying it; so does this. Untracked files are nobody's
 *  business but the learner's and are left alone. */
function moveWorktreeTo(s: RepoState, to: Hash | null): void {
  const from = headCommit(s);
  const target = treeAt(s, to);
  const blocked: string[] = [];
  for (const [path, entry] of s.worktree) {
    if (entry.status === "untracked") continue;
    if (target.get(path) !== entry.text) blocked.push(path);
  }
  if (blocked.length > 0) {
    throw new GitError(
      "error: Your local changes to the following files would be overwritten by checkout:\n" +
        blocked.sort().map((p) => `        ${p}`).join("\n") +
        "\nPlease commit your changes before you switch branches.",
    );
  }
  // Everything tracked now matches the commit again, so nothing is "modified".
  for (const [path, entry] of [...s.worktree]) {
    if (entry.status !== "untracked") s.worktree.delete(path);
  }
  void from;
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
    moveHead(s, o, `merge ${otherRev}: Fast-forward`);
    return { state: s, effect: { kind: "ff", from: h, to: o } };
  }

  const base = mergeBases(s, h, o)[0] ?? null;
  const hPaths = changedPaths(s, h, base);
  const oPaths = changedPaths(s, o, base);
  const both = [...hPaths].filter((p) => oPaths.has(p)).sort();

  // Both sides touching the same file is not yet a conflict - git looks INSIDE.
  // Only an overlap is a conflict; two edits in different parts of one file
  // merge cleanly, and the lesson depends on the learner seeing that.
  const conflicted: string[] = [];
  const resolvedText = new Map<string, string>();
  const markedText = new Map<string, string>();
  for (const p of both) {
    const baseText = fileAt(s, base, p) ?? "";
    const ourText = fileAt(s, h, p) ?? "";
    const theirText = fileAt(s, o, p) ?? "";
    if (baseText === "" && ourText === "" && theirText === "") {
      // No text recorded for this file, so there is nothing to compare. Git
      // cannot merge what it cannot read, so the file stands as a conflict.
      conflicted.push(p);
      continue;
    }
    const r = merge3(baseText, ourText, theirText, {
      ours: refLabel(s) ?? "HEAD",
      base: "ancestor",
      theirs: otherRev,
    });
    if (r.clean) {
      resolvedText.set(p, r.text);
    } else {
      conflicted.push(p);
      markedText.set(p, r.text);
    }
  }

  if (conflicted.length > 0) {
    s.merge = { mergeHead: o, conflicted };
    // A stopped merge leaves the file IN THE WORKING TREE for you to settle -
    // that is where git puts it, and it is what the board has to show. When
    // there is text, it is the marked-up version the learner opens and edits;
    // when a lesson recorded none, the file still has to be there to be settled.
    for (const p of conflicted) {
      const text = markedText.get(p) ?? fileAt(s, h, p) ?? s.worktree.get(p)?.text ?? "";
      s.worktree.set(p, { status: "modified", text });
    }
    return { state: s, effect: { kind: "conflict", paths: conflicted } };
  }

  const message = `Merge ${otherRev}`;
  const parents = [h, o];
  const paths = mergeCommitPaths(s, h, o);
  const id = makeHash(parents, message, s.seq);
  s.seq += 1;
  // A clean merge: our tree, with the files only the other side has written in.
  const blobs = treeAt(s, h);
  for (const [p, text] of treeAt(s, o)) {
    if (!blobs.has(p) || fileAt(s, h, p) === fileAt(s, base, p)) blobs.set(p, text);
  }
  // ...and, for a file both sides edited without overlapping, the merged text.
  for (const [p, text] of resolvedText) blobs.set(p, text);
  s.commits.set(id, { id, parents, message, paths, blobs });
  moveHead(s, id, `merge ${otherRev}: Merge made by the recursive strategy.`);
  return { state: s, effect: { kind: "merge", id } };
}

/** git rebase <upstream>. Take the commits that are on this branch and not on
 *  `upstream`, and make them again on top of it.
 *
 *  "Make them AGAIN" is the part worth being precise about, and the part a
 *  learner has to see: the originals are not moved. Each replayed commit is a
 *  new commit with a new parent, so it gets a new id, and the old ones stay
 *  where they were until nothing points at them any more. That is why rebasing
 *  work someone else has pulled causes trouble, and why the graph afterwards is
 *  a straight line rather than a join.
 *
 *  A replay that would collide is refused rather than guessed at: resolving
 *  mid-rebase is a whole flow this model does not have, and silently keeping one
 *  side would teach the wrong thing about what rebase did to the work. */
export function rebase(state: RepoState, upstreamRev: string): OpResult {
  const s = cloneState(state);
  const h = headCommit(s);
  if (h === null) throw new GitError("cannot rebase: HEAD is unborn");
  const o = revParse(s, upstreamRev);

  const hAnc = ancestors(s, h);
  if (hAnc.has(o)) return { state: s, effect: { kind: "none" } };

  const oAnc = ancestors(s, o);
  if (oAnc.has(h)) {
    moveHead(s, o, `rebase: fast-forward to ${upstreamRev}`);
    return { state: s, effect: { kind: "ff", from: h, to: o } };
  }

  const base = mergeBases(s, h, o)[0] ?? null;
  // Creation order, so a commit is replayed after the one it was built on.
  const replay = [...s.commits.keys()].filter((id) => hAnc.has(id) && !oAnc.has(id));

  let tip = o;
  for (const id of replay) {
    const c = s.commits.get(id)!;
    for (const path of c.paths) {
      const upstreamText = fileAt(s, o, path);
      const baseText = fileAt(s, base, path);
      const mineText = c.blobs.get(path) ?? null;
      const upstreamMoved = upstreamText !== baseText;
      if (upstreamMoved && upstreamText !== mineText) {
        throw new GitError(
          `CONFLICT (content): could not apply ${c.id}... ${c.message}\n` +
            `Both this commit and ${upstreamRev} changed ${path}.\n` +
            "Resolving a rebase by hand is not part of this course yet - use `git merge` instead.",
        );
      }
    }
    const blobs = treeAt(s, tip);
    for (const path of c.paths) {
      const text = c.blobs.get(path);
      if (text === undefined) blobs.delete(path);
      else blobs.set(path, text);
    }
    const newId = makeHash([tip], c.message, s.seq);
    s.seq += 1;
    s.commits.set(newId, {
      id: newId,
      parents: [tip],
      message: c.message,
      paths: c.paths.slice(),
      blobs,
    });
    tip = newId;
  }

  moveHead(s, tip, `rebase: ${upstreamRev}`);
  return { state: s, effect: { kind: "commit", id: tip } };
}

/** git merge --abort. Drop the transient merge state (nothing was committed). */
export function mergeAbort(state: RepoState): OpResult {
  const s = cloneState(state);
  if (!s.merge) throw new GitError("no merge in progress");
  // "Puts everything back to how it was before you started" - which means the
  // marked-up files the merge dropped into the working tree go too. Leaving
  // them behind would make abort a half-undo, and the working tree would never
  // match the state the learner started the merge from.
  const head = headCommit(s);
  for (const p of s.merge.conflicted) {
    if (fileAt(s, head, p) !== null) s.worktree.delete(p);
  }
  s.merge = undefined;
  return { state: s, effect: { kind: "none" } };
}

/** Mark conflicted paths resolved (git add during a merge). */
export function resolvePaths(state: RepoState, paths: string[]): OpResult {
  const s = cloneState(state);
  if (!s.merge) throw new GitError("no merge in progress");
  // `git add` during a merge does BOTH things: it marks the path settled and it
  // stages the text the learner left in the file. Only doing the first threw
  // their resolution away - the merge commit kept HEAD's version, so a lesson
  // could ask someone to edit out the markers and then quietly ignore the edit.
  for (const p of paths) {
    const entry = s.worktree.get(p);
    if (entry) {
      s.index.set(p, entry.text);
      s.worktree.delete(p);
    }
  }
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
  const before = headCommit(s);
  const target = revParse(s, targetRev);
  moveHead(s, target, `reset: moving to ${targetRev}`);
  // A path that no reachable commit has ever recorded is untracked: unstaging it
  // makes it untracked again, not "modified".
  const tracked = trackedPaths(s, target);
  // Moving HEAD back does not evaporate the work those commits held. The files
  // they recorded come BACK to where the mode says: staged for --soft, sitting
  // in the folder for --mixed. That is what makes reset an undo you can act on.
  const undone = before ? changedPaths(s, before, target) : new Set<string>();
  const restingStatus = (p: string): WorktreeStatus => (tracked.has(p) ? "modified" : "untracked");
  // The text an undone file comes back with is what the commit being undone
  // held, not what the target holds - undoing a commit hands the work back.
  const undoneText = (p: string): string =>
    fileAt(s, before, p) ?? s.index.get(p) ?? s.worktree.get(p)?.text ?? "";
  const rest = (p: string, text: string) =>
    s.worktree.set(p, { status: restingStatus(p), text });

  if (mode === "soft") {
    for (const p of undone) s.index.set(p, undoneText(p));
  } else if (mode === "mixed") {
    // staged changes become unstaged; worktree otherwise unchanged
    for (const [p, text] of s.index) rest(p, text);
    s.index.clear();
    for (const p of undone) rest(p, undoneText(p));
  } else if (mode === "hard") {
    // Throw away staged and tracked-but-uncommitted work. What git never had
    // in a commit is not git's to delete - real `git reset --hard` leaves an
    // untracked file sitting on disk, including one you had merely `git add`ed.
    const staged = [...s.index];
    s.index.clear();
    for (const [path, entry] of [...s.worktree]) {
      if (entry.status !== "untracked") s.worktree.delete(path);
    }
    for (const [path, text] of staged) {
      if (!tracked.has(path)) s.worktree.set(path, { status: "untracked", text });
    }
    // --hard is the destructive one: the undone commits' files are simply gone.
    for (const path of undone) if (!tracked.has(path)) s.worktree.delete(path);
  }
  return { state: s, effect: { kind: "reset", mode, to: target } };
}

/** Every path recorded by a commit reachable from `tip` - i.e. everything git
 *  already knows about at that point in history. */
function trackedPaths(s: RepoState, tip: Hash | null): Set<string> {
  return tip ? changedPaths(s, tip, null) : new Set<string>();
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
