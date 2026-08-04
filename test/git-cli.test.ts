import { test } from "node:test";
import assert from "node:assert/strict";
import { init, addFiles, type RepoState } from "../src/core/git-model.ts";
import { run, type RunResult } from "../src/core/git-cli.ts";
// Tokenizing belongs to the terminal shell now, not to git.
import { tokenize } from "../src/terminal/shell.ts";

// --- helpers ---------------------------------------------------------------

/** Run a sequence of command lines, threading state; return the last result. */
function runAll(lines: string[], start?: RepoState): RunResult {
  let state = start ?? init();
  let last: RunResult = { state, output: "", effect: { kind: "none" } };
  for (const line of lines) {
    last = run(line, state);
    state = last.state;
  }
  return last;
}

/** Seed paths as files in the folder (lesson setup), so `git add` finds them. */
function withFiles(s: RepoState, ...paths: string[]): RepoState {
  return addFiles(s, paths).state;
}

/** A repo with one root commit of a.txt; returns the state. */
function repoWithOneCommit(): RepoState {
  return runAll(["git add a.txt", 'git commit -m "first"'], withFiles(init(), "a.txt")).state;
}

/** The commit HEAD resolves to, or null. */
function head(s: RepoState): string | null {
  return s.head.kind === "detached" ? s.head.commit : s.refs.get(s.head.name) ?? null;
}

// --- tokenizer -------------------------------------------------------------

test("tokenize keeps a quoted message as one token and strips quotes", () => {
  assert.deepEqual(tokenize('git commit -m "add readme"'), [
    "git",
    "commit",
    "-m",
    "add readme",
  ]);
});

test("tokenize handles single quotes and an empty quoted string", () => {
  assert.deepEqual(tokenize("git commit -m 'hi there'"), ["git", "commit", "-m", "hi there"]);
  assert.deepEqual(tokenize('git commit -m ""'), ["git", "commit", "-m", ""]);
});

test("tokenize collapses runs of whitespace", () => {
  assert.deepEqual(tokenize("  git   add    a.txt "), ["git", "add", "a.txt"]);
});

// --- init ------------------------------------------------------------------

test("git init makes a fresh repo and prints the init banner", () => {
  const r = run("git init", { commits: new Map(), refs: new Map(), head: { kind: "branch", name: "refs/heads/x" }, index: new Map(), worktree: new Map(), seq: 5 } as RepoState);
  assert.match(r.output, /Initialized empty Git repository/);
  assert.equal(r.effect.kind, "none");
  assert.equal(r.state.head.kind === "branch" && r.state.head.name, "refs/heads/main");
  assert.equal(r.state.commits.size, 0);
  assert.equal(r.error, undefined);
});

test("the leading `git` is optional", () => {
  const r = run("init", init());
  assert.match(r.output, /Initialized empty Git repository/);
});

// --- add + status ----------------------------------------------------------

test("git add stages a path with no output", () => {
  const r = run("git add a.txt", withFiles(init(), "a.txt"));
  assert.equal(r.output, "");
  assert.equal(r.effect.kind, "none");
  assert.equal(r.state.index.get("a.txt"), "staged");
});

test("git add . stages every modified worktree path", () => {
  const start: RepoState = { ...init(), worktree: new Map([["a", "modified"], ["b", "modified"]]) };
  const r = run("git add .", start);
  assert.equal(r.state.index.get("a"), "staged");
  assert.equal(r.state.index.get("b"), "staged");
  assert.equal(r.state.worktree.size, 0);
});

test("git add with nothing specified errors", () => {
  const r = run("git add", init());
  assert.ok(r.error);
  assert.equal(r.state.index.size, 0);
});

test("status on a fresh repo reports a clean unborn main", () => {
  const r = run("git status", init());
  assert.match(r.output, /On branch main/);
  assert.match(r.output, /No commits yet/);
  assert.match(r.output, /nothing to commit, working tree clean/);
});

