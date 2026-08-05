// The `git` command SET: the shell-facing side of the teaching git.
//
// `git-cli.test.ts` covers the subcommands' behaviour (it drives the same code
// through the `run(line, state)` wrapper). These tests cover what is new: the
// ShellCommand wiring, the help surface, and the parts of `status` that report
// files the folder holds.

import { test } from "node:test";
import assert from "node:assert/strict";
import { init, addFiles, stage, commit, edit, type RepoState } from "../src/core/git-model.ts";
import { run } from "../src/core/git-cli.ts";
import { Shell } from "../src/terminal/shell.ts";
import { createGitCommand, gitSubcommands } from "../src/terminal/commands/git.ts";

// --- helpers ---------------------------------------------------------------

function withFiles(s: RepoState, ...paths: string[]): RepoState {
  return addFiles(s, paths).state;
}

/** A shell with only git registered, plus a one-liner to run against a state. */
function gitShell() {
  const shell = new Shell<RepoState>().register(createGitCommand());
  return {
    shell,
    line(text: string, state: RepoState) {
      return shell.run(text, state);
    },
  };
}

/** Every command word this git must never claim to support. */
const DEFERRED = [
  "rebase",
  "cherry-pick",
  "stash",
  "remote",
  "push",
  "pull",
  "fetch",
  "clone",
];

// --- the ShellCommand wiring ----------------------------------------------

test("createGitCommand registers as `git` with a one-line summary", () => {
  const cmd = createGitCommand();
  assert.equal(cmd.name, "git");
  assert.ok(cmd.summary.length > 0);
  assert.equal(cmd.summary.includes("\n"), false);
});

test("the shell dispatches a git line and threads the new state back", () => {
  const g = gitShell();
  const r = g.line("git init", init());
  assert.match(r.output, /Initialized empty Git repository/);
  assert.equal(r.error, undefined);
  assert.equal(r.state.commits.size, 0);
});

test("a git failure comes back as error:true, state untouched", () => {
  const g = gitShell();
  const s = init();
  const r = g.line("git rev-parse nope", s);
  assert.equal(r.error, true);
  assert.equal(r.state, s);
});

test("the git effect reaches the shell result for the animation layer", () => {
  const g = gitShell();
  const s = withFiles(init(), "a.txt");
  const staged = g.line("git add a.txt", s).state;
  const r = g.line('git commit -m "first"', staged);
  assert.equal((r.effect as { kind: string }).kind, "commit");
});

// --- merge --abort ---------------------------------------------------------

test("git merge --abort drops the pending merge and prints nothing", () => {
  const g = gitShell();
  let s = withFiles(init(), "a.txt");
  s = g.line("git add a.txt", s).state;
  s = g.line('git commit -m "first"', s).state;
  s = g.line("git switch -c feature", s).state;
  s = g.line("git add app.js", withFiles(s, "app.js")).state;
  s = g.line('git commit -m "feat"', s).state;
  s = g.line("git switch main", s).state;
  s = g.line("git add app.js", withFiles(s, "app.js")).state;
  s = g.line('git commit -m "main"', s).state;

  const conflict = g.line("git merge feature", s);
  assert.ok(conflict.state.merge, "the merge is pending");

  const aborted = g.line("git merge --abort", conflict.state);
  assert.equal(aborted.state.merge, undefined);
  assert.equal(aborted.output, "");
  assert.equal(aborted.error, undefined);
});

test("git merge --abort with no merge in progress is an error, not a throw", () => {
  const g = gitShell();
  const s = init();
  const r = g.line("git merge --abort", s);
  assert.equal(r.error, true);
  assert.equal(r.state, s);
});

// --- help ------------------------------------------------------------------

test("git help lists every supported subcommand with a summary", () => {
  const out = run("git help", init()).output;
  for (const name of gitSubcommands()) {
    assert.ok(out.includes(name), `git help must list '${name}'`);
  }
  assert.match(out, /usage: git <command>/);
  assert.match(out, /git help <command>/);
  // every listed line carries a summary, not just a bare name
  assert.match(out, /init\s+Start a new, empty repository\./);
});

test("git help is not an error, and leaves the repo alone", () => {
  const s = init();
  const r = run("git help", s);
  assert.equal(r.error, undefined);
  assert.equal(r.state, s);
  assert.equal(r.effect.kind, "none");
});

