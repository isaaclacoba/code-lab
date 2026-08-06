// A real git object store, small enough for a learner to read.
//
// WHY THE IDS ARE REAL
// The Inside-git track's whole claim is that an object's name is made from its
// content. A learner can only believe that if they can check it, so every id here
// is the id real git prints for the same bytes - `git hash-object --stdin` on
// "hello world\n" gives 3b18e512dba79e4c8300dd08aeb37f8e728b8dad, and so does
// this. The test file asserts that against vectors generated from real git.
//
// WHY SHA-1 IS WRITTEN OUT
// `crypto.subtle` is unavailable outside a secure context - a LAN address during
// local development is enough to lose it - and it is async, which would put a
// promise inside every render. This is ~40 lines and synchronous.
//
// THE THREE TRAPS, all of which produce a plausible but WRONG id:
//   1. The header length is in BYTES, not characters: `café\n` is `blob 6`.
//   2. A tree entry carries its id as 20 RAW bytes; a commit carries the same id
//      as 40 hex characters. One serialiser cannot do both.
//   3. Tree entries sort as if every directory name ended in `/`, and the mode
//      written into the object is `40000` - `git cat-file -p` prints `040000`.

/** An object id: 40 lowercase hex characters, exactly as git writes it. */
export type ObjectId = string;

export type ObjectType = "blob" | "tree" | "commit";

/** One entry of a tree: a name, how the file sits, and the object it names. */
export interface TreeEntry {
  mode: string;
  name: string;
  id: ObjectId;
}

/** What a commit records. Ids here are hex, unlike inside a tree. */
export interface CommitFields {
  tree: ObjectId;
  parents: ObjectId[];
  /** "Name <email> <epoch> <+HHMM>", the format git itself writes. */
  author: string;
  committer?: string;
  message: string;
}

/** One stored object. `text`, `entries` and `commit` are the decoded view of
 *  `body` - kept so a view can render an object without re-parsing bytes. */
export interface StoredObject {
  id: ObjectId;
  type: ObjectType;
  body: Uint8Array;
  text?: string;
  entries?: TreeEntry[];
  commit?: CommitFields;
}

/** Where HEAD points: at a ref by name, or straight at an object. */
export type HeadState = { kind: "ref"; ref: string } | { kind: "detached"; id: ObjectId };

export const MODE_FILE = "100644";
export const MODE_EXEC = "100755";
/** Five characters. `git cat-file -p` prints `040000`; the object holds `40000`. */
export const MODE_DIR = "40000";

const encoder = new TextEncoder();

/** Text to bytes. Everything downstream works in bytes, because the object
 *  header counts bytes and `string.length` counts characters. */
