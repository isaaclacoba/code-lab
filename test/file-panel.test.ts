import { test } from "node:test";
import assert from "node:assert/strict";
import { init, addFiles, stage, commit, edit } from "../src/core/git-model.ts";
import { resolveFilePanel, panelFiles } from "../src/core/file-panel.ts";

/** A repo whose file differs in all three zones at once. */
function threeWay() {
  let s = addFiles(init(), [{ path: "notes.md", text: "committed" }]).state;
  s = commit(stage(s, ["notes.md"]).state, "base").state;
  s = stage(edit(s, "notes.md", "staged").state, ["notes.md"]).state;
  s = edit(s, "notes.md", "in the folder").state;
  return s;
}

test("an empty repo asks the panel for nothing and gets no file", () => {
  const p = resolveFilePanel(init(), null, null);
  assert.equal(p.path, null);
  assert.deepEqual(p.files, []);
});

test("the panel lists every file in any zone", () => {
  let s = addFiles(init(), [{ path: "b.txt", text: "b" }, { path: "a.txt", text: "a" }]).state;
  s = commit(stage(s, ["a.txt"]).state, "just a").state;
  assert.deepEqual(panelFiles(s), ["a.txt", "b.txt"], "committed and untracked alike, sorted");
});

test("it falls back to a real file when asked for one that is not there", () => {
  const s = addFiles(init(), [{ path: "a.txt", text: "a" }]).state;
  assert.equal(resolveFilePanel(s, "ghost.txt", null).path, "a.txt");
});

// --- the claim the panel exists to prove ----------------------------------

test("a file staged and then edited reads differently in all three zones", () => {
  const p = resolveFilePanel(threeWay(), "notes.md", "tree");
  const byZone = Object.fromEntries(p.zones.map((z) => [z.zone, z]));

  assert.equal(byZone.tree.text, "in the folder");
  assert.equal(byZone.index.text, "staged");
  assert.equal(byZone.repo.text, "committed");
  assert.equal(byZone.tree.differs, true, "the folder moved on from staging");
  assert.equal(byZone.index.differs, true, "staging moved on from the last commit");
});

test("the selected zone is compared with the one behind it, not with the file's future", () => {
  const s = threeWay();
  const tree = resolveFilePanel(s, "notes.md", "tree");
  assert.equal(tree.comparedWith, "index");
  assert.deepEqual(
    tree.diff!.map((l) => l.kind + l.text),
    ["-staged", "+in the folder"],
  );

  const index = resolveFilePanel(s, "notes.md", "index");
  assert.equal(index.comparedWith, "repo");
  assert.deepEqual(
    index.diff!.map((l) => l.kind + l.text),
    ["-committed", "+staged"],
  );
});

test("the oldest copy has nothing behind it, so it shows flat", () => {
  const p = resolveFilePanel(threeWay(), "notes.md", "repo");
  assert.equal(p.comparedWith, null);
  assert.equal(p.diff, null);
  assert.equal(p.zones.find((z) => z.zone === "repo")!.differs, false);
});

test("when the copies agree there is no difference to mark", () => {
  let s = addFiles(init(), [{ path: "a.txt", text: "same" }]).state;
  s = commit(stage(s, ["a.txt"]).state, "base").state;
  const p = resolveFilePanel(s, "a.txt", null);
  assert.equal(p.zones.some((z) => z.differs), false);
  assert.equal(p.diff, null);
});

test("a zone that does not hold the file is not offered as the selection", () => {
  // untracked: it exists in the folder and nowhere else
  const s = addFiles(init(), [{ path: "fresh.txt", text: "new" }]).state;
  const p = resolveFilePanel(s, "fresh.txt", "repo");
  assert.equal(p.selected, "tree", "asked for a zone that has no copy, given the one that does");
  assert.equal(p.zones.find((z) => z.zone === "repo")!.present, false);
});

test("a repo whose files have no content gets no panel at all", () => {
  // Lessons that only care about the DAG declare bare filenames. A row of
  // "(empty file)" boxes would be noise on every one of those boards.
  let s = addFiles(init(), ["a.txt", "b.txt"]).state;
  s = commit(stage(s, ["a.txt"]).state, "no content anywhere").state;
  assert.equal(resolveFilePanel(s, null, null).path, null);
});

test("one file with content is enough to earn the panel", () => {
  let s = addFiles(init(), ["bare.txt", { path: "real.txt", text: "something" }]).state;
  s = commit(stage(s, ["real.txt"]).state, "has content").state;
  assert.notEqual(resolveFilePanel(s, null, null).path, null);
});
