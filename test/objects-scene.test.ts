// test/objects-scene.test.ts - the `objects` scene: acts in, a store out.
//
// WHY THIS EXISTS
// A lesson step describes ACTS in plain words and never a git command, so this
// vocabulary is what every Inside-git lesson is written in. Two things have to
// hold: the ids the replay produces are still real git's, and an authoring slip
// degrades to a visible blank rather than taking the lesson down.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_AUTHOR,
  chainRows,
  openObject,
  replayObjects,
  resolveObjects,
  short,
  type ObjectAct,
} from "../src/core/objects-scene.js";

const run = (acts: ObjectAct[], extra: Record<string, unknown> = {}) => {
  const scene = resolveObjects({ acts, ...extra });
  assert.ok(scene);
  return { scene, replay: replayObjects(scene) };
};

test("a scene with no acts resolves to null instead of throwing", () => {
  assert.equal(resolveObjects(undefined), null);
  assert.equal(resolveObjects({} as never), null);
});

test("lens defaults to folder and only accepts the three it knows", () => {
  assert.equal(resolveObjects({ acts: [] })!.lens, "folder");
  assert.equal(resolveObjects({ acts: [], lens: "chain" })!.lens, "chain");
  assert.equal(resolveObjects({ acts: [], lens: "both" })!.lens, "both");
  assert.equal(resolveObjects({ acts: [], lens: "sideways" as never })!.lens, "folder");
});

test("fresh defaults to the last act and is clamped to what exists", () => {
  const acts: ObjectAct[] = [
    { act: "write", path: "a.txt", text: "a\n" },
    { act: "store", path: "a.txt" },
  ];
  assert.equal(resolveObjects({ acts })!.fresh.length, 1);
  assert.equal(resolveObjects({ acts, fresh: 0 })!.fresh.length, 0);
  assert.equal(resolveObjects({ acts, fresh: 9 })!.fresh.length, 2);
});

test("writing a file changes the folder and stores nothing", () => {
  const { replay } = run([{ act: "write", path: "hello.txt", text: "hello world\n" }]);
  assert.equal(replay.store.worktree.get("hello.txt"), "hello world\n");
  assert.equal(replay.store.objects.size, 0, "a file in the folder is not yet an object");
});

test("storing a file produces the id real git produces", () => {
  const { replay } = run([
    { act: "write", path: "hello.txt", text: "hello world\n" },
    { act: "store", path: "hello.txt" },
  ]);
  assert.ok(replay.store.objects.has("3b18e512dba79e4c8300dd08aeb37f8e728b8dad"));
});

test("a full save builds blob, tree and commit, and the name points at the commit", () => {
  const { replay } = run([
    { act: "write", path: "hello.txt", text: "hello world\n" },
    { act: "store", path: "hello.txt" },
    { act: "list" },
    { act: "save", message: "save the greeting" },
    { act: "name", ref: "refs/heads/main" },
  ]);
  const types = [...replay.store.objects.values()].map((o) => o.type);
  assert.deepEqual(types.sort(), ["blob", "commit", "tree"]);
  assert.equal(replay.store.refs.get("refs/heads/main"), replay.store.headId());
  assert.equal(replay.store.reachable().size, 3, "every object is reachable from the one name");
});

test("ids are deterministic, so a lesson can quote one in its prose", () => {
  const acts: ObjectAct[] = [
    { act: "write", path: "hello.txt", text: "hello world\n" },
    { act: "store", path: "hello.txt" },
    { act: "list" },
    { act: "save", message: "save the greeting" },
  ];
  assert.equal(run(acts).replay.store.headId(), run(acts).replay.store.headId());
  assert.notEqual(
    run(acts).replay.store.objects.size,
    run([...acts, { act: "save", message: "again" }]).replay.store.objects.size,
  );
});

