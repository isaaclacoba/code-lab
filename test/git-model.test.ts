import { test } from "node:test";
import assert from "node:assert/strict";
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
} from "../src/core/git-model.ts";

// --- helpers ---------------------------------------------------------------

/** Stage the given paths then commit, returning the new state. */
function commitFiles(s: RepoState, message: string, paths: string[]): RepoState {
  return commit(stage(s, paths).state, message).state;
}

/** The commit HEAD resolves to, or null when unborn. */
function head(s: RepoState): string | null {
  if (s.head.kind === "detached") return s.head.commit;
  return s.refs.get(s.head.name) ?? null;
}

// --- init + first commit ---------------------------------------------------

test("init makes an unborn main branch with no refs", () => {
  const s = init();
  assert.equal(s.head.kind, "branch");
  assert.equal(s.head.kind === "branch" && s.head.name, "refs/heads/main");
  assert.equal(s.refs.size, 0);
  assert.equal(s.commits.size, 0);
  assert.equal(head(s), null);
  assert.equal(s.seq, 0);
});

test("the first commit is born with empty parents and clears the index", () => {
  const staged = stage(init(), ["a.txt"]);
  assert.equal(staged.state.index.get("a.txt"), "staged");
  const r = commit(staged.state, "first");
  assert.equal(r.effect.kind, "commit");
  const id = head(r.state)!;
  assert.ok(id, "main now points at a commit");
  const c = r.state.commits.get(id)!;
  assert.deepEqual(c.parents, []);
  assert.deepEqual(c.paths, ["a.txt"]);
  assert.equal(r.state.index.size, 0, "index cleared after commit");
  assert.equal(r.state.refs.get("refs/heads/main"), id);
});

test("commit with nothing staged throws", () => {
  assert.throws(() => commit(init(), "empty"), GitError);
});

test("stage removes a path from the worktree", () => {
  let s = init();
  s = commitFiles(s, "c1", ["a.txt"]);
  // simulate an unstaged edit, then stage it
  s = { ...s, worktree: new Map([["a.txt", "modified"]]) };
  const r = stage(s, ["a.txt"]);
  assert.equal(r.state.worktree.has("a.txt"), false);
  assert.equal(r.state.index.get("a.txt"), "staged");
});

// --- linear history --------------------------------------------------------

test("linear commits advance the current branch and chain parents", () => {
  let s = init();
  s = commitFiles(s, "c1", ["a"]);
  const c1 = head(s)!;
  s = commitFiles(s, "c2", ["b"]);
  const c2 = head(s)!;
  assert.equal(s.commits.get(c2)!.parents[0], c1);
  assert.equal(s.refs.get("refs/heads/main"), c2);
});

// --- branch / checkout -----------------------------------------------------

test("branch creates a ref at HEAD; checkout -b creates and switches", () => {
  let s = init();
  s = commitFiles(s, "c1", ["a"]);
  const c1 = head(s)!;

  const b = branch(s, "feature");
  assert.equal(b.effect.kind, "branch");
  assert.equal(b.state.refs.get("refs/heads/feature"), c1);
  // HEAD is still on main
  assert.equal(b.state.head.kind === "branch" && b.state.head.name, "refs/heads/main");

  const co = checkout(s, "feature2", { create: true });
  assert.equal(co.state.refs.get("refs/heads/feature2"), c1);
  assert.equal(co.state.head.kind === "branch" && co.state.head.name, "refs/heads/feature2");
});

test("branch throws on a duplicate name and on an unborn HEAD", () => {
  let s = init();
  assert.throws(() => branch(s, "x"), GitError); // unborn
  s = commitFiles(s, "c1", ["a"]);
  s = branch(s, "dup").state;
  assert.throws(() => branch(s, "dup"), GitError);
});

test("checkout of a branch attaches; checkout of a commit detaches", () => {
  let s = init();
  s = commitFiles(s, "c1", ["a"]);
  const c1 = head(s)!;
  s = commitFiles(s, "c2", ["b"]);

  const attached = checkout(s, "main");
  assert.equal(attached.state.head.kind, "branch");

  const detached = checkout(s, c1);
  assert.equal(detached.effect.kind, "checkout");
  assert.equal(detached.state.head.kind, "detached");
  assert.equal(head(detached.state), c1);
});

