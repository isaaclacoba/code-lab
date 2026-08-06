// test/git-objects.test.ts - the object store, checked against REAL git.
//
// WHY THIS EXISTS
// The Inside-git track tells a learner that an object's name is made from its
// content, and invites them to check it with `git hash-object` on their own
// machine. If these ids drift from git's by one byte, every lesson in the track
// is telling a lie that the learner can catch.
//
// The fixture is not hand-written. `poc-git-vectors.sh` generates it by running
// real git (2.34.1) in a scratch repository with fixed author, committer, dates
// and timezone, then re-inflates each loose object and checks git's own id
// against a sha1sum of the inflated bytes. Regenerate it there, never here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  MODE_DIR,
  MODE_EXEC,
  MODE_FILE,
  ObjectStore,
  bytesOf,
  sha1,
  treeSortKey,
} from "../src/core/git-objects.js";

interface Vector {
  type: string;
  label: string;
  preimageEscaped: string;
  preimageHexIfBinary: string | null;
  sha: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const vectors: Vector[] = JSON.parse(
  readFileSync(join(here, "fixtures-git-objects.json"), "utf8"),
);

/** The fixture spells its escapes out, so `\0` in the JSON is a backslash and a
 *  zero rather than a NUL byte. */
function unescape(text: string): string {
  return text.replace(/\\x([0-9a-fA-F]{2})|\\0|\\n|\\\\/g, (match, hex) => {
    if (hex) return String.fromCharCode(parseInt(hex, 16));
    if (match === "\\0") return "\0";
    if (match === "\\n") return "\n";
    return "\\";
  });
}

test("every preimage real git hashed produces the id real git produced", () => {
  assert.ok(vectors.length >= 10, "the fixture should carry all ten vectors");
  for (const vector of vectors) {
    const bytes = vector.preimageHexIfBinary
      ? Uint8Array.from(Buffer.from(vector.preimageHexIfBinary, "hex"))
      : bytesOf(unescape(vector.preimageEscaped));
    assert.equal(sha1(bytes), vector.sha, vector.label);
  }
});

test("writeBlob matches git hash-object, including the empty and non-ASCII cases", () => {
  const store = new ObjectStore();
  assert.equal(store.writeBlob("hello world\n"), "3b18e512dba79e4c8300dd08aeb37f8e728b8dad");
  assert.equal(store.writeBlob(""), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  // Four characters, six bytes. The header says 6, and `string.length` would say 5.
  assert.equal(store.writeBlob("caf\u00e9\n"), "572eb43fe8e34fb87d01c69e01151ff696022924");
});

test("the same content written twice is one object", () => {
  const store = new ObjectStore();
  const first = store.writeBlob("hello world\n");
  const second = store.writeBlob("hello world\n");
  assert.equal(first, second);
  assert.equal(store.objects.size, 1);
});

test("writeTree sorts its own entries and matches git write-tree", () => {
  const store = new ObjectStore();
  const alpha = store.writeBlob("alpha\n");
  const beta = store.writeBlob("beta\n");
  // Deliberately out of order, and b.txt executable, exactly as the fixture did.
  const flat = store.writeTree([
    { mode: MODE_EXEC, name: "b.txt", id: beta },
    { mode: MODE_FILE, name: "a.txt", id: alpha },
  ]);
  assert.equal(flat, "d067e4f1a1b6abf1dd6fe234d7f95088f6e56c7d");

  const sub = store.writeTree([{ mode: MODE_FILE, name: "deep.txt", id: store.writeBlob("nested\n") }]);
  assert.equal(
    store.writeTree([
      { mode: MODE_DIR, name: "sub", id: sub },
      { mode: MODE_FILE, name: "a.txt", id: alpha },
    ]),
    "b52941b9490611b6593612f8f510903234393914",
  );
});

test("a directory sorts as if its name ended in a slash", () => {
  const store = new ObjectStore();
  const alpha = store.writeBlob("alpha\n");
  const zero = store.writeBlob("zero\n");
  const dir = store.writeTree([{ mode: MODE_FILE, name: "f.txt", id: store.writeBlob("in-dir\n") }]);

  // a.txt before directory a - "." is 0x2e, "/" is 0x2f.
  assert.equal(
    store.writeTree([
      { mode: MODE_DIR, name: "a", id: dir },
      { mode: MODE_FILE, name: "a.txt", id: alpha },
    ]),
    "9a2cfd6eb22be2c895d0a4757532a9d5b878920e",
  );
  // Directory a before a0.txt - "/" is 0x2f, "0" is 0x30.
  assert.equal(
    store.writeTree([
      { mode: MODE_FILE, name: "a0.txt", id: zero },
      { mode: MODE_DIR, name: "a", id: dir },
    ]),
    "7b7f8ede6de95c4be1ef591bd58e29c7d8fd9c3d",
  );
  // Sorting the bare names would put "a" first in the first case. Guard the rule
  // itself, so a refactor that drops the slash fails here and not in a lesson.
  assert.deepEqual(
    Array.from(treeSortKey({ mode: MODE_DIR, name: "a", id: dir })),
    Array.from(bytesOf("a/")),
  );
});

test("writeCommit matches git commit-tree, with and without a parent", () => {
  const store = new ObjectStore();
  const alpha = store.writeBlob("alpha\n");
  const beta = store.writeBlob("beta\n");
  const flat = store.writeTree([
    { mode: MODE_FILE, name: "a.txt", id: alpha },
    { mode: MODE_EXEC, name: "b.txt", id: beta },
  ]);
  const nested = store.writeTree([
    { mode: MODE_FILE, name: "a.txt", id: alpha },
    { mode: MODE_DIR, name: "sub", id: store.writeTree([
      { mode: MODE_FILE, name: "deep.txt", id: store.writeBlob("nested\n") },
    ]) },
  ]);
  const person = "Vector Author <vectors@example.com>";

  const root = store.writeCommit({
    tree: flat, parents: [], author: `${person} 1700000000 +0000`, message: "first save",
  });
  assert.equal(root, "3655757fbb278168f9da9caf06cc5ba1e854f8b9");
  assert.equal(
    store.writeCommit({
      tree: nested, parents: [root],
      author: `${person} 1700003600 +0100`, message: "second save",
    }),
    "aac6f24bdbd26c7b16c02d7780ceb967844fe15f",
  );
});

test("reachable follows names; what it misses is still stored", () => {
  const store = new ObjectStore();
  const tree = store.writeTree([{ mode: MODE_FILE, name: "a.txt", id: store.writeBlob("alpha\n") }]);
  const author = "A <a@example.com> 1700000000 +0000";
  const kept = store.writeCommit({ tree, parents: [], author, message: "kept" });
  store.refs.set("refs/heads/main", kept);
  const abandoned = store.writeCommit({ tree, parents: [kept], author, message: "abandoned" });

  const live = store.reachable();
  assert.ok(live.has(kept));
  assert.ok(live.has(tree), "a commit's tree is reachable through it");
  assert.ok(!live.has(abandoned), "nothing names the abandoned commit");
  assert.ok(store.objects.has(abandoned), "unreachable is not the same as gone");
});

test("a detached HEAD keeps its own object reachable", () => {
  const store = new ObjectStore();
  const tree = store.writeTree([{ mode: MODE_FILE, name: "a.txt", id: store.writeBlob("alpha\n") }]);
  const only = store.writeCommit({
    tree, parents: [], author: "A <a@example.com> 1700000000 +0000", message: "only",
  });
  store.head = { kind: "detached", id: only };
  assert.ok(store.reachable().has(only));
});
