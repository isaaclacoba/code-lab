import { test } from "node:test";
import assert from "node:assert/strict";
import {
  init,
  stage,
  commit,
  branch,
  tag,
  checkout,
  merge,
  type RepoState,
} from "../src/core/git-model.ts";
import { layout, type GraphLayout } from "../src/core/git-layout.ts";

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

/** Map every node id to its time index (x). */
function timeById(g: GraphLayout): Map<string, number> {
  return new Map(g.nodes.map((n) => [n.id, n.x]));
}

/** Map every node id to its lane / branch row (y). */
function laneById(g: GraphLayout): Map<string, number> {
  return new Map(g.nodes.map((n) => [n.id, n.y]));
}

/** Find the single chip with the given label. */
function chip(g: GraphLayout, label: string) {
  const found = g.chips.filter((c) => c.label === label);
  assert.equal(found.length, 1, `exactly one '${label}' chip`);
  return found[0];
}

// --- linear history --------------------------------------------------------

test("a linear history sits on one row with increasing time", () => {
  let s = init();
  s = commitFiles(s, "a", ["a"]);
  const a = head(s)!;
  s = commitFiles(s, "b", ["b"]);
  const b = head(s)!;
  s = commitFiles(s, "c", ["c"]);
  const c = head(s)!;

  const g = layout(s);
  const x = timeById(g);
  const y = laneById(g);

  // oldest at the left (x=0), newest on the right.
  assert.equal(x.get(a), 0);
  assert.equal(x.get(b), 1);
  assert.equal(x.get(c), 2);
  // one row for the whole line.
  assert.equal(y.get(a), 0);
  assert.equal(y.get(b), 0);
  assert.equal(y.get(c), 0);
  assert.equal(g.width, 3);
  assert.equal(g.height, 1);

  // edges chain child -> parent.
  assert.deepEqual(g.edges, [
    { from: c, to: b },
    { from: b, to: a },
  ]);

  // branch chip on the tip + an attached HEAD chip riding it.
  const main = chip(g, "main");
  assert.equal(main.kind, "branch");
  assert.equal(main.commit, c);
  const h = chip(g, "HEAD");
  assert.equal(h.kind, "head");
  assert.equal(h.commit, c);
  assert.equal(h.on, "main");
});

// --- two divergent branches ------------------------------------------------

test("two divergent branches take different rows and each get a chip", () => {
  let s = init();
  s = commitFiles(s, "root", ["r"]);
  s = branch(s, "feature").state;
  s = commitFiles(s, "main-1", ["m"]);
  const m1 = head(s)!;
  s = checkout(s, "feature").state;
  s = commitFiles(s, "feat-1", ["f"]);
  const f1 = head(s)!;

  const g = layout(s);
  const y = laneById(g);

  // the two tips sit in different rows.
  assert.notEqual(y.get(m1), y.get(f1));
  assert.equal(g.height, 2);

  const mainChip = chip(g, "main");
  assert.equal(mainChip.commit, m1);
  const featChip = chip(g, "feature");
  assert.equal(featChip.commit, f1);

  // HEAD is attached to feature after the checkout.
  const h = chip(g, "HEAD");
  assert.equal(h.commit, f1);
  assert.equal(h.on, "feature");
});

// --- merge commit ----------------------------------------------------------

test("a merge commit has two edges and its second parent sits on its own row", () => {
  let s = init();
  s = commitFiles(s, "root", ["r"]);
  s = branch(s, "feature").state;
  s = commitFiles(s, "main-1", ["m"]);
  const m1 = head(s)!;
  s = checkout(s, "feature").state;
  s = commitFiles(s, "feat-1", ["f"]);
  const f1 = head(s)!;
  s = checkout(s, "main").state;
  s = merge(s, "feature").state;
  const mg = head(s)!;

  const g = layout(s);
  const y = laneById(g);

  // the merge commit records exactly two parent edges.
  const mergeEdges = g.edges.filter((e) => e.from === mg);
  assert.equal(mergeEdges.length, 2);
  assert.deepEqual(
    mergeEdges.map((e) => e.to),
    [m1, f1],
  );

  // first-parent line stays in the merge commit's row; second parent branches
  // off into another row.
  assert.equal(y.get(mg), y.get(m1));
  assert.notEqual(y.get(mg), y.get(f1));

  // that extra row is freed again once the feature line ends, so the whole
  // graph never needs more than two rows.
  assert.equal(g.height, 2);
});

