// GitGraph: the animated view of a git commit-DAG. It paints a `RepoState` and
// nothing more - all the geometry comes from the DOM-free `layout()` in
// `src/core/git-layout.ts`, and all the git semantics from `src/core/git-model.ts`.
// The view only turns those into SVG nodes/edges, HTML ref chips, and the
// three-zone working area, and animates the DELTA between two states.
//
// Orientation is HORIZONTAL (Learn-Git-Branching style): time flows left->right
// (x = layout column), branches stack in rows (y = lane). One colour per lane; a
// merge dips to a branch row on a smooth cubic and rejoins. Everything is
// re-derived on `setState`; only elements that are NEW versus the previous render
// get the gentle ~400ms fade/slide, so a merge draws just its dot + two edges and
// the rest of the graph stays put. The HEAD pill is a persistent element that
// glides to its commit. All motion collapses to instant under
// `prefers-reduced-motion` (handled in CSS).
//
// GHOST MODEL (practical pages). There is only ever ONE graph: the state handed
// in is the TARGET-derived union, laid out once, so every commit sits in the slot
// the target gives it. `ghost` lists the commits the learner has not made yet -
// drawn faded and dashed in the slot they will occupy; `diverged` lists commits
// the learner made that the target does not contain - drawn flagged. Progress is
// ghosts turning solid. Because the layout comes from the one union state, a
// ghost can never disagree with its solid counterpart about lane or column.

import type { RepoState, Hash, WorktreeStatus } from "../core/git-model.js";
import { layout } from "../core/git-layout.js";
import type { LayoutNode } from "../core/git-layout.js";
import { svgEl } from "./svg.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// Grid -> pixel scale. Gaps chosen to read like the ratified mockup (~120x~90)
// with a little extra room so ref chips above a lower lane clear the labels of
// the lane above it.
const COL_GAP = 128;
const ROW_GAP = 112;
const PAD_X = 64;
const PAD_TOP = 76;
const LABEL_BELOW = 54;
const NODE_R = 10;

// Fallback lane palette (lane0 indigo, lane1 teal, then cycle). Emitted as
// `var(--clg-lane-N, <hex>)` so a course theme can re-point each lane while the
// widget still works standalone.
const LANE_FALLBACK = ["#6366f1", "#14b8a6", "#f97316", "#a855f7", "#0ea5e9", "#e11d48"];

/** A ref/HEAD label anchored to a commit, used by the click delegate. `ghost` is
 *  set only when the clicked commit is one the learner has not made yet, so a
 *  host can teach ("not there yet") instead of inspecting a commit that does not
 *  exist. */
export interface GitGraphInspect {
  commit?: Hash;
  ref?: string;
  ghost?: true;
}

/** Which commits render ghosted (missing) or flagged (off-plan). Both are read
 *  fresh on every `setState`: they describe the snapshot, they are not sticky. */
export interface GitGraphOverlay {
  ghost?: Hash[];
  diverged?: Hash[];
}

type InspectHandler = (p: GitGraphInspect) => void;

/** The learner wrote a file - by hand in the conflict editor, or with one of
 *  its buttons. The board cannot change the repository itself; the plugin owns
 *  the state, so it hears about the edit and applies it. */
export type FileEditHandler = (path: string, text: string) => void;
type Zone = "tree" | "index" | "repo";

/** The CSS custom-property reference for a lane's colour (0-based). */
function laneVar(lane: number): string {
  const n = LANE_FALLBACK.length;
  const i = ((lane % n) + n) % n;
  return `var(--clg-lane-${i}, ${LANE_FALLBACK[i]})`;
}

/**
 * A lane colour dark enough to carry white label text.
 *
 * The lane colours are chosen for graph strokes, where nothing sits on top of
 * them. A branch chip reuses the same colour as a background under white 11px
 * text, and the teal lane lands at 2.49:1 - well under the WCAG AA floor. 70% of
 * the lane over black clears 4.5:1 on every lane and still reads as that lane's
 * colour, so a chip stays recognisably tied to its branch.
 */