test("editing a file adds a second blob and leaves the first alone", () => {
  const { replay } = run([
    { act: "write", path: "hello.txt", text: "hello world\n" },
    { act: "store", path: "hello.txt" },
    { act: "write", path: "hello.txt", text: "hello world\ngoodbye\n" },
    { act: "store", path: "hello.txt" },
  ]);
  assert.equal(replay.store.objects.size, 2);
  assert.ok(replay.store.objects.has("3b18e512dba79e4c8300dd08aeb37f8e728b8dad"));
});

test("naming an earlier save leaves the later ones unreachable but stored", () => {
  const { replay } = run([
    { act: "write", path: "a.txt", text: "one\n" },
    { act: "store", path: "a.txt" }, { act: "list" }, { act: "save", message: "one" },
    { act: "write", path: "a.txt", text: "two\n" },
    { act: "store", path: "a.txt" }, { act: "list" }, { act: "save", message: "two" },
    { act: "name", ref: "refs/heads/main", at: "one" },
  ]);
  const live = replay.store.reachable();
  const unreachable = [...replay.store.objects.keys()].filter((id) => !live.has(id));
  assert.equal(unreachable.length, 3, "the second save's commit, tree and blob");
  for (const id of unreachable) assert.ok(replay.store.objects.has(id));
});

test("switch repoints HEAD at a different ref - the symbolic form", () => {
  const { replay } = run([
    { act: "write", path: "a.txt", text: "one\n" },
    { act: "store", path: "a.txt" }, { act: "list" }, { act: "save", message: "one" },
    { act: "name", ref: "refs/heads/main" },
    { act: "switch", ref: "refs/heads/feature" },
  ]);
  assert.deepEqual(replay.store.head, { kind: "ref", ref: "refs/heads/feature" });
});

test("detach puts a raw commit id into HEAD - the detached state", () => {
  const { replay } = run([
    { act: "write", path: "a.txt", text: "one\n" },
    { act: "store", path: "a.txt" }, { act: "list" }, { act: "save", message: "one" },
    { act: "write", path: "b.txt", text: "two\n" },
    { act: "store", path: "b.txt" }, { act: "list" }, { act: "save", message: "two" },
    { act: "name", ref: "refs/heads/main" },
    { act: "detach", at: "one" },
  ]);
  const firstCommit = [...replay.store.objects.values()].find(
    (o) => o.commit?.message === "one"
  );
  assert.ok(firstCommit, "the first commit exists");
  assert.deepEqual(replay.store.head, { kind: "detached", id: firstCommit.id });
  assert.equal(replay.store.reachable().size, 6, "both commits are still reachable");
});

test("detach defaults to the latest commit when no target is given", () => {
  const { replay } = run([
    { act: "write", path: "a.txt", text: "one\n" },
    { act: "store", path: "a.txt" }, { act: "list" }, { act: "save", message: "one" },
    { act: "detach" },
  ]);
  const commit = [...replay.store.objects.values()].find((o) => o.type === "commit");
  assert.ok(commit);
  assert.deepEqual(replay.store.head, { kind: "detached", id: commit.id });
});

test("amend writes a replacement commit and orphans the original", () => {
  const { replay } = run([
    { act: "write", path: "a.txt", text: "one\n" },
    { act: "store", path: "a.txt" }, { act: "list" }, { act: "save", message: "first draft" },
    { act: "name", ref: "refs/heads/main" },
    { act: "amend", message: "better message" },
  ]);
  const commits = [...replay.store.objects.values()].filter((o) => o.type === "commit");
  assert.equal(commits.length, 2, "both commits exist in the store");
  const original = commits.find((c) => c.commit?.message === "first draft");
  const amended = commits.find((c) => c.commit?.message === "better message");
  assert.ok(original && amended, "both commits are present");
  // The ref moved to the replacement.
  assert.equal(replay.store.refs.get("refs/heads/main"), amended.id);
  // The replacement and the original share the same tree and parents.
  assert.equal(amended.commit!.tree, original.commit!.tree);
  assert.deepEqual(amended.commit!.parents, original.commit!.parents);
  // The original is no longer reachable.
  const live = replay.store.reachable();
  assert.ok(live.has(amended.id), "the amended commit is reachable");
  assert.ok(!live.has(original.id), "the original commit is NOT reachable - it is orphaned");
});

