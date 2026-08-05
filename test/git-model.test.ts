import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GitError,
  init,
  addFiles,
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
  edit,
  fileAt,
  treeAt,
  type RepoState,
} from "../src/core/git-model.ts";

// --- helpers ---------------------------------------------------------------

/** Seed the paths as files in the folder, stage them, then commit. */
function commitFiles(s: RepoState, message: string, paths: string[]): RepoState {
  return commit(stage(addFiles(s, paths).state, paths).state, message).state;
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
  const staged = stage(addFiles(init(), ["a.txt"]).state, ["a.txt"]);
  assert.equal(staged.state.index.has("a.txt"), true);
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
  s = { ...s, worktree: new Map([["a.txt", { status: "modified", text: "" }]]) } as RepoState;
  const r = stage(s, ["a.txt"]);
  assert.equal(r.state.worktree.has("a.txt"), false);
  assert.equal(r.state.index.has("a.txt"), true);
});

// --- files that exist but git is not tracking yet --------------------------

test("addFiles seeds each path into the working tree as untracked", () => {
  const r = addFiles(init(), ["cat.txt", "dog.txt", "notes.md"]);
  assert.deepEqual(
    [...r.state.worktree.entries()].sort(),
    [
      ["cat.txt", { status: "untracked", text: "" }],
      ["dog.txt", { status: "untracked", text: "" }],
      ["notes.md", { status: "untracked", text: "" }],
    ],
  );
  assert.equal(r.state.index.size, 0, "seeding a file does not stage it");
  assert.equal(r.effect.kind, "none");
});

test("addFiles is idempotent and does not mutate the input", () => {
  const s0 = init();
  const once = addFiles(s0, ["cat.txt"]).state;
  const twice = addFiles(once, ["cat.txt", "cat.txt"]).state;
  assert.equal(twice.worktree.size, 1);
  assert.equal(twice.worktree.get("cat.txt")?.status, "untracked");
  assert.equal(s0.worktree.size, 0, "the input state is untouched");
  assert.notEqual(once.worktree, s0.worktree, "worktree Map is a fresh instance");
});

test("addFiles leaves a staged or a modified path exactly as it is", () => {
  let s = addFiles(init(), ["cat.txt"]).state;
  s = stage(s, ["cat.txt"]).state;
  s = { ...s, worktree: new Map([["dog.txt", { status: "modified", text: "" }]]) } as RepoState;

  const r = addFiles(s, ["cat.txt", "dog.txt"]).state;
  assert.equal(r.index.has("cat.txt"), true, "a staged path stays staged");
  assert.equal(r.worktree.has("cat.txt"), false, "and does not reappear in the tree");
  assert.equal(r.worktree.get("dog.txt")?.status, "modified", "a modified path is not downgraded");
});

test("stage moves an untracked path into the index and out of the working tree", () => {
  const s = addFiles(init(), ["cat.txt", "dog.txt"]).state;
  const r = stage(s, ["cat.txt"]).state;
  assert.equal(r.index.has("cat.txt"), true);
  assert.equal(r.worktree.has("cat.txt"), false);
  assert.equal(r.worktree.get("dog.txt")?.status, "untracked", "the unchosen file stays put");
});

test("stage of a path git has never seen throws the pathspec error", () => {
  const s = addFiles(init(), ["cat.txt"]).state;
  assert.throws(
    () => stage(s, ["nope.txt"]),
    (e: unknown) =>
      e instanceof GitError &&
      e.message === "fatal: pathspec 'nope.txt' did not match any files",
  );
  assert.throws(() => stage(init(), ["cat.txt"]), GitError, "an empty folder has nothing to add");
});

test("staging an already-staged path is fine", () => {
  let s = addFiles(init(), ["cat.txt"]).state;
  s = stage(s, ["cat.txt"]).state;
  const r = stage(s, ["cat.txt"]).state;
  assert.equal(r.index.has("cat.txt"), true);
  assert.equal(r.index.size, 1);
});