function laneChipVar(lane: number): string {
  return `color-mix(in srgb, ${laneVar(lane)} 70%, #000)`;
}

/** The commit HEAD resolves to, or null when the branch is unborn. */
function headCommit(state: RepoState): Hash | null {
  if (state.head.kind === "detached") return state.head.commit;
  return state.refs.get(state.head.name) ?? null;
}

import { GitFilePanel } from "./git-file-panel.js";

export class GitGraph {
  private root!: HTMLElement;
  private graphWrap!: HTMLElement;
  private svg!: SVGSVGElement;
  private chipLayer!: HTMLElement;
  private headEl!: HTMLElement;
  private zoneBodies!: Record<Zone, HTMLElement>;
  private filePanel!: GitFilePanel;

  private state: RepoState | null = null;
  private readonly handlers: InspectHandler[] = [];
  private readonly editHandlers: FileEditHandler[] = [];

  // The ghost overlay for the current state (see the header note).
  private ghost = new Set<Hash>();
  private diverged = new Set<Hash>();

  // Diff bookkeeping across renders, so only NEW nodes/edges animate.
  private prevNodeIds = new Set<Hash>();
  private prevEdgeKeys = new Set<string>();
  private prevGhostIds = new Set<Hash>();
  private prevZoneOf = new Map<string, Zone>();

  // --- lifecycle ---------------------------------------------------------

  mount(host: HTMLElement, opts: { state: RepoState } & GitGraphOverlay): void {
    this.root = document.createElement("div");
    this.root.className = "cl-git";

    this.graphWrap = document.createElement("div");
    this.graphWrap.className = "cl-git-graph";

    this.svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
    this.svg.setAttribute("class", "cl-git-svg");

    this.chipLayer = document.createElement("div");
    this.chipLayer.className = "cl-git-chips";

    this.headEl = document.createElement("button");
    this.headEl.setAttribute("type", "button");
    this.headEl.className = "cl-git-chip is-head";
    this.headEl.textContent = "HEAD";
    this.headEl.dataset.ref = "HEAD";
    this.headEl.hidden = true;

    this.graphWrap.append(this.svg, this.chipLayer, this.headEl);
    this.filePanel = new GitFilePanel();
    this.root.append(this.graphWrap, this.buildWorkArea(), this.filePanel.el);

    this.root.addEventListener("click", this.onClick);
    host.appendChild(this.root);

    this.state = opts.state;
    this.setOverlay(opts);
    this.render(false);
  }

  setState(state: RepoState, opts?: { animate?: boolean } & GitGraphOverlay): void {
    this.state = state;
    this.setOverlay(opts);
    this.render(opts?.animate ?? false);
  }

  /** Replace the overlay wholesale. Omitting a list means "none": the overlay
   *  belongs to the state snapshot, so a caller that stops passing ghosts gets a
   *  fully solid graph rather than stale fading. A commit named in both lists is
   *  treated as diverged - the learner has it, so it is not missing. */
  private setOverlay(opts?: GitGraphOverlay): void {
    this.diverged = new Set(opts?.diverged ?? []);
    this.ghost = new Set((opts?.ghost ?? []).filter((id) => !this.diverged.has(id)));
  }

  on(event: "inspect", handler: InspectHandler): void;
  on(event: "fileEdit", handler: FileEditHandler): void;
  on(event: "inspect" | "fileEdit", handler: InspectHandler | FileEditHandler): void {
    if (event === "fileEdit") {
      this.editHandlers.push(handler as FileEditHandler);
      this.filePanel.onEdit((path, text) => {
        for (const h of this.editHandlers) h(path, text);
      });
      return;
    }
    if (event === "inspect") this.handlers.push(handler as InspectHandler);
  }

  destroy(): void {
    this.root.removeEventListener("click", this.onClick);
    this.handlers.length = 0;
    this.root.remove();
  }

  // --- event delegation --------------------------------------------------