test("reset moves a ref backward and orphans what it left behind", () => {
  const { replay } = run([
    { act: "write", path: "a.txt", text: "one\n" },
    { act: "store", path: "a.txt" }, { act: "list" }, { act: "save", message: "first" },
    { act: "write", path: "b.txt", text: "two\n" },
    { act: "store", path: "b.txt" }, { act: "list" }, { act: "save", message: "second" },
    { act: "write", path: "c.txt", text: "three\n" },
    { act: "store", path: "c.txt" }, { act: "list" }, { act: "save", message: "third" },
    { act: "name", ref: "refs/heads/main" },
    { act: "reset", ref: "refs/heads/main", to: "first" },
  ]);
  const commits = [...replay.store.objects.values()].filter((o) => o.type === "commit");
  assert.equal(commits.length, 3, "all three commits exist in the store");
  const first = commits.find((c) => c.commit?.message === "first");
  const second = commits.find((c) => c.commit?.message === "second");
  const third = commits.find((c) => c.commit?.message === "third");
  assert.ok(first && second && third, "all commits are present");
  // The ref moved backward to the first commit.
  assert.equal(replay.store.refs.get("refs/heads/main"), first.id);
  // The second and third commits are no longer reachable.
  const live = replay.store.reachable();
  assert.ok(live.has(first.id), "first commit is reachable");
  assert.ok(!live.has(second.id), "second commit is NOT reachable - it is orphaned");
  assert.ok(!live.has(third.id), "third commit is NOT reachable - it is orphaned");
});

test("acts that cannot apply are skipped, not thrown", () => {
  const { replay } = run([
    { act: "store", path: "missing.txt" },
    { act: "list" },
    { act: "save", message: "nothing to save" },
    { act: "name", ref: "refs/heads/main", at: "no such save" },
  ]);
  assert.equal(replay.store.objects.size, 0);
  assert.equal(replay.store.refs.size, 0);
});

test("only objects created by the fresh acts are marked", () => {
  const acts: ObjectAct[] = [
    { act: "write", path: "a.txt", text: "one\n" },
    { act: "store", path: "a.txt" },
    { act: "list" },
  ];
  const scene = resolveObjects({ acts, fresh: 1 })!;
  const replay = replayObjects(scene);
  assert.equal(replay.added.size, 1, "the tree, not the blob before it");
  const tree = [...replay.store.objects.values()].find((o) => o.type === "tree")!;
  assert.ok(replay.added.has(tree.id));
});

test("the default author is used when a scene does not set one", () => {
  assert.equal(resolveObjects({ acts: [] })!.author, DEFAULT_AUTHOR);
  assert.equal(resolveObjects({ acts: [], author: "X <x@y> 1 +0000" })!.author, "X <x@y> 1 +0000");
});

test("chain rows read from the name down to the content", () => {
  const { replay } = run([
    { act: "write", path: "hello.txt", text: "hello world\n" },
    { act: "store", path: "hello.txt" },
    { act: "list" },
    { act: "save", message: "save the greeting" },
    { act: "name", ref: "refs/heads/main" },
  ]);
  const rows = chainRows(replay);
  assert.deepEqual(rows.map((r) => r.kind), ["ref", "commit", "tree", "blob"]);
  assert.equal(rows[0].label, "main");
  assert.deepEqual(rows[1].names, [{ role: "tree", id: rows[2].id }], "the commit names the tree");
  // Depth is what puts the tree visibly UNDER the commit that reaches it.
  assert.deepEqual(rows.map((r) => r.depth), [0, 0, 1, 2]);
  assert.deepEqual(rows[2].names, [], "the tree already shows the blob id in its body");
  assert.deepEqual(rows[3].names, [], "a blob names nothing at all");
  assert.ok(rows[2].body!.includes(short(rows[3].id)));
  assert.ok(rows.every((r) => !r.unreachable));
});