test("a commit on a detached HEAD moves the detached pointer, not a branch", () => {
  let s = init();
  s = commitFiles(s, "c1", ["a"]);
  const c1 = head(s)!;
  s = commitFiles(s, "c2", ["b"]);
  const mainTip = head(s)!;
  s = checkout(s, c1).state;
  s = commitFiles(s, "detached work", ["c"]);
  assert.equal(s.head.kind, "detached");
  assert.notEqual(head(s), c1);
  // main did not move
  assert.equal(s.refs.get("refs/heads/main"), mainTip);
});

// --- tags ------------------------------------------------------------------

test("tag creates a refs/tags entry resolvable by rev-parse", () => {
  let s = init();
  s = commitFiles(s, "c1", ["a"]);
  const c1 = head(s)!;
  const r = tag(s, "v1");
  assert.equal(r.effect.kind, "tag");
  assert.equal(r.state.refs.get("refs/tags/v1"), c1);
  assert.equal(revParse(r.state, "v1"), c1);
});

// --- fast-forward merge ----------------------------------------------------

test("fast-forward merge moves the pointer without a merge commit", () => {
  let s = init();
  s = commitFiles(s, "c1", ["a"]);
  const c1 = head(s)!;
  s = branch(s, "feature").state;
  s = checkout(s, "feature").state;
  s = commitFiles(s, "c2", ["b"]);
  const c2 = head(s)!;

  // back to main and merge feature -> fast-forward
  s = checkout(s, "main").state;
  const before = s.commits.size;
  const r = merge(s, "feature");
  assert.equal(r.effect.kind, "ff");
  assert.equal(r.effect.kind === "ff" && r.effect.from, c1);
  assert.equal(r.effect.kind === "ff" && r.effect.to, c2);
  assert.equal(r.state.refs.get("refs/heads/main"), c2);
  assert.equal(r.state.commits.size, before, "no new commit on a fast-forward");
});

test("merging an already-merged branch is a no-op", () => {
  let s = init();
  s = commitFiles(s, "c1", ["a"]);
  s = branch(s, "old").state; // old points at c1, an ancestor
  s = commitFiles(s, "c2", ["b"]);
  const r = merge(s, "old");
  assert.equal(r.effect.kind, "none");
  assert.equal(r.state.commits.size, s.commits.size);
});

// --- 3-way merge, no conflict ----------------------------------------------

test("3-way merge with disjoint paths makes a merge commit with two parents", () => {
  let s = init();
  s = commitFiles(s, "base", ["shared"]);
  const base = head(s)!;
  s = branch(s, "feature").state;
  s = commitFiles(s, "main work", ["main-only"]);
  const mainTip = head(s)!;
  s = checkout(s, "feature").state;
  s = commitFiles(s, "feature work", ["feature-only"]);
  const featTip = head(s)!;
  s = checkout(s, "main").state;

  const r = merge(s, "feature");
  assert.equal(r.effect.kind, "merge");
  const id = head(r.state)!;
  const mc = r.state.commits.get(id)!;
  assert.deepEqual(mc.parents, [mainTip, featTip]);
  assert.notEqual(base, id);
  // merge commit records the union of both sides' changed paths
  assert.deepEqual([...mc.paths].sort(), ["feature-only", "main-only"]);
});

// --- 3-way merge, conflict -------------------------------------------------

test("3-way merge on a shared path raises a conflict, then resolves + commits", () => {
  let s = init();
  s = commitFiles(s, "base", ["app.js"]);
  s = branch(s, "feature").state;
  s = commitFiles(s, "main edits app.js", ["app.js"]);
  const mainTip = head(s)!;
  s = checkout(s, "feature").state;
  s = commitFiles(s, "feature edits app.js", ["app.js"]);
  const featTip = head(s)!;
  s = checkout(s, "main").state;

  const conflict = merge(s, "feature");
  assert.equal(conflict.effect.kind, "conflict");
  assert.deepEqual(conflict.effect.kind === "conflict" && conflict.effect.paths, ["app.js"]);
  assert.ok(conflict.state.merge, "merge state is set");
  assert.deepEqual(conflict.state.merge!.conflicted, ["app.js"]);
  assert.equal(conflict.state.merge!.mergeHead, featTip);
  // committing while conflicts remain throws
  assert.throws(() => commit(conflict.state, "premature"), GitError);

  const resolved = resolvePaths(conflict.state, ["app.js"]);
  assert.deepEqual(resolved.state.merge!.conflicted, []);

  const merged = commit(resolved.state, "merge feature");
  assert.equal(merged.effect.kind, "merge");
  const id = head(merged.state)!;
  assert.deepEqual(merged.state.commits.get(id)!.parents, [mainTip, featTip]);
  assert.equal(merged.state.merge, undefined, "merge state cleared after commit");
});