test("commit takes exactly the index; untracked files stay in the working tree", () => {
  let s = addFiles(init(), ["cat.txt", "dog.txt", "notes.md"]).state;
  s = stage(s, ["cat.txt"]).state;
  const r = commit(s, "just the cat").state;
  const id = head(r)!;
  assert.deepEqual(r.commits.get(id)!.paths, ["cat.txt"]);
  assert.equal(r.index.size, 0);
  assert.deepEqual(
    [...r.worktree.entries()].sort(),
    [
      ["dog.txt", { status: "untracked", text: "" }],
      ["notes.md", { status: "untracked", text: "" }],
    ],
  );
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
  s = stage(addFiles(s, ["staged.txt"]).state, ["staged.txt"]).state;
  s = { ...s, worktree: new Map([["dirty.txt", { status: "modified", text: "" }]]) } as RepoState;

  const soft = reset(s, "soft", c1);
  assert.equal(soft.effect.kind, "reset");
  assert.equal(soft.effect.kind === "reset" && soft.effect.mode, "soft");
  assert.equal(soft.state.refs.get("refs/heads/main"), c1);
  assert.equal(soft.state.index.has("staged.txt"), true, "soft keeps the index");
  assert.equal(soft.state.worktree.get("dirty.txt")?.status, "modified", "soft keeps the worktree");

  const mixed = reset(s, "mixed", c1);
  assert.equal(mixed.state.index.size, 0, "mixed unstages the index");
  assert.equal(mixed.state.worktree.get("staged.txt")?.status, "untracked", "unstaging a never-committed file leaves it untracked");
  assert.equal(mixed.state.worktree.get("dirty.txt")?.status, "modified", "mixed keeps other worktree edits");

  const hard = reset(s, "hard", c1);
  assert.equal(hard.state.index.size, 0, "hard clears the index");
  assert.equal(hard.state.worktree.get("dirty.txt"), undefined, "hard throws away tracked edits");
  assert.equal(hard.state.worktree.get("staged.txt")?.status, "untracked", "hard does not delete an untracked file");
});

test("neither --mixed nor --hard deletes an untracked file", () => {
  let s = init();
  s = commitFiles(s, "c1", ["a"]);
  const c1 = head(s)!;
  s = commitFiles(s, "c2", ["b"]);
  s = stage(addFiles(s, ["staged.txt"]).state, ["staged.txt"]).state;
  s = addFiles(s, ["notes.md"]).state;

  const mixed = reset(s, "mixed", c1);
  assert.equal(mixed.state.index.size, 0, "mixed still unstages the index");
  assert.equal(mixed.state.worktree.get("staged.txt")?.status, "untracked", "never committed, so it goes back to untracked");
  assert.equal(mixed.state.worktree.get("notes.md")?.status, "untracked", "an untracked file is left alone");

  // Real `git reset --hard` throws away YOUR uncommitted changes to files git
  // tracks. A file git never knew about is not git's to delete - which matters
  // here, because a lesson seeds its folder as untracked files.
  const hard = reset(s, "hard", c1);
  assert.equal(hard.state.index.size, 0, "hard still clears the index");
  assert.equal(hard.state.worktree.get("notes.md")?.status, "untracked", "hard leaves an untracked file alone");
  assert.equal(hard.state.worktree.get("staged.txt")?.status, "untracked", "an unstaged, never-committed file survives too");
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
  const r = commit(stage(addFiles(s1, ["b"]).state, ["b"]).state, "c2");
  // s1 was cloned, not mutated
  assert.equal(s1.commits.size, snapshotCommits);
  assert.deepEqual([...s1.refs.entries()], [...snapshotRefs.entries()]);
  assert.notEqual(r.state.commits, s1.commits, "commits Map is a fresh instance");
  assert.notEqual(r.state.refs, s1.refs, "refs Map is a fresh instance");
});

test("staging does not mutate the source index Map", () => {
  const s = addFiles(init(), ["a"]).state;
  const r = stage(s, ["a"]);
  assert.equal(s.index.size, 0);
  assert.notEqual(r.state.index, s.index);
});

// --- reset as a usable undo ------------------------------------------------
// Moving HEAD back must bring the undone commit's files back with it, or the
// learner who commits the wrong thing has no way out but starting over.
test("reset --soft brings the undone commit's files back to the index", () => {
  let s = addFiles(init(), ["cat.txt", "notes.md"]).state;
  s = stage(s, ["cat.txt"]).state;
  s = commit(s, "keep").state;
  const keep = head(s)!;
  s = stage(s, ["notes.md"]).state;
  s = commit(s, "oops").state;

  const soft = reset(s, "soft", keep).state;
  assert.equal(soft.index.has("notes.md"), true, "the undone file is staged again");
  assert.equal(soft.worktree.has("notes.md"), false, "and it is not also loose in the folder");
});

test("reset --mixed puts the undone commit's files back in the folder", () => {
  let s = addFiles(init(), ["cat.txt", "notes.md"]).state;
  s = stage(s, ["cat.txt"]).state;
  s = commit(s, "keep").state;
  const keep = head(s)!;
  s = stage(s, ["notes.md"]).state;
  s = commit(s, "oops").state;

  const mixed = reset(s, "mixed", keep).state;
  assert.equal(mixed.index.size, 0, "nothing left staged");
  // notes.md is in no remaining commit, so it is back to being untracked -
  // exactly where it started, which is what makes the undo complete.
  assert.equal(mixed.worktree.get("notes.md")?.status, "untracked");
});