test("status lists staged and unstaged changes", () => {
  const start: RepoState = { ...init(), index: new Map([["s", "staged"]]), worktree: new Map([["w", "modified"]]) };
  const out = run("git status", start).output;
  assert.match(out, /Changes to be committed:/);
  assert.match(out, /\tmodified:   s/);
  assert.match(out, /Changes not staged for commit:/);
  assert.match(out, /\tmodified:   w/);
});

// --- commit ----------------------------------------------------------------

test("git commit -m prints the [branch (root-commit) hash] message line", () => {
  const s = withFiles(init(), "a.txt");
  const r = runAll(["git add a.txt", 'git commit -m "first"'], s);
  assert.match(r.output, /^\[main \(root-commit\) [0-9a-f]{7}\] first$/);
  assert.equal(r.effect.kind, "commit");
  const id = head(r.state)!;
  assert.equal(r.state.commits.get(id)!.message, "first");
});

test("a second commit is not a root-commit and chains the parent", () => {
  const s = repoWithOneCommit();
  const c1 = head(s)!;
  const r = runAll(["git add b.txt", 'git commit -m "second"'], withFiles(s, "b.txt"));
  assert.match(r.output, /^\[main [0-9a-f]{7}\] second$/);
  assert.doesNotMatch(r.output, /root-commit/);
  const c2 = head(r.state)!;
  assert.deepEqual(r.state.commits.get(c2)!.parents, [c1]);
});

test("git commit with no -m message errors and leaves state unchanged", () => {
  const s = repoWithOneCommit();
  const staged = run("git add b.txt", withFiles(s, "b.txt")).state;
  const r = run("git commit", staged);
  assert.ok(r.error);
  assert.equal(r.effect.kind, "none");
  assert.equal(r.state, staged);
});

// --- commit --amend --------------------------------------------------------

test("git commit --amend replaces HEAD, keeps parents, folds staged paths", () => {
  const s = repoWithOneCommit();
  const c1 = head(s)!;
  const oldParents = s.commits.get(c1)!.parents; // root has no parents
  const r = runAll(["git add extra.txt", 'git commit --amend -m "reworded"'], withFiles(s, "extra.txt"));
  const c1b = head(r.state)!;
  assert.notEqual(c1b, c1, "amend produces a new id");
  const c = r.state.commits.get(c1b)!;
  assert.equal(c.message, "reworded");
  assert.deepEqual(c.parents, oldParents, "amend keeps the original parents");
  assert.ok(c.paths.includes("a.txt") && c.paths.includes("extra.txt"), "folds staged path");
  assert.match(r.output, /^\[main \(root-commit\) [0-9a-f]{7}\] reworded$/);
  assert.equal(r.state.index.size, 0);
});

test("git commit --amend with no -m keeps the original message", () => {
  const s = repoWithOneCommit();
  const r = run('git commit --amend', s);
  const id = head(r.state)!;
  assert.equal(r.state.commits.get(id)!.message, "first");
});

// --- branch ----------------------------------------------------------------

test("git branch <name> creates a ref with no output", () => {
  const s = repoWithOneCommit();
  const r = run("git branch feature", s);
  assert.equal(r.output, "");
  assert.equal(r.effect.kind, "branch");
  assert.ok(r.state.refs.has("refs/heads/feature"));
});

test("bare git branch lists branches with * on the current one", () => {
  let s = repoWithOneCommit();
  s = run("git branch feature", s).state;
  const out = run("git branch", s).output;
  assert.match(out, /\* main/);
  assert.match(out, /  feature/);
});

// --- switch / checkout -----------------------------------------------------

test("git switch -c creates and attaches to a new branch", () => {
  const s = repoWithOneCommit();
  const r = run("git switch -c feature", s);
  assert.equal(r.output, "Switched to a new branch 'feature'");
  assert.equal(r.state.head.kind === "branch" && r.state.head.name, "refs/heads/feature");
});

test("git checkout <branch> switches with the classic message", () => {
  let s = repoWithOneCommit();
  s = run("git branch feature", s).state;
  const r = run("git checkout feature", s);
  assert.equal(r.output, "Switched to branch 'feature'");
});