  private readonly onClick = (ev: Event): void => {
    const target = ev.target as HTMLElement | null;
    if (!target || typeof target.closest !== "function") return;
    const refEl = target.closest("[data-ref]") as HTMLElement | null;
    if (refEl) {
      this.emit({ ref: refEl.dataset.ref });
      return;
    }
    const commitEl = target.closest("[data-commit]") as HTMLElement | SVGElement | null;
    if (!commitEl) return;
    const commit = (commitEl as HTMLElement).dataset?.commit;
    // A ghost is still clickable, but the payload says so: it is a slot, not a
    // commit, and inspecting it as if it existed would be a lie.
    this.emit(commit !== undefined && this.ghost.has(commit) ? { commit, ghost: true } : { commit });
  };

  private emit(p: GitGraphInspect): void {
    for (const h of this.handlers) h(p);
  }

  // --- render ------------------------------------------------------------

  private render(animate: boolean): void {
    const state = this.state;
    if (!state) return;
    const g = layout(state);

    const laneOf = new Map<Hash, number>();
    const posOf = new Map<Hash, { x: number; y: number }>();
    for (const node of g.nodes) {
      laneOf.set(node.id, node.y);
      posOf.set(node.id, this.px(node));
    }

    const width = PAD_X * 2 + Math.max(0, g.width - 1) * COL_GAP;
    const height = PAD_TOP + Math.max(0, g.height - 1) * ROW_GAP + LABEL_BELOW;
    this.svg.setAttribute("width", String(width));
    this.svg.setAttribute("height", String(height));
    this.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    this.graphWrap.style.width = `${width}px`;
    this.graphWrap.style.height = `${height}px`;

    const newNodeIds = new Set<Hash>();
    const newEdgeKeys = new Set<string>();

    this.svg.replaceChildren();
    this.drawEdges(g.edges, posOf, laneOf, animate, newEdgeKeys);
    this.drawNodes(g.nodes, state, animate, newNodeIds);

    this.drawChips(g.chips.filter((c) => c.kind !== "head"), posOf, laneOf);
    this.placeHead(g.chips.find((c) => c.kind === "head"), posOf, animate);

    this.renderZones(state, animate);
    this.filePanel.sync(state);

    this.prevNodeIds = newNodeIds;
    this.prevEdgeKeys = newEdgeKeys;
    this.prevGhostIds = new Set(this.ghost);
  }

  private px(node: LayoutNode): { x: number; y: number } {
    return { x: PAD_X + node.x * COL_GAP, y: PAD_TOP + node.y * ROW_GAP };
  }

  private drawEdges(
    edges: { from: Hash; to: Hash }[],
    posOf: Map<Hash, { x: number; y: number }>,
    laneOf: Map<Hash, number>,
    animate: boolean,
    newEdgeKeys: Set<string>,
  ): void {
    for (const edge of edges) {
      const child = posOf.get(edge.from);
      const parent = posOf.get(edge.to);
      if (!child || !parent) continue;
      const key = `${edge.from}>${edge.to}`;
      newEdgeKeys.add(key);
      const branchLane = Math.max(laneOf.get(edge.from) ?? 0, laneOf.get(edge.to) ?? 0);

      let d: string;
      if (child.y === parent.y) {
        d = `M${parent.x},${parent.y} L${child.x},${child.y}`;
      } else {
        const midX = (parent.x + child.x) / 2;
        d = `M${parent.x},${parent.y} C${midX},${parent.y} ${midX},${child.y} ${child.x},${child.y}`;
      }

      const isNew = animate && !this.prevEdgeKeys.has(key);
      // An edge belongs to its CHILD (the newer commit): if that commit has not
      // been made yet, the link to its parent has not happened either. Read off
      // the edge data, so a ghosted merge fades both of its incoming edges.
      const ghosted = this.ghost.has(edge.from);
      const classes = ["cl-git-edge"];
      if (isNew && !ghosted) classes.push("cl-git-edge-draw");
      if (ghosted) classes.push("cl-git-edge-ghost");
      const path = svgEl("path", {
        d,
        class: classes.join(" "),
        stroke: laneVar(branchLane),
        fill: "none",
        pathLength: 1,
      });
      this.svg.appendChild(path);
    }
  }

