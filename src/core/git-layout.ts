// DOM-free layout for the git commit-DAG. Pure math over a `RepoState`: it turns
// the model into a grid of {nodes, edges, chips} that the GitGraph view paints
// verbatim. There is no rendering here - only integer time/lane coordinates on a
// unitless grid, which the view scales to pixels. Contract 3 of the git track:
// `layout(state) -> { nodes, edges, chips }`; the view only paints.
//
// The grid is HORIZONTAL (Learn-Git-Branching style):
//   x (time) = creation order, oldest at the left (x=0), newest on the right.
//   y (lane) = branch row, so concurrent branches occupy different rows; the
//              first/main line is the top row (y=0), extra branches stack below.

import type { RepoState, Hash } from "./git-model.ts";

/** One commit placed on the grid. `x` is its time index (column), `y` its lane
 *  (branch row). */
export interface LayoutNode {
  id: Hash;
  x: number;
  y: number;
}

/** A parent link, drawn child -> parent (`from` is the newer commit). */
export interface LayoutEdge {
  from: Hash;
  to: Hash;
}

/** A ref/HEAD label anchored to a commit. `on` is set only for an attached
 *  HEAD (the short name of the branch it rides). */
export interface LayoutChip {
  label: string;
  kind: "branch" | "tag" | "head";
  commit: Hash;
  on?: string;
}

/** The whole grid: placed nodes, parent edges, ref/HEAD chips, and the grid's
 *  extent (`width` commits across time x `height` branch rows). */
export interface GraphLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  chips: LayoutChip[];
  width: number;
  height: number;
}

/** The commit HEAD resolves to, or null when the branch is unborn. */
function headCommit(state: RepoState): Hash | null {
  if (state.head.kind === "detached") return state.head.commit;
  return state.refs.get(state.head.name) ?? null;
}

/** The short name of an attached HEAD's branch, or undefined when detached. */
function headBranchShort(state: RepoState): string | undefined {
  if (state.head.kind !== "branch") return undefined;
  return state.head.name.replace(/^refs\/heads\//, "");
}

/**
 * Lay a `RepoState` out on an integer grid, horizontally.
 *
 * Time (x): the `commits` Map is in creation order and a parent is always
 * created before its child, so that order is already topological. We use the
 * oldest-first creation index as `x` - oldest at x=0, newest at the largest x.
 * This guarantees the topology invariant (every parent has a strictly smaller x
 * than each of its children) for free.
 *
 * Lane (y): a single greedy sweep over the newest-first order (the reverse of
 * creation). We keep a `lanes` array where `lanes[i]` is the commit that lane
 * `i` is currently waiting to draw next; the assigned lane becomes the node's
 * `y` (branch row). For each commit c:
 *   1. It is drawn in the lowest lane already reserved for it (a child reserved
 *      its first-parent's lane on the way down); other lanes reserved for the
 *      same commit are freed - those lines converge here.
 *   2. If no lane was reserved (c is a tip with no child yet), it takes the
 *      lowest free lane.
 *   3. Its first parent continues down c's lane; if that parent is already
 *      reserved elsewhere the two lanes merge into the lower one.
 *   4. Each extra parent (a merge's 2nd+ parent) reserves a fresh lowest-free
 *      lane, so a merged-in line gets its own row.
 *   5. A commit with no parents ends its line, freeing the lane for reuse.
 * This is legible for the small DAGs the course draws, not lane-optimal.
 *
 * The result is pure: `state` is read only, nothing is mutated.
 */
export function layout(state: RepoState): GraphLayout {
  // Oldest-first creation order gives the time index (x): oldest at x=0.
  const oldestFirst = [...state.commits.keys()];
  const xOf = new Map<Hash, number>();
  oldestFirst.forEach((id, i) => xOf.set(id, i));

  // Newest-first order drives the greedy lane sweep: reverse of creation order.
  const newestFirst = [...oldestFirst].reverse();

  // Greedy lane sweep. lanes[i] = the commit lane i is next expecting, or null.
  const lanes: (Hash | null)[] = [];
  const yOf = new Map<Hash, number>();
  let maxLane = -1;

  const firstFree = (): number => {
    const free = lanes.indexOf(null);
    return free === -1 ? lanes.length : free;
  };

  for (const id of newestFirst) {
    const commit = state.commits.get(id)!;

    // 1-2. Find (or allocate) this commit's lane.
    const reserved: number[] = [];
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === id) reserved.push(i);
    }
    let lane: number;
    if (reserved.length === 0) {
      lane = firstFree();
    } else {
      lane = reserved[0];
      // Converging lines: free the duplicate reservations, keep the lowest.
      for (let k = 1; k < reserved.length; k++) lanes[reserved[k]] = null;
    }
    yOf.set(id, lane);
    if (lane > maxLane) maxLane = lane;

    const parents = commit.parents;
    if (parents.length === 0) {
      // 5. Line ends here; free the lane.
      lanes[lane] = null;
    } else {
      // 3. First parent continues down this lane, merging if already reserved.
      const fp = parents[0];
      const existing = lanes.indexOf(fp);
      if (existing === -1) {
        lanes[lane] = fp;
      } else {
        const keep = Math.min(existing, lane);
        const drop = Math.max(existing, lane);
        lanes[keep] = fp;
        if (drop !== keep) lanes[drop] = null;
      }
      // 4. Extra parents each reserve a fresh lane (unless already reserved).
      for (let k = 1; k < parents.length; k++) {
        const p = parents[k];
        if (!lanes.includes(p)) lanes[firstFree()] = p;
      }
    }
  }

  const nodes: LayoutNode[] = oldestFirst.map((id) => ({
    id,
    x: xOf.get(id)!,
    y: yOf.get(id)!,
  }));

  // One edge per parent link, child -> parent, in node then parent order.
  const edges: LayoutEdge[] = [];
  for (const id of newestFirst) {
    for (const parent of state.commits.get(id)!.parents) {
      edges.push({ from: id, to: parent });
    }
  }

  // One chip per ref (branches + tags), in refs Map order.
  const chips: LayoutChip[] = [];
  for (const [refName, commitId] of state.refs) {
    if (refName.startsWith("refs/heads/")) {
      chips.push({
        label: refName.slice("refs/heads/".length),
        kind: "branch",
        commit: commitId,
      });
    } else if (refName.startsWith("refs/tags/")) {
      chips.push({
        label: refName.slice("refs/tags/".length),
        kind: "tag",
        commit: commitId,
      });
    }
  }

  // The HEAD chip, unless HEAD is unborn (no commit to anchor it to).
  const head = headCommit(state);
  if (head !== null) {
    const on = headBranchShort(state);
    const chip: LayoutChip = { label: "HEAD", kind: "head", commit: head };
    if (on !== undefined) chip.on = on;
    chips.push(chip);
  }

  return {
    nodes,
    edges,
    chips,
    width: oldestFirst.length,
    height: maxLane + 1,
  };
}
