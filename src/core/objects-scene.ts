// The data behind the `objects` scene: a git object store as a stepped explainer.
//
// WHY THIS EXISTS
// The Inside-git track explains what a repository is MADE OF, and it does it with
// no commands anywhere - that is what keeps it from being the practical track
// with a cutaway view. So a step describes ACTS in plain words ("store this
// file's content", "save", "point this name at that save"), never `git commit`.
//
// WHY A STEP HOLDS ACTS AND NOT A STORE
// Same reason the `repo` scene holds commands: the stepper deep-clones every
// step, and a store is mostly Maps, which a structural clone flattens. Acts stay
// plain JSON, so they clone, localize and validate like every other scene, and a
// lesson file needs nothing loaded before it.
import {
  MODE_FILE,
  ObjectStore,
  type CommitFields,
  type ObjectId,
} from "./git-objects.js";

/** Which picture this step draws. `folder` is the files on disk, `chain` is who
 *  names whom, `both` is the same state drawn twice so a learner can see they
 *  are one thing. */
export type ObjectLens = "folder" | "chain" | "both";

/** One thing that happens, in the words the track uses.
 *
 *  `write` puts text in the folder. `store` turns that text into an object.
 *  Keeping them apart IS the teaching: a file in the folder is not yet a thing
 *  git holds. */
export type ObjectAct =
  | { act: "write"; path: string; text: string }
  | { act: "store"; path: string }
  | { act: "pick"; path: string }
  | { act: "list" }
  | { act: "save"; message: string }
  | { act: "name"; ref: string; at?: string };

/** One step of an Inside-git explainer. */
export interface ObjectsScene {
  /** Which lens to draw. Defaults to `folder`. */
  lens?: ObjectLens;
  /** Everything that has happened up to and including this step, replayed from
   *  an empty repository so the step is self-contained. */
  acts: ObjectAct[];
  /** How many trailing acts are NEW at this step. Objects those acts create are
   *  highlighted. Defaults to 1; use 0 for a step that only re-explains. */
  fresh?: number;
  /** A short caption under the picture. */
  note?: string;
  /** Fixed so ids are deterministic - a lesson can quote one in its prose. */
  author?: string;
}

export interface ResolvedObjectsScene {
  lens: ObjectLens;
  acts: ObjectAct[];
  fresh: ObjectAct[];
  note?: string;
  author: string;
}

export const DEFAULT_AUTHOR = "A Learner <learner@example.com> 1700000000 +0000";

/** Normalise a raw scene for rendering. A step with no acts is an authoring
 *  slip; returning null costs one blank panel the author will see, where a throw
 *  would take down a lesson for a learner who did nothing wrong. */
export function resolveObjects(scene: ObjectsScene | undefined): ResolvedObjectsScene | null {
  if (!scene || !Array.isArray(scene.acts)) return null;
  const acts = scene.acts.slice();
  const want = scene.fresh === undefined ? 1 : Math.max(0, Math.min(scene.fresh, acts.length));
  return {
    lens: scene.lens === "chain" || scene.lens === "both" ? scene.lens : "folder",
    acts,
    fresh: want === 0 ? [] : acts.slice(acts.length - want),
    note: scene.note,
    author: scene.author || DEFAULT_AUTHOR,
  };
}

/** What a replay produced: the store, plus which objects the step's NEW acts
 *  created, so the view can mark them without diffing two stores. */
export interface Replay {
  store: ObjectStore;
  added: Set<ObjectId>;
}

/** Run the acts into an empty repository.
 *
 *  An act that cannot apply - storing a path the folder does not hold, saving
 *  before anything is listed - is skipped rather than thrown, for the same
 *  reason `resolveObjects` returns null: an authoring mistake should be visible
 *  on screen, not fatal to a learner mid-lesson. */
