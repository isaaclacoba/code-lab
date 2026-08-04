// The GHOST MODEL: one canvas laid out from the TARGET state. Commits the learner
// has are solid, commits still missing are ghosted in the slot they will occupy,
// and commits the target does not contain are flagged. These tests cover the
// stress cases the owner ratified the design against.

import { test } from "node:test";
import assert from "node:assert/strict";
import "./setup-dom.ts";
import { init, addFiles, stage, commit, checkout, merge, type RepoState } from "../src/core/git-model.ts";
import { GitGraph } from "../src/dom/git-graph-view.ts";

// --- helpers ---------------------------------------------------------------

function commitFiles(s: RepoState, message: string, paths: string[]): RepoState {
  return commit(stage(addFiles(s, paths).state, paths).state, message).state;
}

function head(s: RepoState): string | null {
  if (s.head.kind === "detached") return s.head.commit;
  return s.refs.get(s.head.name) ?? null;
}

function mount(
  state: RepoState,
  opts?: { ghost?: string[]; diverged?: string[] },
): { view: GitGraph; host: HTMLElement } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const view = new GitGraph();
  view.mount(host, { state, ...opts });
  return { view, host };
}

/** The union a practical page would draw when the learner went off-plan: the
 *  learner's own "oops" commit on `wip` (created FIRST, so its edge is drawn
 *  last) and the still-missing target commit on `main`. HEAD sits where the
 *  learner is. */
function divergedUnion(): { state: RepoState; base: string; ghost: string; diverged: string } {
  let s = init();
  s = commitFiles(s, "init", ["a.js"]);
  const base = head(s)!;
  s = checkout(s, "wip", { create: true }).state;
  s = commitFiles(s, "oops", ["o.js"]);
  const diverged = head(s)!;
  s = checkout(s, "main").state;
  s = commitFiles(s, "add readme", ["readme.md"]);
  const ghost = head(s)!;
  s = checkout(s, "wip").state;
  return { state: s, base, ghost, diverged };
}

/** main and feature both advanced, then merged - the merge the learner has not
 *  made yet. */
function mergeUnion(): { state: RepoState; merge: string } {
  let s = init();
  s = commitFiles(s, "init", ["a.js"]);
  s = checkout(s, "feature", { create: true }).state;
  s = commitFiles(s, "feature work", ["f.js"]);
  s = checkout(s, "main").state;
  s = commitFiles(s, "main work", ["m.js"]);
  s = merge(s, "feature").state;
  return { state: s, merge: head(s)! };
}

function linearRepo(): RepoState {
  let s = init();
  s = commitFiles(s, "init", ["a.js"]);
  s = commitFiles(s, "add readme", ["readme.md"]);
  return s;
}

const cls = (host: HTMLElement, id: string): string =>
  (host.querySelector(`[data-commit="${id}"]`) as SVGElement).getAttribute("class") ?? "";

const chipNamed = (host: HTMLElement, label: string): HTMLElement =>
  [...host.querySelectorAll(".cl-git-chip")].find((c) => c.textContent === label) as HTMLElement;

// --- a. divergence ---------------------------------------------------------

test("a diverged commit is flagged while the missing one is ghosted", () => {
  const u = divergedUnion();
  const { view, host } = mount(u.state, { ghost: [u.ghost], diverged: [u.diverged] });

  assert.match(cls(host, u.ghost), /\bcl-git-ghost\b/);
  assert.doesNotMatch(cls(host, u.ghost), /\bcl-git-diverged\b/);
  assert.match(cls(host, u.diverged), /\bcl-git-diverged\b/);
  assert.doesNotMatch(cls(host, u.diverged), /\bcl-git-ghost\b/);
  // The shared history stays solid, and every node keeps its base class.
  assert.equal(cls(host, u.base), "cl-git-node");
  assert.equal(host.querySelectorAll(".cl-git-node").length, 3);
  view.destroy();
});

test("a commit listed as both diverged and ghost is treated as diverged", () => {
  const u = divergedUnion();
  const { view, host } = mount(u.state, { ghost: [u.diverged], diverged: [u.diverged] });
  assert.match(cls(host, u.diverged), /\bcl-git-diverged\b/);
  assert.doesNotMatch(cls(host, u.diverged), /\bcl-git-ghost\b/);
  view.destroy();
});

// --- edges -----------------------------------------------------------------

test("the ghosted edge is the one whose CHILD is ghosted, not the last drawn", () => {
  const u = divergedUnion();
  const { view, host } = mount(u.state, { ghost: [u.ghost], diverged: [u.diverged] });

  const paths = [...host.querySelectorAll("path.cl-git-edge")];
  assert.equal(paths.length, 2, "one edge per parent link");
  assert.equal(host.querySelectorAll("path.cl-git-edge-ghost").length, 1);
  // Edges are drawn newest-child first, so the ghost's edge is the FIRST path
  // here. A "fade the last N paths" shortcut would have picked the wrong one.
  assert.match(paths[0].getAttribute("class") ?? "", /\bcl-git-edge-ghost\b/);
  assert.doesNotMatch(paths[1].getAttribute("class") ?? "", /\bcl-git-edge-ghost\b/);
  view.destroy();
});