test("git --help, bare git and help git all print the same list", () => {
  const s = init();
  const list = run("git help", s).output;
  assert.equal(run("git --help", s).output, list);
  assert.equal(run("git", s).output, list);

  const g = gitShell();
  assert.equal(g.line("help git", s).output, list);
  assert.equal(g.line("git --help", s).output, list);
});

test("git help <sub> prints that subcommand's usage", () => {
  const s = init();
  const out = run("git help commit", s).output;
  assert.match(out, /^usage: git commit -m <message>$/m);
  assert.match(out, /^ {3}or: git commit --amend \[-m <message>\]$/m);
  assert.match(out, /Record the staged changes as a new commit\./);
});

test("git <sub> --help and help git <sub> match git help <sub>", () => {
  const s = init();
  const expected = run("git help commit", s).output;
  assert.equal(run("git commit --help", s).output, expected);
  assert.equal(gitShell().line("help git commit", s).output, expected);
});

test("git <sub> --help does not run the subcommand", () => {
  const s = withFiles(init(), "a.txt");
  const r = run("git add --help a.txt", s);
  assert.equal(r.state, s, "help must not stage anything");
  assert.match(r.output, /^usage: git add <path>\.\.\.$/m);
});

test("git help advertises nothing the model defers", () => {
  const listed = gitSubcommands();
  const out = run("git help", init()).output;
  for (const word of DEFERRED) {
    assert.equal(listed.includes(word), false, `'${word}' must not be advertised`);
    assert.equal(out.includes(word), false, `'${word}' must not appear in git help`);
  }
});

test("git help <unknown> is an error that still points at git help", () => {
  const s = init();
  const r = run("git help frobnicate", s);
  assert.ok(r.error);
  assert.match(r.output, /is not a git command\. See 'git help'\./);
  assert.equal(r.state, s);
});

// --- unknown subcommands ---------------------------------------------------

test("an unknown subcommand points at git help, which exists", () => {
  const r = run("git frobnicate --now", init());
  assert.match(r.output, /^git: 'frobnicate' is not a git command\. See 'git help'\.$/m);
  assert.doesNotMatch(r.output, /git --help/);
  assert.equal(r.error, r.output);
});

test("a near miss suggests the closest supported subcommand", () => {
  const r = run("git stauts", init());
  assert.match(r.output, /git: 'stauts' is not a git command\. See 'git help'\./);
  assert.match(r.output, /The most similar command is\n\tstatus/);
});

test("a deferred command is unknown and gets no misleading suggestion", () => {
  const r = run("git rebase main", init());
  assert.ok(r.error);
  assert.match(r.output, /is not a git command/);
  assert.doesNotMatch(r.output, /The most similar command is/);
});

// --- status: files the folder holds ---------------------------------------

test("status lists untracked files under their own heading", () => {
  const s = withFiles(init(), "notes.md", "app.js");
  const out = run("git status", s).output;
  assert.match(out, /Untracked files:/);
  assert.match(out, /\(use "git add <file>\.\.\." to include in what will be committed\)/);
  assert.match(out, /^\tapp\.js$/m);
  assert.match(out, /^\tnotes\.md$/m);
  assert.match(out, /nothing added to commit but untracked files present/);
  assert.doesNotMatch(out, /Changes not staged for commit:/);
});

test("status with no untracked files says the tree is clean", () => {
  const out = run("git status", init()).output;
  assert.doesNotMatch(out, /Untracked files:/);
  assert.match(out, /nothing to commit, working tree clean/);
});

test("status separates untracked files from modified ones", () => {
  const s: RepoState = {
    ...init(),
    worktree: new Map([
      ["edited.txt", { status: "modified", text: "" }],
      ["fresh.txt", { status: "untracked", text: "" }],
    ]),
  };
  const out = run("git status", s).output;
  assert.match(out, /Changes not staged for commit:[\s\S]*\tmodified:   edited\.txt/);
  assert.match(out, /Untracked files:[\s\S]*\tfresh\.txt/);
  assert.doesNotMatch(out, /modified:   fresh\.txt/);
  assert.doesNotMatch(out, /nothing to commit/);
});

test("staging an untracked file clears it from the status listing", () => {
  const s = withFiles(init(), "notes.md");
  const staged = run("git add notes.md", s).state;
  const out = run("git status", staged).output;
  assert.doesNotMatch(out, /Untracked files:/);
  assert.match(out, /Changes to be committed:[\s\S]*\tmodified:   notes\.md/);
});

test("status never sends the learner to a command this git does not have", () => {
  const s: RepoState = {
    ...init(),
    index: new Map([["s.txt", ""]]),
    worktree: new Map([["w.txt", { status: "modified", text: "" }]]),
  };
  const out = run("git status", s).output;
  assert.doesNotMatch(out, /git restore/);
});