test("reset --hard throws the undone commit's files away", () => {
  let s = addFiles(init(), ["cat.txt", "notes.md"]).state;
  s = stage(s, ["cat.txt"]).state;
  s = commit(s, "keep").state;
  const keep = head(s)!;
  s = stage(s, ["notes.md"]).state;
  s = commit(s, "oops").state;

  const hard = reset(s, "hard", keep).state;
  assert.equal(hard.index.size, 0);
  assert.equal(hard.worktree.has("notes.md"), false, "--hard is the destructive one");
});

// --- file text: a commit is a snapshot ------------------------------------

test("a commit records the WHOLE tree, not only the file it touched", () => {
  let s = addFiles(init(), [{ path: "cat.txt", text: "meow" }]).state;
  s = commit(stage(s, ["cat.txt"]).state, "add cat").state;
  s = addFiles(s, [{ path: "dog.txt", text: "woof" }]).state;
  s = commit(stage(s, ["dog.txt"]).state, "add dog").state;

  const second = s.commits.get(head(s)!)!;
  // The second commit touched only dog.txt, but it HOLDS both files. That is
  // the difference between a change and a snapshot, and a lesson asks it.
  assert.deepEqual(second.paths, ["dog.txt"], "touched: only the dog");
  assert.deepEqual(
    [...second.blobs.entries()].sort(),
    [["cat.txt", "meow"], ["dog.txt", "woof"]],
    "held: the whole tree",
  );
});

test("paths stays derivable from blobs - every path it names is in the tree", () => {
  let s = addFiles(init(), [{ path: "a.txt", text: "one" }, { path: "b.txt", text: "two" }]).state;
  s = commit(stage(s, ["a.txt", "b.txt"]).state, "both").state;
  s = edit(s, "a.txt", "one changed").state;
  s = commit(stage(s, ["a.txt"]).state, "edit a").state;

  for (const c of s.commits.values()) {
    for (const p of c.paths) {
      assert.equal(c.blobs.has(p), true, `${c.message} names ${p} but does not hold it`);
    }
  }
});

test("fileAt reads a file as it stood at an older commit", () => {
  let s = addFiles(init(), [{ path: "a.txt", text: "first" }]).state;
  s = commit(stage(s, ["a.txt"]).state, "first").state;
  const older = head(s)!;
  s = edit(s, "a.txt", "second").state;
  s = commit(stage(s, ["a.txt"]).state, "second").state;

  assert.equal(fileAt(s, older, "a.txt"), "first");
  assert.equal(fileAt(s, head(s), "a.txt"), "second");
  assert.equal(fileAt(s, older, "missing.txt"), null);
});

test("editing a file after staging it leaves the staged copy alone", () => {
  let s = addFiles(init(), [{ path: "a.txt", text: "staged version" }]).state;
  s = stage(s, ["a.txt"]).state;
  s = edit(s, "a.txt", "newer version").state;

  assert.equal(s.index.get("a.txt"), "staged version", "the index kept what you added");
  assert.equal(s.worktree.get("a.txt")?.text, "newer version", "the folder moved on");
  const c = commit(s, "commit the staged one").state;
  assert.equal(fileAt(c, head(c), "a.txt"), "staged version");
});

test("reset --soft hands the text back, not just the path", () => {
  let s = addFiles(init(), [{ path: "a.txt", text: "base" }]).state;
  s = commit(stage(s, ["a.txt"]).state, "base").state;
  s = edit(s, "a.txt", "work in progress").state;
  s = commit(stage(s, ["a.txt"]).state, "wip").state;

  const back = reset(s, "soft", "HEAD~1").state;
  assert.equal(back.index.get("a.txt"), "work in progress", "the work is still there to re-commit");
  assert.equal(treeAt(back, head(back)!).get("a.txt"), "base", "and HEAD is back on base");
});

// --- merging looks INSIDE the file ----------------------------------------

/** Commit `text` to `path` on the current branch. */
function put(s: RepoState, path: string, text: string, message: string): RepoState {
  const edited = edit(s, path, text).state;
  return commit(stage(edited, [path]).state, message).state;
}

test("two branches editing different parts of ONE file merge cleanly", () => {
  let s = addFiles(init(), [{ path: "notes.md", text: "one\ntwo\nthree" }]).state;
  s = commit(stage(s, ["notes.md"]).state, "base").state;

  s = branch(s, "feature").state;
  s = put(s, "notes.md", "ONE CHANGED\ntwo\nthree", "edit the top");
  s = checkout(s, "feature").state;
  s = put(s, "notes.md", "one\ntwo\nTHREE CHANGED", "edit the bottom");
  s = checkout(s, "main").state;

  const r = merge(s, "feature");
  assert.notEqual(r.effect.kind, "conflict", "same file, different lines - git merges this");
  assert.equal(r.state.merge, undefined, "no conflict state to resolve");
  assert.equal(
    fileAt(r.state, headOf(r.state), "notes.md"),
    "ONE CHANGED\ntwo\nTHREE CHANGED",
    "both edits survive in the merged file",
  );
});

