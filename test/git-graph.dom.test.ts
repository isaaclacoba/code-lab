import { test } from "node:test";
import assert from "node:assert/strict";
import "./setup-dom.ts";
import {
  init,
  addFiles,
  stage,
  commit,
  tag,
  checkout,
  merge,
  type RepoState,
} from "../src/core/git-model.ts";
import { GitGraph } from "../src/dom/git-graph-view.ts";

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

/** A linear main history of three commits (a -> b -> c) plus a v1 tag on b. */
function linearRepo(): RepoState {
  let s = init();
  s = commitFiles(s, "init", ["a.js"]);
  s = commitFiles(s, "add readme", ["readme.md"]);
  s = tag(s, "v1").state;
  s = commitFiles(s, "wire config", ["config.js"]);
  return s;
}

function mount(state: RepoState): { view: GitGraph; host: HTMLElement } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const view = new GitGraph();
  view.mount(host, { state });
  return { view, host };
}

// --- render ----------------------------------------------------------------

test("mount renders a .cl-git with one dot per commit", () => {
  const { view, host } = mount(linearRepo());
  const root = host.querySelector(".cl-git");
  assert.ok(root, "root .cl-git is present");
  assert.equal(host.querySelectorAll(".cl-git-node").length, 3);
  view.destroy();
});

test("mount renders a chip per ref: main branch, v1 tag, and HEAD", () => {
  const { view, host } = mount(linearRepo());
  assert.equal(host.querySelectorAll(".cl-git-chip.is-branch").length, 1);
  assert.equal(host.querySelectorAll(".cl-git-chip.is-tag").length, 1);
  const headPill = host.querySelector(".cl-git-chip.is-head") as HTMLElement;
  assert.ok(headPill && !headPill.hidden, "HEAD pill is shown");
  view.destroy();
});

test("setState adds a new dot when a commit is made", () => {
  let s = linearRepo();
  const { view, host } = mount(s);
  assert.equal(host.querySelectorAll(".cl-git-node").length, 3);

  s = commitFiles(s, "add feature", ["feature.js"]);
  view.setState(s, { animate: true });
  assert.equal(host.querySelectorAll(".cl-git-node").length, 4);
  // The new dot is the only one flagged for the appear animation.
  assert.equal(host.querySelectorAll(".cl-git-node.cl-git-appear").length, 1);
  view.destroy();
});

// --- interactivity ---------------------------------------------------------

test("clicking a commit dot fires inspect with that commit id", () => {
  const s = linearRepo();
  const tip = head(s)!;
  const { view, host } = mount(s);

  const seen: Array<{ commit?: string; ref?: string }> = [];
  view.on("inspect", (p) => seen.push(p));

  const dot = host.querySelector(`[data-commit="${tip}"] .cl-git-dot`) as SVGElement;
  assert.ok(dot, "the tip commit has a dot");
  dot.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  assert.deepEqual(seen, [{ commit: tip }]);
  view.destroy();
});

test("clicking a branch chip fires inspect with the full ref", () => {
  const { view, host } = mount(linearRepo());
  const seen: Array<{ commit?: string; ref?: string }> = [];
  view.on("inspect", (p) => seen.push(p));

  const chip = host.querySelector(".cl-git-chip.is-branch") as HTMLElement;
  chip.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  assert.deepEqual(seen, [{ ref: "refs/heads/main" }]);
  view.destroy();
});

// --- working area ----------------------------------------------------------

test("the three zones list the right files: modified, staged, committed", () => {
  // logo.png is committed; app.js is modified in the worktree; readme.md is staged.
  let s = init();
  s = commitFiles(s, "init", ["logo.png"]);
  s = { ...s, worktree: new Map([["app.js", { status: "modified", text: "" }]]) } as RepoState;
  s = stage(addFiles(s, ["readme.md"]).state, ["readme.md"]).state;

  const { view, host } = mount(s);
  const text = (sel: string) =>
    [...host.querySelectorAll(`${sel} .cl-git-fname`)].map((n) => n.textContent);

  assert.deepEqual(text(".cl-git-zone.is-tree"), ["app.js"]);
  assert.deepEqual(text(".cl-git-zone.is-index"), ["readme.md"]);
  assert.deepEqual(text(".cl-git-zone.is-repo"), ["logo.png"]);
  view.destroy();
});