// --- git diff --------------------------------------------------------------

test("git diff shows an unstaged edit, line by line", () => {
  let s = addFiles(init(), [{ path: "notes.md", text: "one\ntwo\nthree" }]).state;
  s = commit(stage(s, ["notes.md"]).state, "base").state;
  s = edit(s, "notes.md", "one\nTWO\nthree").state;

  const out = run("git diff", s).output;
  assert.match(out, /diff --git a\/notes\.md b\/notes\.md/);
  assert.match(out, /^-two$/m);
  assert.match(out, /^\+TWO$/m);
  assert.match(out, /^ one$/m, "unchanged lines are shown as context");
});

test("git diff says nothing about a file git is not tracking", () => {
  const s = addFiles(init(), [{ path: "scratch.txt", text: "just sitting here" }]).state;
  assert.equal(run("git diff", s).output, "", "untracked is not 'changed' - git has nothing to compare");
});

test("git diff --staged shows what is staged but not yet committed", () => {
  let s = addFiles(init(), [{ path: "notes.md", text: "one" }]).state;
  s = commit(stage(s, ["notes.md"]).state, "base").state;
  s = stage(edit(s, "notes.md", "one\ntwo").state, ["notes.md"]).state;

  assert.equal(run("git diff", s).output, "", "nothing left unstaged");
  const staged = run("git diff --staged", s).output;
  assert.match(staged, /^\+two$/m);
});

test("git diff is listed in git help", () => {
  assert.match(run("git help", init()).output, /diff\s+Show what changed/);
});

// --- git diff argument handling -------------------------------------------

/** Two committed files, both edited in the folder. */
function edited() {
  let s = addFiles(init(), [{ path: "cat.txt", text: "one\ntwo" }, { path: "dog.txt", text: "woof" }]).state;
  s = commit(stage(s, ["cat.txt", "dog.txt"]).state, "base").state;
  s = edit(s, "cat.txt", "one\ntwo CHANGED").state;
  return edit(s, "dog.txt", "woof CHANGED").state;
}
const headers = (out: string) => out.split("\n").filter((l) => l.startsWith("diff --git"));

test("git diff <path> limits the diff to that file", () => {
  // The most natural thing a learner types. It used to be read as a revision
  // and rejected with "unknown revision: cat.txt".
  const out = run("git diff cat.txt", edited()).output;
  assert.deepEqual(headers(out), ["diff --git a/cat.txt b/cat.txt"]);
});

test("git diff -- <path> works too, and -- ends the guessing", () => {
  const out = run("git diff -- dog.txt", edited()).output;
  assert.deepEqual(headers(out), ["diff --git a/dog.txt b/dog.txt"]);
});

test("git diff with no path still shows every changed file", () => {
  assert.equal(headers(run("git diff", edited()).output).length, 2);
});

test("git diff <rev> <rev> compares the two commits, not the folder", () => {
  // This used to take the first revision and silently ignore the second, so it
  // answered a different question than the one asked and looked like it worked.
  let s = addFiles(init(), [{ path: "a.txt", text: "base" }]).state;
  s = commit(stage(s, ["a.txt"]).state, "base").state;
  s = run("git branch fix", s).state;
  s = commit(stage(edit(s, "a.txt", "main version").state, ["a.txt"]).state, "main edit").state;

  const out = run("git diff fix main", s).output;
  assert.match(out, /^-base$/m);
  assert.match(out, /^\+main version$/m);
});

test("an option this git does not have is refused, not quietly ignored", () => {
  const r = run("git diff --stat", edited());
  assert.ok(r.error, "reported as a failure");
  assert.match(r.output, /unknown option/);
});

test("a word that is neither a revision nor a file is refused clearly", () => {
  const r = run("git diff nonsense", edited());
  assert.ok(r.error);
  assert.match(r.output, /unknown revision or path/);
});

test("git reflog reads the way git prints it, newest first", () => {
  let s = addFiles(init(), [{ path: "a.txt", text: "one" }]).state;
  s = commit(stage(s, ["a.txt"]).state, "add a").state;
  const out = run("git reflog", s).output;
  assert.match(out, /^[0-9a-f]{7} HEAD@\{0\}: commit: add a$/m);
});

test("git reflog is listed in git help", () => {
  assert.match(run("git help", init()).output, /reflog\s+List where HEAD has been/);
});