test("two branches editing the SAME line conflict, and the file gets markers", () => {
  let s = addFiles(init(), [{ path: "notes.md", text: "one\nshared\nthree" }]).state;
  s = commit(stage(s, ["notes.md"]).state, "base").state;

  s = branch(s, "feature").state;
  s = put(s, "notes.md", "one\nmain wins\nthree", "main edits the middle");
  s = checkout(s, "feature").state;
  s = put(s, "notes.md", "one\nfeature wins\nthree", "feature edits the middle");
  s = checkout(s, "main").state;

  const r = merge(s, "feature");
  assert.equal(r.effect.kind, "conflict");
  const inFolder = r.state.worktree.get("notes.md")!.text;
  assert.match(inFolder, /<<<<<<< main/);
  assert.match(inFolder, /\|\|\|\|\|\|\| ancestor/);
  assert.match(inFolder, /shared/, "the ancestor's line is shown - that is diff3");
  assert.match(inFolder, />>>>>>> feature/);
});

/** HEAD's commit, for the merge tests above. */
function headOf(s: RepoState): string {
  return head(s)!;
}

test("a stopped merge leaves the conflicted file in the working tree", () => {
  // Git puts the file you have to settle in front of you. The board draws the
  // three zones, so a conflict the working tree does not show is a conflict the
  // learner cannot see.
  let s = addFiles(init(), [{ path: "a.txt", text: "base" }]).state;
  s = commit(stage(s, ["a.txt"]).state, "base").state;
  s = branch(s, "feature").state;
  s = put(s, "a.txt", "ours", "ours");
  s = checkout(s, "feature").state;
  s = put(s, "a.txt", "theirs", "theirs");
  s = checkout(s, "main").state;

  const r = merge(s, "feature");
  assert.equal(r.effect.kind, "conflict");
  assert.equal(r.state.worktree.has("a.txt"), true, "the file is there to be settled");
  assert.equal(r.state.worktree.get("a.txt")!.status, "modified");
});

test("merge --abort takes the conflicted file back out of the working tree", () => {
  let s = addFiles(init(), [{ path: "a.txt", text: "base" }]).state;
  s = commit(stage(s, ["a.txt"]).state, "base").state;
  s = branch(s, "feature").state;
  s = put(s, "a.txt", "ours", "ours");
  s = checkout(s, "feature").state;
  s = put(s, "a.txt", "theirs", "theirs");
  s = checkout(s, "main").state;

  const stopped = merge(s, "feature").state;
  assert.equal(stopped.worktree.has("a.txt"), true, "the merge put it there");

  const back = mergeAbort(stopped).state;
  assert.equal(back.merge, undefined);
  assert.equal(back.worktree.has("a.txt"), false, "abort is a full undo, not half of one");
});

// --- switching branches moves the FILES, not just the label ---------------

test("switching branches replaces what is in the folder", () => {
  // The question a theory lesson owns: if a branch is only a name, what happens
  // to my work when I switch? The files change to that commit's versions.
  let s = addFiles(init(), [{ path: "a.txt", text: "base" }]).state;
  s = commit(stage(s, ["a.txt"]).state, "base").state;
  s = branch(s, "feature").state;
  s = put(s, "a.txt", "main version", "main edit");

  assert.equal(fileAt(s, head(s), "a.txt"), "main version");
  const onFeature = checkout(s, "feature").state;
  assert.equal(fileAt(onFeature, head(onFeature), "a.txt"), "base", "the folder follows the branch");
  assert.equal(onFeature.worktree.has("a.txt"), false, "and it is clean, not 'modified'");
});

test("switching refuses to throw away an edit you have not committed", () => {
  let s = addFiles(init(), [{ path: "a.txt", text: "base" }]).state;
  s = commit(stage(s, ["a.txt"]).state, "base").state;
  s = branch(s, "feature").state;
  s = put(s, "a.txt", "committed on main", "main edit");
  s = edit(s, "a.txt", "work in progress").state;

  assert.throws(() => checkout(s, "feature"), /would be overwritten/);
});

test("an untracked file is left alone when you switch", () => {
  let s = addFiles(init(), [{ path: "a.txt", text: "base" }]).state;
  s = commit(stage(s, ["a.txt"]).state, "base").state;
  s = branch(s, "feature").state;
  s = addFiles(s, [{ path: "scratch.txt", text: "mine" }]).state;

  const after = checkout(s, "feature").state;
  assert.equal(after.worktree.get("scratch.txt")?.text, "mine", "git does not touch what it is not tracking");
});
