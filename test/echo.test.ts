import { test } from "node:test";
import assert from "node:assert/strict";
import { init, addFiles, stage, commit, headCommit, fileAt } from "../src/core/git-model.ts";
import { run } from "../src/core/git-cli.ts";

/** A repo with one committed file, so there is something to modify. */
function committed(text = "one\ntwo\nthree") {
  let s = addFiles(init(), [{ path: "notes.md", text }]).state;
  return commit(stage(s, ["notes.md"]).state, "add notes").state;
}

test("echo with no redirection just prints, like the real thing", () => {
  const r = run('echo "hello there"', init());
  assert.equal(r.output, "hello there");
  assert.equal(r.state.worktree.size, 0, "nothing was written");
});

test("echo > replaces what the file holds", () => {
  const r = run('echo -e "rewritten" > notes.md', committed());
  assert.equal(r.state.worktree.get("notes.md")!.text, "rewritten");
  assert.equal(r.state.worktree.get("notes.md")!.status, "modified", "git is tracking it, so it is modified");
});

test("echo >> adds a line at the end and keeps what was there", () => {
  const r = run('echo -e "four" >> notes.md', committed());
  assert.equal(r.state.worktree.get("notes.md")!.text, "one\ntwo\nthree\nfour");
});

test("echo >> on a file that does not exist yet creates it, untracked", () => {
  const r = run('echo -e "first line" >> fresh.txt', committed());
  const e = r.state.worktree.get("fresh.txt")!;
  assert.equal(e.text, "first line");
  assert.equal(e.status, "untracked", "git has never seen it");
});

test("a redirection with no filename is an error, not a silent no-op", () => {
  const r = run('echo -e "text" >', committed());
  assert.ok(r.error, "reported as a failure");
  assert.match(r.output, /syntax error/);
});

test("echo does not touch the staged copy", () => {
  let s = committed();
  s = stage(run('echo -e "staged version" > notes.md', s).state, ["notes.md"]).state;
  const after = run('echo -e "newer still" > notes.md', s).state;
  assert.equal(after.index.get("notes.md"), "staged version", "staging keeps what you added");
  assert.equal(after.worktree.get("notes.md")!.text, "newer still");
});

// --- the reason this command exists ---------------------------------------

test("git diff finally has something to show", () => {
  // Measured before `echo` existed: every one of the 20 cards in the git track
  // had zero modified files, so `git diff` printed nothing anywhere in the
  // course. Editing a tracked file is what makes the command teachable.
  const s = run('echo -e "two CHANGED" > notes.md', committed()).state;
  const out = run("git diff", s).output;
  assert.match(out, /diff --git a\/notes\.md b\/notes\.md/);
  assert.match(out, /^\+two CHANGED$/m);
  assert.match(out, /^-one$/m);
});

test("git diff --staged shows the edit once it is staged, and git diff then does not", () => {
  let s = run('echo -e "one\\ntwo\\nCHANGED" > notes.md', committed()).state;
  s = stage(s, ["notes.md"]).state;
  assert.equal(run("git diff", s).output, "", "nothing left unstaged");
  assert.match(run("git diff --staged", s).output, /CHANGED/);
});

test("two branches editing the same line really conflict now", () => {
  // The other thing the hole blocked: a lesson could not build a conflict from
  // two different edits, because nothing could make them different.
  let s = committed("the cat\nsleeps\nin the house");
  s = run("git branch fix", s).state;
  s = stage(run('echo -e "the cat\\nsleeps in the sun\\nin the house" > notes.md', s).state, ["notes.md"]).state;
  s = commit(s, "sun").state;
  s = run("git checkout fix", s).state;
  s = stage(run('echo -e "the cat\\nsleeps on the keyboard\\nin the house" > notes.md', s).state, ["notes.md"]).state;
  s = commit(s, "keyboard").state;
  s = run("git checkout main", s).state;

  const r = run("git merge fix", s);
  assert.match(r.output, /CONFLICT/);
  assert.ok(r.state.merge, "the merge is stopped, waiting for the learner");
  assert.match(r.state.worktree.get("notes.md")!.text, /<<<<<<</);
});

test("two branches editing DIFFERENT lines still merge cleanly", () => {
  let s = committed("line one\nline two\nline three");
  s = run("git branch fix", s).state;
  s = stage(run('echo -e "ONE CHANGED\\nline two\\nline three" > notes.md', s).state, ["notes.md"]).state;
  s = commit(s, "top").state;
  s = run("git checkout fix", s).state;
  s = stage(run('echo -e "line one\\nline two\\nTHREE CHANGED" > notes.md', s).state, ["notes.md"]).state;
  s = commit(s, "bottom").state;
  s = run("git checkout main", s).state;

  const r = run("git merge fix", s);
  assert.doesNotMatch(r.output, /CONFLICT/);
  assert.equal(
    fileAt(r.state, headCommit(r.state), "notes.md"),
    "ONE CHANGED\nline two\nTHREE CHANGED",
    "both edits survive",
  );
});