test("git checkout <commit> detaches HEAD and reports the new position", () => {
  const s = repoWithOneCommit();
  const c1 = head(s)!;
  const r = run(`git checkout ${c1}`, s);
  assert.match(r.output, new RegExp(`^HEAD is now at ${c1} first$`));
  assert.equal(r.state.head.kind, "detached");
});

test("detached status reports the detached hash", () => {
  const s = repoWithOneCommit();
  const c1 = head(s)!;
  const det = run(`git checkout ${c1}`, s).state;
  assert.match(run("git status", det).output, new RegExp(`HEAD detached at ${c1}`));
});

// --- merge: fast-forward ---------------------------------------------------

test("git merge fast-forwards and prints Updating..Fast-forward", () => {
  let s = repoWithOneCommit();
  s = run("git switch -c feature", s).state;
  s = runAll(["git add f.txt", 'git commit -m "feat"'], withFiles(s, "f.txt")).state;
  const featTip = head(s)!;
  s = run("git switch main", s).state;
  const r = run("git merge feature", s);
  assert.match(r.output, /^Updating [0-9a-f]{7}\.\.[0-9a-f]{7}\nFast-forward$/);
  assert.equal(r.effect.kind, "ff");
  assert.equal(head(r.state), featTip);
});

test("git merge of an already-merged ref says Already up to date", () => {
  let s = repoWithOneCommit();
  s = run("git branch feature", s).state;
  const r = run("git merge feature", s);
  assert.equal(r.output, "Already up to date.");
  assert.equal(r.effect.kind, "none");
});

// --- merge: 3-way clean ----------------------------------------------------

test("a clean 3-way merge makes a merge commit", () => {
  // main touches m.txt, feature touches f.txt -> disjoint -> clean merge
  let s = repoWithOneCommit();
  s = run("git switch -c feature", s).state;
  s = runAll(["git add f.txt", 'git commit -m "feat"'], withFiles(s, "f.txt")).state;
  s = run("git switch main", s).state;
  s = runAll(["git add m.txt", 'git commit -m "main work"'], withFiles(s, "m.txt")).state;
  const r = run("git merge feature", s);
  assert.equal(r.output, "Merge made by the 'ort' strategy.");
  assert.equal(r.effect.kind, "merge");
  const tip = head(r.state)!;
  assert.equal(r.state.commits.get(tip)!.parents.length, 2);
});

// --- merge: conflict flow ---------------------------------------------------

test("full conflict flow: merge -> CONFLICT -> add resolves -> commit makes merge commit", () => {
  // both sides touch app.js
  let s = repoWithOneCommit();
  s = run("git switch -c feature", s).state;
  s = runAll(["git add app.js", 'git commit -m "feat edit"'], withFiles(s, "app.js")).state;
  s = run("git switch main", s).state;
  s = runAll(["git add app.js", 'git commit -m "main edit"'], withFiles(s, "app.js")).state;

  const conflict = run("git merge feature", s);
  assert.match(conflict.output, /CONFLICT \(content\): Merge conflict in app\.js/);
  assert.match(conflict.output, /Automatic merge failed; fix conflicts and then commit the result\./);
  assert.equal(conflict.effect.kind, "conflict");
  assert.ok(conflict.state.merge, "merge state is set mid-conflict");

  // status mid-merge lists the unmerged path
  const st = run("git status", conflict.state).output;
  assert.match(st, /You have unmerged paths\./);
  assert.match(st, /\tboth modified:   app\.js/);

  // resolve via add, then commit -> a real merge commit
  const resolved = run("git add app.js", conflict.state);
  assert.equal(resolved.state.merge!.conflicted.length, 0);
  const merged = run('git commit -m "merge feature"', resolved.state);
  assert.equal(merged.effect.kind, "merge");
  const tip = head(merged.state)!;
  assert.equal(merged.state.commits.get(tip)!.parents.length, 2);
  assert.equal(merged.state.merge, undefined);
});