  private drawNodes(
    nodes: LayoutNode[],
    state: RepoState,
    animate: boolean,
    newNodeIds: Set<Hash>,
  ): void {
    for (const node of nodes) {
      newNodeIds.add(node.id);
      const { x, y } = this.px(node);
      const ghosted = this.ghost.has(node.id);
      // A ghost is a slot, not an achievement: never animate it in. A commit that
      // WAS a ghost and is now solid is the achievement, so it does animate even
      // though its id was on screen before.
      const isNew =
        animate && !ghosted && (!this.prevNodeIds.has(node.id) || this.prevGhostIds.has(node.id));
      const classes = ["cl-git-node"];
      if (isNew) classes.push("cl-git-appear");
      if (ghosted) classes.push("cl-git-ghost");
      else if (this.diverged.has(node.id)) classes.push("cl-git-diverged");
      const group = svgEl("g", {
        class: classes.join(" "),
        "data-commit": node.id,
      });
      group.appendChild(
        svgEl("circle", {
          cx: x,
          cy: y,
          r: NODE_R,
          class: "cl-git-dot",
          fill: "var(--clg-node, #fff)",
          stroke: laneVar(node.y),
          "stroke-width": 3,
        }),
      );
      const hash = svgEl("text", { x, y: y + 26, class: "cl-git-hash", "text-anchor": "middle" });
      hash.textContent = node.id;
      group.appendChild(hash);

      const commit = state.commits.get(node.id);
      const msg = svgEl("text", { x, y: y + 41, class: "cl-git-msg", "text-anchor": "middle" });
      msg.textContent = commit?.message ?? "";
      group.appendChild(msg);

      this.svg.appendChild(group);
    }
  }

  private drawChips(
    chips: { label: string; kind: "branch" | "tag" | "head"; commit: Hash }[],
    posOf: Map<Hash, { x: number; y: number }>,
    laneOf: Map<Hash, number>,
  ): void {
    this.chipLayer.replaceChildren();
    const byCommit = new Map<Hash, typeof chips>();
    for (const chip of chips) {
      const bucket = byCommit.get(chip.commit) ?? [];
      bucket.push(chip);
      byCommit.set(chip.commit, bucket);
    }

    for (const [commit, bucket] of byCommit) {
      const pos = posOf.get(commit);
      if (!pos) continue;
      const stack = document.createElement("div");
      stack.className = "cl-git-chipstack";
      stack.style.left = `${pos.x}px`;
      stack.style.top = `${pos.y - 30}px`;
      for (const chip of bucket) {
        const pill = document.createElement("button");
        pill.type = "button";
        pill.className = `cl-git-chip is-${chip.kind}`;
        // A ref that only exists once the missing commit does reads as ghosted.
        if (this.ghost.has(commit)) pill.classList.add("cl-git-ghost");
        pill.textContent = chip.label;
        if (chip.kind === "branch") {
          pill.style.background = laneChipVar(laneOf.get(commit) ?? 0);
          pill.dataset.ref = `refs/heads/${chip.label}`;
        } else {
          pill.dataset.ref = `refs/tags/${chip.label}`;
        }
        stack.appendChild(pill);
      }
      this.chipLayer.appendChild(stack);
    }
  }

  private placeHead(
    head: { commit: Hash; on?: string } | undefined,
    posOf: Map<Hash, { x: number; y: number }>,
    animate: boolean,
  ): void {
    if (!head) {
      this.headEl.hidden = true;
      return;
    }
    const pos = posOf.get(head.commit);
    if (!pos) {
      this.headEl.hidden = true;
      return;
    }
    // On an un-animated update, suppress the glide so the pill snaps into place.
    if (!animate) {
      this.headEl.style.transition = "none";
    }
    this.headEl.hidden = false;
    this.headEl.dataset.ref = "HEAD";
    this.headEl.dataset.on = head.on ?? "";
    // Say what HEAD POINTS AT, not just that it exists. Real git writes
    // `(HEAD -> main)` in `git log`, so the learner meets the same notation
    // here; detached is the case worth naming loudest, because it is the one
    // that surprises people.
    this.headEl.textContent = head.on ? `HEAD \u2192 ${head.on}` : "HEAD detached";
    this.headEl.title = head.on ? `HEAD -> ${head.on}` : "HEAD (detached)";
    this.headEl.classList.toggle("is-detached", head.on === undefined);
    this.headEl.classList.toggle("cl-git-ghost", this.ghost.has(head.commit));
    this.headEl.style.left = `${pos.x}px`;
    this.headEl.style.top = `${pos.y - 54}px`;
    if (!animate) {
      // Force a reflow so the "none" transition takes effect before restoring.
      void this.headEl.offsetWidth;
      this.headEl.style.transition = "";
    }
  }