export function replayObjects(scene: ResolvedObjectsScene): Replay {
  const store = new ObjectStore();
  const added = new Set<ObjectId>();
  const freshFrom = scene.acts.length - scene.fresh.length;
  // Blob per path, in insertion order, so `list` builds the tree in a stable
  // order and the tree id is deterministic.
  const stored = new Map<string, ObjectId>();
  const savedByMessage = new Map<string, ObjectId>();
  let latestTree: ObjectId | null = null;
  let latestCommit: ObjectId | null = null;

  scene.acts.forEach((act, at) => {
    const before = new Set(store.objects.keys());
    switch (act.act) {
      case "write":
        store.worktree.set(act.path, act.text);
        break;
      case "store": {
        const text = store.worktree.get(act.path);
        if (text === undefined) break;
        stored.set(act.path, store.writeBlob(text));
        break;
      }
      case "pick": {
        const id = stored.get(act.path);
        if (id) store.index.set(act.path, id);
        break;
      }
      case "list": {
        if (!stored.size) break;
        latestTree = store.writeTree(
          [...stored].map(([name, id]) => ({ mode: MODE_FILE, name, id })),
        );
        break;
      }
      case "save": {
        if (!latestTree) break;
        latestCommit = store.writeCommit({
          tree: latestTree,
          parents: latestCommit ? [latestCommit] : [],
          author: scene.author,
          message: act.message,
        });
        savedByMessage.set(act.message, latestCommit);
        break;
      }
      case "name": {
        const target = act.at ? savedByMessage.get(act.at) : latestCommit;
        if (target) store.refs.set(act.ref, target);
        break;
      }
    }
    if (at >= freshFrom) {
      for (const id of store.objects.keys()) if (!before.has(id)) added.add(id);
    }
  });

  return { store, added };
}

/** One row of the `chain` lens: an object, and the id of the object it names.
 *
 *  The rail is a flat list rather than a tree because the visual panel is 562px
 *  wide - a nested drawing would also say a commit CONTAINS its parent, which is
 *  the one thing it does not do. */
export interface ChainRow {
  kind: "ref" | ObjectRowKind;
  /** What the row is called on screen: "commit", "tree", "blob", or a ref name. */
  label: string;
  id: ObjectId;
  /** The object's own content, one short line. */
  body?: string;
  /** The ids this row names, taken from the OBJECT - a commit names its tree and
   *  its parents, a blob names nothing. Never inferred from what happens to be
   *  drawn next: with two commits on screen that guess is simply wrong. Ids
   *  already visible in `body` are left out rather than repeated. */
  names: ObjectId[];
  fresh: boolean;
  /** True when no name reaches this object. */
  unreachable: boolean;
}

type ObjectRowKind = "blob" | "tree" | "commit";

/** Walk the store the way the store itself does - names first, then what they
 *  reach - and finish with everything no name reaches. */
export function chainRows(replay: Replay): ChainRow[] {
  const { store, added } = replay;
  const live = store.reachable();
  const rows: ChainRow[] = [];
  const push = (kind: ChainRow["kind"], label: string, id: ObjectId, body?: string) => {
    const object = store.objects.get(id);
    // What this object names, straight from the object. A tree's entries are
    // already spelled out in its body, so they would only be repeated.
    const names = object?.commit ? [object.commit.tree, ...object.commit.parents] : [];
    rows.push({
      kind, label, id, body,
      names: names.filter((named) => !body?.includes(short(named))),
      fresh: added.has(id),
      unreachable: !live.has(id),
    });
  };

  const head = store.headId();
  if (head) {
    for (const [name, id] of store.refs) {
      rows.push({
        kind: "ref", label: name.replace(/^refs\/heads\//, ""), id,
        names: [], fresh: false, unreachable: false,
      });
    }
  }

  let walk: ObjectId | null | undefined = head;
  let top: ObjectId | null = null;
  let guard = 0;
  while (walk && store.objects.get(walk)?.commit && guard++ < 64) {
    const commit: CommitFields = store.objects.get(walk)!.commit!;
    if (!top) top = walk;
    push("commit", "commit", walk, commit.message);
    walk = commit.parents[0];
  }

  const treeId = top ? store.objects.get(top)!.commit!.tree : lastTreeOf(store);
  const tree = treeId ? store.objects.get(treeId) : undefined;
  if (tree?.entries) {
    push("tree", "tree", treeId!, treeBodyText(tree.entries));
    for (const entry of tree.entries) {
      push("blob", "blob", entry.id, store.objects.get(entry.id)?.text);
    }
  }

  for (const [id, object] of store.objects) {
    if (rows.some((row) => row.id === id)) continue;
    push(object.type, `${object.type} (unnamed)`, id,
      object.entries ? treeBodyText(object.entries) : object.text || object.commit?.message);
  }
  return rows;
}

function treeBodyText(entries: { name: string; id: ObjectId }[]): string {
  return entries.map((entry) => `${entry.name} -> ${short(entry.id)}`).join(", ");
}

/** With nothing committed yet there is still a picture worth drawing: the most
 *  recent tree, or the blobs on their own. */
function lastTreeOf(store: ObjectStore): ObjectId | null {
  let found: ObjectId | null = null;
  for (const [id, object] of store.objects) if (object.entries) found = id;
  return found;
}

export function short(id: ObjectId): string {
  return id.slice(0, 7);
}