test("chain rows mark what no name reaches", () => {
  const { replay } = run([
    { act: "write", path: "a.txt", text: "one\n" },
    { act: "store", path: "a.txt" }, { act: "list" }, { act: "save", message: "one" },
    { act: "name", ref: "refs/heads/main" },
    { act: "write", path: "a.txt", text: "two\n" },
    { act: "store", path: "a.txt" },
  ]);
  const rows = chainRows(replay);
  const orphans = rows.filter((r) => r.unreachable);
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].label, "blob", "the label is git's own word; 'unnamed' is the view's chrome");
});

test("a commit chain shows the parent as its own row, never nested", () => {
  const { replay } = run([
    { act: "write", path: "a.txt", text: "one\n" },
    { act: "store", path: "a.txt" }, { act: "list" }, { act: "save", message: "one" },
    { act: "write", path: "a.txt", text: "two\n" },
    { act: "store", path: "a.txt" }, { act: "list" }, { act: "save", message: "two" },
    { act: "name", ref: "refs/heads/main" },
  ]);
  const rows = chainRows(replay);
  const commits = rows.filter((r) => r.kind === "commit");
  assert.equal(commits.length, 2);
  assert.equal(commits[0].body, "two", "newest first");
  assert.ok(
    commits[0].names.some((n) => n.role === "parent" && n.id === commits[1].id),
    "and it NAMES its parent, saying that is what it is",
  );
  // Each commit is followed by ITS OWN tree. Listing both commits first
  // stranded the older tree at the bottom, past another save's blobs.
  const kinds = rows.map((r) => r.kind);
  assert.deepEqual(kinds, ["ref", "commit", "tree", "blob", "commit", "tree", "blob"]);
});

// A row used to name whatever was DRAWN next, which is right by luck with one
// commit and wrong the moment there are two: the older commit ended up naming
// the newer commit's tree, and a blob ended up naming another blob.
test("what a row names comes from the object, not from the row below it", () => {
  const { replay } = run([
    { act: "write", path: "a.txt", text: "one\n" },
    { act: "store", path: "a.txt" }, { act: "list" }, { act: "save", message: "one" },
    { act: "name", ref: "refs/heads/main" },
    { act: "write", path: "a.txt", text: "two\n" },
    { act: "store", path: "a.txt" }, { act: "list" }, { act: "save", message: "two" },
    { act: "name", ref: "refs/heads/main" },
  ]);
  const rows = chainRows(replay);
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const row of rows) {
    if (row.kind === "blob") assert.deepEqual(row.names, [], "a blob names nothing");
    for (const named of row.names) {
      const target = replay.store.objects.get(named.id)!;
      const self = replay.store.objects.get(row.id)!;
      assert.ok(
        self.commit!.tree === named.id || self.commit!.parents.includes(named.id),
        `${row.label} ${short(row.id)} claims to name ${short(named.id)}, which it does not`,
      );
      assert.ok(target, "and the id it names is a real object");
      assert.ok(byId.has(named.id), "which is on screen, so the chip can be followed");
      // The role is what stops two bare ids from being indistinguishable.
      const expected = self.commit!.tree === named.id ? "tree" : "parent";
      assert.equal(named.role, expected, "each chip says what git calls it");
    }
  }
});

test("an unnamed tree still shows what it holds", () => {
  const { replay } = run([
    { act: "write", path: "a.txt", text: "one\n" },
    { act: "store", path: "a.txt" }, { act: "list" }, { act: "save", message: "one" },
    { act: "name", ref: "refs/heads/main" },
    { act: "write", path: "a.txt", text: "two\n" },
    { act: "store", path: "a.txt" }, { act: "list" },
  ]);
  const orphanTree = chainRows(replay).find((r) => r.unreachable && r.kind === "tree")!;
  assert.ok(orphanTree.body!.includes("a.txt -> "), "an empty row teaches nothing");
});