// --- tag chip --------------------------------------------------------------

test("a tag becomes a tag chip on the commit it points at", () => {
  let s = init();
  s = commitFiles(s, "a", ["a"]);
  const a = head(s)!;
  s = tag(s, "v1").state;

  const g = layout(s);
  const v1 = chip(g, "v1");
  assert.equal(v1.kind, "tag");
  assert.equal(v1.commit, a);
});

// --- detached HEAD ---------------------------------------------------------

test("a detached HEAD chip carries no 'on' branch", () => {
  let s = init();
  s = commitFiles(s, "a", ["a"]);
  const a = head(s)!;
  s = commitFiles(s, "b", ["b"]);
  s = checkout(s, a).state; // detach onto the first commit

  const g = layout(s);
  const h = chip(g, "HEAD");
  assert.equal(h.kind, "head");
  assert.equal(h.commit, a);
  assert.equal(h.on, undefined);
});

// --- unborn repo -----------------------------------------------------------

test("an unborn repo lays out empty with no HEAD chip", () => {
  const g = layout(init());
  assert.deepEqual(g.nodes, []);
  assert.deepEqual(g.edges, []);
  assert.deepEqual(g.chips, []);
  assert.equal(g.width, 0);
  assert.equal(g.height, 0);
});

// --- topology invariant ----------------------------------------------------

test("every parent has a strictly smaller time index than each of its children", () => {
  // A non-trivial DAG: a merge plus an extra commit after it.
  let s = init();
  s = commitFiles(s, "root", ["r"]);
  s = branch(s, "feature").state;
  s = commitFiles(s, "main-1", ["m"]);
  s = checkout(s, "feature").state;
  s = commitFiles(s, "feat-1", ["f"]);
  s = commitFiles(s, "feat-2", ["f2"]);
  s = checkout(s, "main").state;
  s = merge(s, "feature").state;
  s = commitFiles(s, "main-2", ["m2"]);

  const g = layout(s);
  const x = timeById(g);

  for (const c of s.commits.values()) {
    for (const p of c.parents) {
      assert.ok(
        x.get(p)! < x.get(c.id)!,
        `parent ${p} (x=${x.get(p)}) must be left of child ${c.id} (x=${x.get(c.id)})`,
      );
    }
  }

  // time indices are a dense 0..n-1 permutation.
  const times = [...x.values()].sort((a, b) => a - b);
  assert.deepEqual(
    times,
    times.map((_, i) => i),
  );
  assert.equal(g.width, s.commits.size);
});

// --- width / height --------------------------------------------------------

test("width counts commits and height counts lanes", () => {
  let s = init();
  s = commitFiles(s, "root", ["r"]);
  s = branch(s, "feature").state;
  s = commitFiles(s, "main-1", ["m"]);
  s = checkout(s, "feature").state;
  s = commitFiles(s, "feat-1", ["f"]);

  const g = layout(s);
  assert.equal(g.width, 3);
  assert.equal(g.height, 2);
  // height is exactly one more than the largest lane/row index used.
  const maxLane = Math.max(...g.nodes.map((n) => n.y));
  assert.equal(g.height, maxLane + 1);
});

// --- determinism -----------------------------------------------------------

test("the same state lays out identically every time", () => {
  let s = init();
  s = commitFiles(s, "root", ["r"]);
  s = branch(s, "feature").state;
  s = commitFiles(s, "main-1", ["m"]);
  s = checkout(s, "feature").state;
  s = commitFiles(s, "feat-1", ["f"]);
  s = checkout(s, "main").state;
  s = merge(s, "feature").state;
  s = tag(s, "release").state;

  assert.deepEqual(layout(s), layout(s));
});
