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
  MODE_DIR,
  MODE_FILE,
  ObjectStore,
  type CommitFields,
  type ObjectId,
  type StoredObject,
  type TreeEntry,
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
  /** `full` draws everything `git init` really creates - config, description,
   *  hooks, info - not just the parts a lesson is about. Worth it exactly once,
   *  in the lesson that opens the folder: a learner who looks inside a real
   *  `.git` should not find things nobody warned them about. Defaults to `core`. */
  detail?: "core" | "full";
  /** Open the newest object of this type and show the EXACT bytes git stores for
   *  it. A commit's five lines are the content of the lesson about commits, and
   *  paraphrasing them in narration would be describing the thing instead of
   *  showing it. */
  open?: "blob" | "tree" | "commit";
  /** Show the EXACT bytes git hashes - the `blob 12\0` header included -
   *  rather than just the payload. The header is invisible in normal git
   *  output, so a lesson about it has no other way to put it on screen. */
  openRaw?: boolean;
  /** A short caption under the picture. */
  note?: string;
  /** Fixed so ids are deterministic - a lesson can quote one in its prose. */
  author?: string;
}

export interface ResolvedObjectsScene {
  lens: ObjectLens;
  acts: ObjectAct[];
  fresh: ObjectAct[];
  detail: "core" | "full";
  open?: "blob" | "tree" | "commit";
  /** Show the EXACT bytes git hashes - the `blob 12\0` header included -
   *  rather than just the payload. The header is invisible in normal git
   *  output, so a lesson about it has no other way to put it on screen. */
  openRaw?: boolean;
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
  const OPENABLE = ["blob", "tree", "commit"] as const;
  return {
    lens: scene.lens === "chain" || scene.lens === "both" ? scene.lens : "folder",
    acts,
    fresh: want === 0 ? [] : acts.slice(acts.length - want),
    detail: scene.detail === "full" ? "full" : "core",
    open: OPENABLE.includes(scene.open as never) ? scene.open : undefined,
    openRaw: scene.openRaw === true,
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
        latestTree = writeNested(store, stored);
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
   *  drawn next: with two commits on screen that guess is simply wrong.
   *
   *  Each carries the ROLE git gives it in the object (`tree`, `parent`). Two
   *  bare ids side by side are indistinguishable, and a reader should not have
   *  to search the page to find out which is the parent commit. */
  names: { role: string; id: ObjectId }[];
  /** How far this row sits under the commit that reaches it - 0 for a commit or
   *  a ref, 1 for its tree, 2 for what that tree holds. Indentation is the only
   *  hint that says "this belongs to the row above" without drawing lines. */
  depth: number;
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
  const seen = new Set<ObjectId>();
  const push = (kind: ChainRow["kind"], label: string, id: ObjectId, depth: number, body?: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const object = store.objects.get(id);
    // What this object names, straight from the object, each with git's own word
    // for the role. A tree's entries are already spelled out in its body.
    const names = object?.commit
      ? [
          { role: "tree", id: object.commit.tree },
          ...object.commit.parents.map((p) => ({ role: "parent", id: p })),
        ]
      : [];
    rows.push({
      kind, label, id, body, depth,
      names: names.filter((n) => !body?.includes(short(n.id))),
      fresh: added.has(id),
      unreachable: !live.has(id),
    });
  };

  const head = store.headId();
  if (head) {
    for (const [name, id] of store.refs) {
      rows.push({
        kind: "ref", label: name.replace(/^refs\/heads\//, ""), id,
        names: [], depth: 0, fresh: false, unreachable: false,
      });
    }
  }

  // An entry may be another tree - a subdirectory - so this recurses rather
  // than assuming a flat list.
  const walkTree = (id: ObjectId | null, depth: number): void => {
    const node = id ? store.objects.get(id) : undefined;
    if (!node?.entries) return;
    push("tree", "tree", id!, depth, treeBodyText(node.entries));
    for (const entry of node.entries) {
      if (store.objects.get(entry.id)?.entries) walkTree(entry.id, depth + 1);
      else push("blob", "blob", entry.id, depth + 1, store.objects.get(entry.id)?.text);
    }
  };

  // Each commit is followed IMMEDIATELY by the tree it names and what that tree
  // holds. Listing every commit first and then the newest tree left the older
  // commit's tree stranded at the bottom, past blobs belonging to another save.
  let walk: ObjectId | null | undefined = head;
  let sawCommit = false;
  let guard = 0;
  while (walk && store.objects.get(walk)?.commit && guard++ < 64) {
    const commit: CommitFields = store.objects.get(walk)!.commit!;
    sawCommit = true;
    push("commit", "commit", walk, 0, commit.message);
    walkTree(commit.tree, 1);
    walk = commit.parents[0];
  }
  if (!sawCommit) walkTree(lastTreeOf(store), 0);

  for (const [id, object] of store.objects) {
    if (seen.has(id)) continue;
    // The label stays the bare type word. "unnamed" is chrome the view adds from
    // its labels, because that word translates and `blob` does not.
    push(object.type, object.type, id, 0,
      object.entries ? treeBodyText(object.entries) : object.text || object.commit?.message);
  }
  return rows;
}

/** Git writes ONE tree object per directory, so a stored path containing a
 *  slash means a subtree. Built deepest-first, because a parent's row carries
 *  the child's id and that id does not exist until the child is written. */
function writeNested(store: ObjectStore, stored: Map<string, ObjectId>): ObjectId {
  const build = (prefix: string): ObjectId => {
    const entries: TreeEntry[] = [];
    const dirs = new Set<string>();
    for (const [path, id] of stored) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash < 0) entries.push({ mode: MODE_FILE, name: rest, id });
      else dirs.add(rest.slice(0, slash));
    }
    for (const dir of dirs) {
      entries.push({ mode: MODE_DIR, name: dir, id: build(`${prefix}${dir}/`) });
    }
    return store.writeTree(entries);
  };
  return build("");
}

function treeBodyText(entries: TreeEntry[]): string {
  return entries
    .map((entry) => `${entry.mode.padStart(6, "0")} ${entry.name} -> ${short(entry.id)}`)
    .join("   ");
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

/** The newest object of a type, with the exact bytes git stores for it decoded
 *  back to text. Binary tree entries are unreadable as text, so a tree is shown
 *  the way `git cat-file -p` shows it - the only rendering in this scene, and
 *  the lesson says so. */
export function openObject(
  replay: Replay,
  type: "blob" | "tree" | "commit",
  raw = false,
): { id: ObjectId; type: string; text: string; header?: string } | null {
  // The LAST match is the newest - the store inserts in write order.
  let found: StoredObject | null = null;
  for (const object of replay.store.objects.values()) {
    if (object.type === type) found = object;
  }
  if (!found) return null;
  // `raw` exposes the stored header as its own field so a view can give it its
  // own line. It is a no-op for a TREE: a tree's entry ids are twenty binary
  // bytes, and the only way to "show" them as text is to invent a rendering,
  // which would be a picture of bytes rather than the bytes. A tree is always
  // shown the way `git cat-file -p` prints it, and says so.
  const header = raw && !found.entries ? `${type} ${found.body.length}\\0` : undefined;
  if (found.entries) {
    const kindOf = (id: ObjectId) =>
      replay.store.objects.get(id)?.entries ? "tree" : "blob";
    return {
      id: found.id,
      type,
      text: found.entries
        .map((e) => `${e.mode.padStart(6, "0")} ${kindOf(e.id)} ${e.id}\t${e.name}`)
        .join("\n"),
    };
  }
  return {
    id: found.id,
    type,
    header,
    text: new TextDecoder().decode(found.body),
  };
}