  // --- working area ------------------------------------------------------

  private buildWorkArea(): HTMLElement {
    const work = document.createElement("div");
    work.className = "cl-git-work";

    const tree = this.zone("tree", "Working tree");
    const staging = this.zone("index", "Staging");
    const repo = this.zone("repo", "Repository");

    work.append(
      tree.wrap,
      this.arrow("git add"),
      staging.wrap,
      this.arrow("git commit"),
      repo.wrap,
    );

    this.zoneBodies = { tree: tree.body, index: staging.body, repo: repo.body };
    return work;
  }

  private zone(kind: Zone, title: string): { wrap: HTMLElement; body: HTMLElement } {
    const wrap = document.createElement("div");
    wrap.className = `cl-git-zone is-${kind}`;
    const head = document.createElement("h3");
    head.textContent = title;
    const body = document.createElement("div");
    body.className = "cl-git-zone-body";
    wrap.append(head, body);
    return { wrap, body };
  }

  private arrow(label: string): HTMLElement {
    const arrow = document.createElement("div");
    arrow.className = "cl-git-arrow";
    const kbd = document.createElement("span");
    kbd.className = "cl-git-kbd";
    kbd.textContent = label;
    arrow.append(kbd, document.createTextNode("\u2192"));
    return arrow;
  }

  private renderZones(state: RepoState, animate: boolean): void {
    const tree = [...state.worktree.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([path, entry]) => ({ path, status: entry.status }));
    const staged = [...state.index.keys()].sort();
    const committed = this.reachablePaths(state);
    for (const f of tree) committed.delete(f.path);
    for (const p of staged) committed.delete(p);
    const repo = [...committed].sort();

    const nextZoneOf = new Map<string, Zone>();
    this.fillZone("tree", tree, nextZoneOf, animate);
    this.fillZone("index", staged.map((path) => ({ path })), nextZoneOf, animate);
    this.fillZone("repo", repo.map((path) => ({ path })), nextZoneOf, animate);
    this.prevZoneOf = nextZoneOf;
  }

  private fillZone(
    zone: Zone,
    files: Array<{ path: string; status?: WorktreeStatus }>,
    nextZoneOf: Map<string, Zone>,
    animate: boolean,
  ): void {
    const body = this.zoneBodies[zone];
    body.replaceChildren();
    for (const { path, status } of files) {
      nextZoneOf.set(path, zone);
      const moved = animate && this.prevZoneOf.get(path) !== zone;
      const row = document.createElement("div");
      row.className = "cl-git-file";
      // In the working tree the two states must read apart: untracked is drawn
      // as an outline (git is not watching it yet), modified as a normal chip.
      if (status) row.classList.add(`is-${status}`);
      if (moved) row.classList.add("is-moved");
      const dot = document.createElement("span");
      dot.className = "cl-git-fdot";
      const name = document.createElement("span");
      name.className = "cl-git-fname";
      name.textContent = path;
      row.append(dot, name);
      body.appendChild(row);
    }
  }

  /** Union of `paths` over every commit reachable from HEAD (empty when unborn). */
  private reachablePaths(state: RepoState): Set<string> {
    const start = headCommit(state);
    const paths = new Set<string>();
    if (start === null) return paths;
    const seen = new Set<Hash>();
    const stack = [start];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const commit = state.commits.get(id);
      if (!commit) continue;
      for (const p of commit.paths) paths.add(p);
      for (const parent of commit.parents) stack.push(parent);
    }
    return paths;
  }
}
