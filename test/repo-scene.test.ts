// test/repo-scene.test.ts - the `repo` scene's resolver.
//
// WHY THIS EXISTS
// A git theory step names commits to highlight by id. An id that is not in the
// step's repository is an authoring slip, and the two ways to handle it are not
// equal: throwing kills the lesson mid-run for a learner who did nothing wrong,
// while dropping the id costs one missing highlight that an author will see.
// resolveRepo is the single place that choice is made, so it is pinned here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRepo } from "../src/core/repo-scene.ts";
import { init, addFiles, stage, commit, headCommit } from "../src/core/git-model.ts";
import type { RepoState } from "../src/core/git-model.ts";

function repoWithOneCommit(): { state: RepoState; id: string } {
  let s = addFiles(init(), ["cat.txt"]).state;
  s = stage(s, ["cat.txt"]).state;
  s = commit(s, "add cat").state;
  return { state: s, id: headCommit(s)! };
}

test("a scene with no state resolves to nothing rather than throwing", () => {
  assert.equal(resolveRepo(undefined), null);
  assert.equal(resolveRepo({} as never), null);
});

test("the repository is passed through untouched", () => {
  const { state } = repoWithOneCommit();
  const out = resolveRepo({ state })!;
  assert.equal(out.state, state, "the view hands this straight to GitGraph");
});

test("highlighted ids the repository actually holds are kept", () => {
  const { state, id } = repoWithOneCommit();
  const out = resolveRepo({ state, ghost: [id], diverged: [id] })!;
  assert.deepEqual(out.ghost, [id]);
  assert.deepEqual(out.diverged, [id]);
});

test("an id no commit matches is dropped, not drawn and not thrown", () => {
  const { state, id } = repoWithOneCommit();
  const out = resolveRepo({ state, ghost: [id, "nosuch"], diverged: ["nosuch"] })!;
  assert.deepEqual(out.ghost, [id], "the real id survives");
  assert.deepEqual(out.diverged, [], "the invented one is gone");
});

test("missing highlight lists resolve to empty arrays, so the view never sees undefined", () => {
  const { state } = repoWithOneCommit();
  const out = resolveRepo({ state })!;
  assert.deepEqual(out.ghost, []);
  assert.deepEqual(out.diverged, []);
});

test("the caption is carried through as authored", () => {
  const { state } = repoWithOneCommit();
  assert.equal(resolveRepo({ state, note: "main has not moved" })!.note, "main has not moved");
  assert.equal(resolveRepo({ state })!.note, undefined);
});