test("merge --abort clears the transient conflict state", () => {
  let s = init();
  s = commitFiles(s, "base", ["app.js"]);
  s = branch(s, "feature").state;
  s = commitFiles(s, "main edits", ["app.js"]);
  s = checkout(s, "feature").state;
  s = commitFiles(s, "feature edits", ["app.js"]);
  s = checkout(s, "main").state;

  const conflict = merge(s, "feature");
  assert.ok(conflict.state.merge);
  const aborted = mergeAbort(conflict.state);
  assert.equal(aborted.effect.kind, "none");
  assert.equal(aborted.state.merge, undefined);
  assert.throws(() => mergeAbort(aborted.state), GitError);
});

// --- reset modes -----------------------------------------------------------

test("reset --soft/--mixed/--hard differ in index and worktree", () => {
  let s = init();
  s = commitFiles(s, "c1", ["a"]);
  const c1 = head(s)!;
  s = commitFiles(s, "c2", ["b"]);
  // now stage something and leave an unstaged edit
  s = stage(s, ["staged.txt"]).state;
  s = { ...s, worktree: new Map([["dirty.txt", "modified"]]) };

  const soft = reset(s, "soft", c1);
  assert.equal(soft.effect.kind, "reset");
  assert.equal(soft.effect.kind === "reset" && soft.effect.mode, "soft");
  assert.equal(soft.state.refs.get("refs/heads/main"), c1);
  assert.equal(soft.state.index.get("staged.txt"), "staged", "soft keeps the index");
  assert.equal(soft.state.worktree.get("dirty.txt"), "modified", "soft keeps the worktree");

  const mixed = reset(s, "mixed", c1);
  assert.equal(mixed.state.index.size, 0, "mixed unstages the index");
  assert.equal(mixed.state.worktree.get("staged.txt"), "modified", "mixed moves staged -> worktree");
  assert.equal(mixed.state.worktree.get("dirty.txt"), "modified", "mixed keeps other worktree edits");

  const hard = reset(s, "hard", c1);
  assert.equal(hard.state.index.size, 0, "hard clears the index");
  assert.equal(hard.state.worktree.size, 0, "hard clears the worktree");
});

// --- rev-parse -------------------------------------------------------------

test("rev-parse resolves HEAD, ~n, ^, ^2, tags, and short ids", () => {
  let s = init();
  s = commitFiles(s, "c1", ["a"]);
  const c1 = head(s)!;
  s = commitFiles(s, "c2", ["b"]);
  const c2 = head(s)!;
  s = commitFiles(s, "c3", ["c"]);
  const c3 = head(s)!;

  assert.equal(revParse(s, "HEAD"), c3);
  assert.equal(revParse(s, "@"), c3);
  assert.equal(revParse(s, "HEAD~1"), c2);
  assert.equal(revParse(s, "HEAD~2"), c1);
  assert.equal(revParse(s, "HEAD^"), c2);
  // a tag and a short id both resolve
  s = tag(s, "rel").state;
  assert.equal(revParse(s, "rel"), c3);
  assert.equal(revParse(s, c1.slice(0, 4)), c1);
  assert.throws(() => revParse(s, "nope"), GitError);
});

test("rev-parse ^2 picks the second parent of a merge commit", () => {
  let s = init();
  s = commitFiles(s, "base", ["shared"]);
  s = branch(s, "feature").state;
  s = commitFiles(s, "main", ["m"]);
  const mainTip = head(s)!;
  s = checkout(s, "feature").state;
  s = commitFiles(s, "feature", ["f"]);
  const featTip = head(s)!;
  s = checkout(s, "main").state;
  s = merge(s, "feature").state;

  assert.equal(revParse(s, "HEAD^1"), mainTip);
  assert.equal(revParse(s, "HEAD^2"), featTip);
  assert.throws(() => revParse(s, "HEAD^3"), GitError);
});