// --- b. lane agreement -----------------------------------------------------

test("ghosting never moves a commit: the ghost sits exactly where its solid self would", () => {
  const u = divergedUnion();
  const { view, host } = mount(u.state, { ghost: [u.ghost], diverged: [u.diverged] });

  const positions = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const g of host.querySelectorAll("[data-commit]")) {
      const dot = g.querySelector(".cl-git-dot")!;
      out[(g as HTMLElement).dataset.commit!] = `${dot.getAttribute("cx")},${dot.getAttribute("cy")}`;
    }
    return out;
  };

  const ghosted = positions();
  // The same union, now fully solved: one layout means identical geometry.
  view.setState(u.state);
  assert.deepEqual(positions(), ghosted);
  // And the two branch tips really are on different rows, so this is not a
  // single-lane graph passing by accident.
  assert.notEqual(ghosted[u.ghost].split(",")[1], ghosted[u.diverged].split(",")[1]);
  view.destroy();
});

// --- c. an unmade merge ----------------------------------------------------

test("a merge the learner has not made ghosts the merge node and BOTH its edges", () => {
  const m = mergeUnion();
  const { view, host } = mount(m.state, { ghost: [m.merge] });

  assert.match(cls(host, m.merge), /\bcl-git-ghost\b/);
  const ghostEdges = host.querySelectorAll("path.cl-git-edge-ghost");
  assert.equal(host.querySelectorAll("path.cl-git-edge").length, 4);
  assert.equal(ghostEdges.length, 2, "both incoming edges of the merge are ghosted");
  // The two branch tips it merges are still solid.
  assert.equal(host.querySelectorAll(".cl-git-node.cl-git-ghost").length, 1);
  view.destroy();
});

// --- d. the solved case ----------------------------------------------------

test("nothing ghosted means no ghost or diverged class anywhere", () => {
  const { view, host } = mount(mergeUnion().state);
  assert.equal(host.querySelectorAll(".cl-git-ghost, .cl-git-edge-ghost, .cl-git-diverged").length, 0);
  view.destroy();
});

test("setState without an overlay clears a previous one", () => {
  const u = divergedUnion();
  const { view, host } = mount(u.state, { ghost: [u.ghost], diverged: [u.diverged] });
  // The ghost node, the `main` chip riding it, and the diverged node.
  assert.equal(host.querySelectorAll(".cl-git-ghost, .cl-git-diverged").length, 3);

  view.setState(u.state, { animate: true });
  assert.equal(host.querySelectorAll(".cl-git-ghost, .cl-git-edge-ghost, .cl-git-diverged").length, 0);
  view.destroy();
});

// --- e. chips --------------------------------------------------------------

test("a chip pointing at a ghosted commit is ghosted, and its neighbours are not", () => {
  const u = divergedUnion();
  const { view, host } = mount(u.state, { ghost: [u.ghost], diverged: [u.diverged] });

  assert.match(chipNamed(host, "main").className, /\bcl-git-ghost\b/);
  assert.doesNotMatch(chipNamed(host, "wip").className, /\bcl-git-ghost\b/);
  view.destroy();
});

test("the HEAD pill ghosts and un-ghosts with the commit it rides", () => {
  const s = linearRepo();
  const tip = head(s)!;
  const { view, host } = mount(s, { ghost: [tip] });
  const pill = host.querySelector(".cl-git-chip.is-head") as HTMLElement;

  assert.ok(pill.classList.contains("cl-git-ghost"));
  view.setState(s);
  assert.equal(pill.classList.contains("cl-git-ghost"), false);
  view.destroy();
});

// --- animation honesty -----------------------------------------------------

test("a ghost never animates in, but turning solid does", () => {
  const u = divergedUnion();
  const { view, host } = mount(u.state, { ghost: [u.ghost] });

  // Re-render with the ghost still missing: nothing is an achievement yet.
  view.setState(u.state, { animate: true, ghost: [u.ghost] });
  assert.equal(host.querySelectorAll(".cl-git-appear").length, 0);
  assert.equal(host.querySelectorAll("path.cl-git-edge-draw").length, 0);

  // The learner makes it: the node that was a ghost is the one that animates.
  view.setState(u.state, { animate: true });
  const appeared = [...host.querySelectorAll(".cl-git-node.cl-git-appear")];
  assert.equal(appeared.length, 1);
  assert.equal((appeared[0] as HTMLElement).dataset.commit, u.ghost);
  view.destroy();
});

// --- inspect ---------------------------------------------------------------

test("clicking a ghost inspects with a ghost flag; a real commit does not", () => {
  const u = divergedUnion();
  const { view, host } = mount(u.state, { ghost: [u.ghost], diverged: [u.diverged] });
  const seen: Array<{ commit?: string; ref?: string; ghost?: true }> = [];
  view.on("inspect", (p) => seen.push(p));

  const click = (id: string): void => {
    const dot = host.querySelector(`[data-commit="${id}"] .cl-git-dot`) as SVGElement;
    dot.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  };
  click(u.ghost);
  click(u.diverged);

  assert.deepEqual(seen, [{ commit: u.ghost, ghost: true }, { commit: u.diverged }]);
  view.destroy();
});