test("openRaw shows the exact bytes git hashes, header included", () => {
  const replay = replayObjects(
    resolveObjects({
      acts: [
        { act: "write", path: "notes.md", text: "hello world\n" },
        { act: "store", path: "notes.md" },
      ],
    })!,
  );
  const plain = openObject(replay, "blob");
  const raw = openObject(replay, "blob", true);
  assert.equal(plain!.text, "hello world\n");
  assert.equal(plain!.header, undefined);
  // The header comes back separately so a view can give it its own line; the
  // NUL stays on the header, which is where it is in the bytes.
  assert.equal(raw!.header, "blob 12\\0");
  assert.equal(raw!.text, "hello world\n");
  // The id is the hash of exactly those bytes - proved against real git.
  assert.equal(raw!.id, "3b18e512dba79e4c8300dd08aeb37f8e728b8dad");
});

test("a path with a slash builds a real subtree - ids match git", () => {
  const replay = replayObjects(
    resolveObjects({
      acts: [
        { act: "write", path: "notes.md", text: "hello world\n" },
        { act: "store", path: "notes.md" },
        { act: "write", path: "docs/guide.md", text: "read me\n" },
        { act: "store", path: "docs/guide.md" },
        { act: "list" },
      ],
    })!,
  );
  const ids = [...replay.store.objects.values()].map((o) => `${o.type} ${o.id}`);
  // Every one of these came out of real git 2.34.1 on the same two files.
  assert.deepEqual(ids.sort(), [
    "blob 3b18e512dba79e4c8300dd08aeb37f8e728b8dad", // notes.md
    "blob d9b401251bb36c51ca5c56c2ffc8a24a78ff20ae", // docs/guide.md
    "tree 6e5cb5bf4fb518d4d56f1639d9dfca12ad228aed", // the top tree
    "tree af5e9eaee94e434a05e5e461f8d102b42da42834", // the docs tree
  ].sort());
  // git writes ONE tree object per directory, so two directories means two.
  assert.equal(ids.filter((s) => s.startsWith("tree")).length, 2);
});

test("openRaw is a no-op for a tree, whose ids are binary", () => {
  const replay = replayObjects(
    resolveObjects({
      acts: [
        { act: "write", path: "notes.md", text: "hello world\n" },
        { act: "store", path: "notes.md" },
        { act: "list" },
      ],
    })!,
  );
  // Rendering twenty binary bytes as text means inventing a picture of them.
  // A tree is shown decoded, and never claims to be showing raw bytes.
  const raw = openObject(replay, "tree", true)!;
  assert.equal(raw.header, undefined);
  assert.match(raw.text, /^100644 blob [0-9a-f]{40}\tnotes\.md$/);
});

test("an object shared by two commits is drawn once, under the newer one", () => {
  const { replay } = run([
    { act: "write", path: "a.txt", text: "one\n" },
    { act: "store", path: "a.txt" }, { act: "list" }, { act: "save", message: "one" },
    { act: "write", path: "b.txt", text: "two\n" },
    { act: "store", path: "b.txt" }, { act: "list" }, { act: "save", message: "two" },
    { act: "name", ref: "refs/heads/main" },
  ]);
  const rows = chainRows(replay);
  const aBlob = rows.filter((r) => r.body === "one\n");
  // git stores it once, so the picture shows it once. The older commit's tree
  // row still spells out the id, so the link is not lost.
  assert.equal(aBlob.length, 1, "one object, one row");
  const olderTree = rows[rows.length - 1];
  assert.ok(olderTree.body!.includes("a.txt -> "), "and the older tree still names it");
});