// --- rev-list --------------------------------------------------------------

test("rev-list A..B lists commits reachable from B but not A, newest-first", () => {
  let s = init();
  s = commitFiles(s, "c1", ["a"]);
  const c1 = head(s)!;
  s = commitFiles(s, "c2", ["b"]);
  const c2 = head(s)!;
  s = commitFiles(s, "c3", ["c"]);
  const c3 = head(s)!;

  assert.deepEqual(revList(s, `${c1}..${c3}`), [c3, c2]);
  assert.deepEqual(revList(s, "HEAD~2..HEAD"), [c3, c2]);
  // a single rev = all its ancestors
  assert.deepEqual(revList(s, c2), [c2, c1]);
});

test("rev-list A...B is the symmetric difference; --all covers every ref", () => {
  let s = init();
  s = commitFiles(s, "base", ["shared"]);
  const base = head(s)!;
  s = branch(s, "feature").state;
  s = commitFiles(s, "main", ["m"]);
  const mainTip = head(s)!;
  s = checkout(s, "feature").state;
  s = commitFiles(s, "feature", ["f"]);
  const featTip = head(s)!;

  const sym = revList(s, `main...feature`);
  assert.deepEqual([...sym].sort(), [featTip, mainTip].sort());
  assert.equal(sym.includes(base), false, "the shared base is not in the symmetric difference");

  const all = revList(s, "--all");
  assert.deepEqual([...all].sort(), [base, mainTip, featTip].sort());
});

// --- deterministic hashing -------------------------------------------------

test("the same op sequence from a fresh init yields identical hashes", () => {
  const build = () => {
    let s = init();
    s = commitFiles(s, "c1", ["a"]);
    s = commitFiles(s, "c2", ["b"]);
    return [...s.commits.keys()];
  };
  assert.deepEqual(build(), build());
});

test("sibling commits with the same message off the same parent differ via seq", () => {
  let s = commitFiles(init(), "root", ["r"]);
  const root = head(s)!;
  s = branch(s, "a").state;
  s = branch(s, "b").state;

  // commit the identical message + path on each branch off root, threading the
  // state so seq climbs between the two commits
  s = commitFiles(checkout(s, "a").state, "same", ["x"]);
  const aTip = head(s)!;
  s = commitFiles(checkout(s, "b").state, "same", ["x"]);
  const bTip = head(s)!;

  assert.notEqual(aTip, bTip, "same parent + same message must still differ (seq salt)");
  assert.equal(s.commits.get(aTip)!.parents[0], root);
  assert.equal(s.commits.get(bTip)!.parents[0], root);
});

test("a 7-char lowercase hex id is produced", () => {
  const s = commitFiles(init(), "c1", ["a"]);
  const id = head(s)!;
  assert.match(id, /^[0-9a-f]{7}$/);
});

// --- purity ----------------------------------------------------------------

test("ops do not mutate the input state", () => {
  const s0 = init();
  const s1 = commitFiles(s0, "c1", ["a"]);
  // s0 untouched
  assert.equal(s0.commits.size, 0);
  assert.equal(s0.refs.size, 0);
  assert.equal(head(s0), null);

  const snapshotCommits = s1.commits.size;
  const snapshotRefs = new Map(s1.refs);
  const r = commit(stage(s1, ["b"]).state, "c2");
  // s1 was cloned, not mutated
  assert.equal(s1.commits.size, snapshotCommits);
  assert.deepEqual([...s1.refs.entries()], [...snapshotRefs.entries()]);
  assert.notEqual(r.state.commits, s1.commits, "commits Map is a fresh instance");
  assert.notEqual(r.state.refs, s1.refs, "refs Map is a fresh instance");
});

test("staging does not mutate the source index Map", () => {
  const s = init();
  const r = stage(s, ["a"]);
  assert.equal(s.index.size, 0);
  assert.notEqual(r.state.index, s.index);
});