export function bytesOf(text: string): Uint8Array {
  return encoder.encode(text);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/** SHA-1 of a byte array, as 40 lowercase hex characters. */
export function sha1(bytes: Uint8Array): string {
  const length = bytes.length;
  const padded = new Uint8Array((((length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, (length << 3) >>> 0, false);
  view.setUint32(padded.length - 8, Math.floor(length / 536870912), false);

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Int32Array(80);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(offset + i * 4, false);
    for (let i = 16; i < 80; i++) {
      const mixed = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (mixed << 1) | (mixed >>> 31);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const next = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = next;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  return [h0, h1, h2, h3, h4].map((n) => (n >>> 0).toString(16).padStart(8, "0")).join("");
}

/** The bytes git hashes: `<type> <byte length>\0` then the body. The header is
 *  inside the hash; the zlib compression git applies afterwards is not, which is
 *  why this store needs no compression at all. */
export function objectBytes(type: ObjectType, body: Uint8Array): Uint8Array {
  return concat([bytesOf(`${type} ${body.length}\0`), body]);
}

export function hashObject(type: ObjectType, body: Uint8Array): ObjectId {
  return sha1(objectBytes(type, body));
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return left.length - right.length;
}

/** Git sorts tree entries as if every directory name ended in `/`, which is why
 *  `a.txt` comes before a directory `a` (`.` is 0x2e, `/` is 0x2f) and directory
 *  `a` comes before `a0.txt`. Sorting the bare names gets both wrong. */
export function treeSortKey(entry: TreeEntry): Uint8Array {
  return bytesOf(entry.mode === MODE_DIR ? `${entry.name}/` : entry.name);
}

export function treeBody(entries: TreeEntry[]): Uint8Array {
  const sorted = entries.slice().sort((a, b) => compareBytes(treeSortKey(a), treeSortKey(b)));
  const chunks: Uint8Array[] = [];
  for (const entry of sorted) {
    chunks.push(bytesOf(`${entry.mode} ${entry.name}\0`), hexToBytes(entry.id));
  }
  return concat(chunks);
}

/** `tree`, then every `parent` in order, then `author`, then `committer`, one
 *  blank line, then the message. Ids here are hex, unlike inside a tree. */
export function commitBody(commit: CommitFields): Uint8Array {
  const lines = [`tree ${commit.tree}\n`];
  for (const parent of commit.parents) lines.push(`parent ${parent}\n`);
  lines.push(`author ${commit.author}\n`);
  lines.push(`committer ${commit.committer || commit.author}\n`);
  lines.push("\n");
  lines.push(commit.message.endsWith("\n") ? commit.message : `${commit.message}\n`);
  return bytesOf(lines.join(""));
}

/** The whole repository: objects, the names that point at them, and the two
 *  places a file can sit before it becomes an object. Nothing is ever mutated in
 *  place except by the writes below - an object, once stored, never changes. */
export class ObjectStore {
  readonly objects = new Map<ObjectId, StoredObject>();
  /** Ref name -> object id, e.g. "refs/heads/main". A file holding one id. */
  readonly refs = new Map<string, ObjectId>();
  /** Path -> blob id. `.git/index`, the list of what you picked. */
  readonly index = new Map<string, ObjectId>();
  /** Path -> text. Your folder. Not part of git at all. */
  readonly worktree = new Map<string, string>();
  head: HeadState = { kind: "ref", ref: "refs/heads/main" };

  private put(type: ObjectType, body: Uint8Array, decoded: Partial<StoredObject>): ObjectId {
    const id = hashObject(type, body);
    // Writing the same content twice is one object. That is the point of naming
    // things after their bytes, so it must not be a special case.
    if (!this.objects.has(id)) this.objects.set(id, { id, type, body, ...decoded });
    return id;
  }

  writeBlob(text: string): ObjectId {
    return this.put("blob", bytesOf(text), { text });
  }

  writeTree(entries: TreeEntry[]): ObjectId {
    return this.put("tree", treeBody(entries), { entries: entries.slice() });
  }

  writeCommit(commit: CommitFields): ObjectId {
    return this.put("commit", commitBody(commit), { commit: { ...commit } });
  }

  headId(): ObjectId | null {
    if (this.head.kind === "detached") return this.head.id;
    return this.refs.get(this.head.ref) || null;
  }

  /** Every object reachable by following names from the refs and HEAD. What is
   *  outside this set is still on disk, byte for byte, and no name reaches it -
   *  which is the whole difference between undone and gone. */
  reachable(): Set<ObjectId> {
    const seen = new Set<ObjectId>();
    const queue: (ObjectId | undefined)[] = [...this.refs.values()];
    const head = this.headId();
    if (head) queue.push(head);
    while (queue.length) {
      const id = queue.pop();
      if (!id || seen.has(id)) continue;
      const object = this.objects.get(id);
      if (!object) continue;
      seen.add(id);
      if (object.commit) queue.push(object.commit.tree, ...object.commit.parents);
      else if (object.entries) for (const entry of object.entries) queue.push(entry.id);
    }
    return seen;
  }
}