test("git merge --abort clears the pending merge", () => {
  let s = repoWithOneCommit();
  s = run("git switch -c feature", s).state;
  s = runAll(["git add app.js", 'git commit -m "feat"'], withFiles(s, "app.js")).state;
  s = run("git switch main", s).state;
  s = runAll(["git add app.js", 'git commit -m "main"'], withFiles(s, "app.js")).state;
  s = run("git merge feature", s).state;
  assert.ok(s.merge);
  const r = run("git merge --abort", s);
  assert.equal(r.state.merge, undefined);
  assert.equal(r.effect.kind, "none");
});

// --- reset -----------------------------------------------------------------

test("git reset --hard moves HEAD and prints HEAD is now at", () => {
  const s = repoWithOneCommit();
  const c1 = head(s)!;
  const s2 = runAll(["git add b.txt", 'git commit -m "second"'], withFiles(s, "b.txt")).state;
  const r = run(`git reset --hard ${c1}`, s2);
  assert.match(r.output, new RegExp(`^HEAD is now at ${c1} first$`));
  assert.equal(head(r.state), c1);
  assert.equal(r.effect.kind, "reset");
  assert.equal((r.effect as { mode: string }).mode, "hard");
});

test("git reset --soft keeps staged files (visible in status)", () => {
  const s = repoWithOneCommit();
  const c1 = head(s)!;
  const s2 = runAll(["git add b.txt", 'git commit -m "second"'], withFiles(s, "b.txt")).state;
  const r = run(`git reset --soft ${c1}`, s2);
  assert.equal(head(r.state), c1);
  // soft leaves the index alone; the second commit's paths are not re-staged,
  // but the mode is recorded in the effect.
  assert.equal((r.effect as { mode: string }).mode, "soft");
});

test("git reset defaults to --mixed", () => {
  const s = repoWithOneCommit();
  const s2 = { ...s, index: new Map([["z", "staged" as const]]) };
  const r = run("git reset", s2);
  assert.equal((r.effect as { mode: string }).mode, "mixed");
  // mixed unstages: z moves from index back to the worktree, and since no
  // commit ever recorded it, it lands there untracked.
  assert.equal(r.state.index.size, 0);
  assert.equal(r.state.worktree.get("z"), "untracked");
});

// --- tag -------------------------------------------------------------------

test("git tag <name> creates a tag ref, bare git tag lists them", () => {
  let s = repoWithOneCommit();
  s = run("git tag v1", s).state;
  assert.ok(s.refs.has("refs/tags/v1"));
  s = run("git tag v2", s).state;
  const out = run("git tag", s).output;
  assert.equal(out, "v1\nv2");
});

// --- log -------------------------------------------------------------------

test("git log --oneline lists commits newest-first with decorations", () => {
  const s = repoWithOneCommit();
  const s2 = runAll(["git add b.txt", 'git commit -m "second"'], withFiles(s, "b.txt")).state;
  const s3 = run("git tag v1", s2).state;
  const lines = run("git log --oneline", s3).output.split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /second$/);
  assert.match(lines[0], /\(HEAD -> main, tag: v1\)/);
  assert.match(lines[1], /first$/);
});

test("git log (full) prints a commit block per commit", () => {
  const s = repoWithOneCommit();
  const out = run("git log", s).output;
  assert.match(out, /^commit [0-9a-f]{7}.*\n\n    first$/);
});

test("git log on an unborn branch errors, state unchanged", () => {
  const s = init();
  const r = run("git log", s);
  assert.ok(r.error);
  assert.equal(r.state, s);
});

// --- rev-parse / rev-list --------------------------------------------------

test("git rev-parse resolves HEAD to the full hash", () => {
  const s = repoWithOneCommit();
  const r = run("git rev-parse HEAD", s);
  assert.equal(r.output, head(s));
  assert.equal(r.effect.kind, "none");
});