test("the working tree draws an untracked file differently from a modified one", () => {
  // The folder holds three files; only app.js is tracked-and-edited.
  let s = init();
  s = commitFiles(s, "init", ["app.js"]);
  s = addFiles(s, ["cat.txt", "notes.md"]).state;
  s = { ...s, worktree: new Map([...s.worktree, ["app.js", { status: "modified", text: "" }]]) } as RepoState;

  const { view, host } = mount(s);
  const rows = [...host.querySelectorAll(".cl-git-zone.is-tree .cl-git-file")];
  const seen = rows.map((r) => [
    r.querySelector(".cl-git-fname")!.textContent,
    r.classList.contains("is-untracked") ? "untracked" : r.classList.contains("is-modified") ? "modified" : "?",
  ]);

  assert.deepEqual(seen, [
    ["app.js", "modified"],
    ["cat.txt", "untracked"],
    ["notes.md", "untracked"],
  ]);
  // the two states are not painted with the same class
  assert.equal(rows[0].className.includes("is-untracked"), false);
  view.destroy();
});

test("a staged or committed file carries no working-tree state class", () => {
  let s = init();
  s = commitFiles(s, "init", ["logo.png"]);
  s = stage(addFiles(s, ["readme.md"]).state, ["readme.md"]).state;

  const { view, host } = mount(s);
  for (const sel of [".cl-git-zone.is-index", ".cl-git-zone.is-repo"]) {
    for (const row of host.querySelectorAll(`${sel} .cl-git-file`)) {
      assert.equal(row.classList.contains("is-untracked"), false);
      assert.equal(row.classList.contains("is-modified"), false);
    }
  }
  view.destroy();
});

test("an empty working tree renders no file rows, leaving the em-dash empty state", () => {
  const s = commitFiles(init(), "init", ["logo.png"]);
  const { view, host } = mount(s);
  const body = host.querySelector(".cl-git-zone.is-tree .cl-git-zone-body")!;
  assert.equal(body.children.length, 0, "nothing in the tree -> the CSS :empty em-dash shows");
  view.destroy();
});

test("a committed path currently modified shows in the tree, not the repository", () => {
  let s = init();
  s = commitFiles(s, "init", ["app.js"]);
  s = { ...s, worktree: new Map([["app.js", { status: "modified", text: "" }]]) } as RepoState;

  const { view, host } = mount(s);
  const text = (sel: string) =>
    [...host.querySelectorAll(`${sel} .cl-git-fname`)].map((n) => n.textContent);

  assert.deepEqual(text(".cl-git-zone.is-tree"), ["app.js"]);
  assert.deepEqual(text(".cl-git-zone.is-repo"), []);
  view.destroy();
});

// --- branches / merge / destroy --------------------------------------------

test("a merge renders the merge dot and both incoming edges without re-animating the graph", () => {
  let s = init();
  s = commitFiles(s, "init", ["a.js"]);
  s = checkout(s, "feature", { create: true }).state;
  s = commitFiles(s, "feature work", ["f.js"]);
  s = checkout(s, "main").state;
  s = commitFiles(s, "main work", ["m.js"]);

  const { view, host } = mount(s);
  const before = host.querySelectorAll(".cl-git-node").length;

  s = merge(s, "feature").state;
  view.setState(s, { animate: true });
  assert.equal(host.querySelectorAll(".cl-git-node").length, before + 1);
  // Only the merge commit is new, so only one dot animates.
  assert.equal(host.querySelectorAll(".cl-git-node.cl-git-appear").length, 1);
  view.destroy();
});

test("destroy removes the root and stops delivering events", () => {
  const s = linearRepo();
  const tip = head(s)!;
  const { view, host } = mount(s);

  let count = 0;
  view.on("inspect", () => count++);
  const dot = host.querySelector(`[data-commit="${tip}"] .cl-git-dot`) as SVGElement;
  dot.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  assert.equal(count, 1);

  const root = host.querySelector(".cl-git") as HTMLElement;
  view.destroy();
  assert.equal(host.querySelector(".cl-git"), null, "root is detached");
  // A click on the now-detached node delivers nothing.
  root.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  assert.equal(count, 1);
});