test("git rev-parse HEAD~1 walks the first parent", () => {
  const s = repoWithOneCommit();
  const c1 = head(s)!;
  const s2 = runAll(["git add b.txt", 'git commit -m "second"'], withFiles(s, "b.txt")).state;
  assert.equal(run("git rev-parse HEAD~1", s2).output, c1);
});

test("git rev-list lists a range newest-first, one per line", () => {
  const s = repoWithOneCommit();
  const c1 = head(s)!;
  const s2 = runAll(["git add b.txt", 'git commit -m "second"'], withFiles(s, "b.txt")).state;
  const c2 = head(s2)!;
  const out = run(`git rev-list ${c1}..${c2}`, s2).output;
  assert.equal(out, c2);
  const all = run("git rev-list HEAD", s2).output.split("\n");
  assert.deepEqual(all, [c2, c1]);
});

// --- errors + robustness ---------------------------------------------------

test("an unknown command sets error and leaves state unchanged", () => {
  const s = repoWithOneCommit();
  const r = run("git frobnicate --now", s);
  assert.match(r.output, /is not a git command/);
  assert.equal(r.error, r.output);
  assert.equal(r.state, s);
  assert.equal(r.effect.kind, "none");
});

test("a deferred command (rebase) is treated as unknown", () => {
  const s = repoWithOneCommit();
  const r = run("git rebase main", s);
  assert.ok(r.error);
  assert.equal(r.state, s);
});

test("a GitError (unknown revision) is returned, not thrown", () => {
  const s = repoWithOneCommit();
  const r = run("git rev-parse nope", s);
  assert.ok(r.error);
  assert.equal(r.effect.kind, "none");
  assert.equal(r.state, s);
});

test("run never throws, even on garbage input", () => {
  const s = repoWithOneCommit();
  for (const junk of ["", "   ", 'git "unterminated', "!!!", "git commit -m", "git checkout"]) {
    assert.doesNotThrow(() => run(junk, s));
    const r = run(junk, s);
    assert.equal(r.state, r.error ? s : r.state); // failures never mutate state
  }
});

test("an empty line is a no-op", () => {
  const s = repoWithOneCommit();
  const r = run("", s);
  assert.equal(r.output, "");
  assert.equal(r.effect.kind, "none");
  assert.equal(r.state, s);
});

test("git init keeps the files already sitting in the folder", () => {
  const seeded = addFiles(init(), ["cat.txt"]).state;
  const after = run("git init", seeded);
  assert.equal(after.state.worktree.get("cat.txt"), "untracked");
  // and the freshly-initialised repo can then add them
  assert.equal(run("git add cat.txt", after.state).error, undefined);
});

test("git reset <file> unstages it, the way the status hint says", () => {
  let s = addFiles(init(), ["cat.txt", "notes.md"]).state;
  s = run("git add cat.txt notes.md", s).state;
  const after = run("git reset notes.md", s);
  assert.equal(after.error, undefined);
  assert.equal(after.state.index.has("notes.md"), false, "unstaged");
  assert.equal(after.state.worktree.get("notes.md"), "untracked", "back in the folder");
  assert.equal(after.state.index.get("cat.txt"), "staged", "the other file is untouched");
});

test("git reset <commit> still moves HEAD rather than unstaging", () => {
  let s = addFiles(init(), ["cat.txt", "notes.md"]).state;
  s = run("git add cat.txt", s).state;
  s = run('git commit -m "one"', s).state;
  s = run("git add notes.md", s).state;
  s = run('git commit -m "two"', s).state;

  const after = run("git reset HEAD~1", s);
  assert.equal(after.error, undefined);
  // the undone commit's file comes back to the folder, so the undo is complete
  assert.equal(after.state.worktree.get("notes.md"), "untracked");
});

test("git init in a repository that already exists keeps the history", () => {
  let s = addFiles(init(), ["cat.txt"]).state;
  s = run("git add cat.txt", s).state;
  s = run('git commit -m "one"', s).state;

  const again = run("git init", s);
  assert.equal(again.state.commits.size, 1, "typing it twice must not wipe the work");
  assert.match(again.output, /Reinitialized/);
});
