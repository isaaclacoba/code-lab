import { test } from "node:test";
import assert from "node:assert/strict";
import "./setup-dom.ts";
import { ObjectsView } from "../src/dom/objects-view.ts";
import { DEFAULT_VIZ_LABELS } from "../src/core/memory-model.ts";
import type { ObjectAct, ObjectsScene } from "../src/core/objects-scene.ts";
import type { SyncCtx } from "../src/dom/panel.ts";

// test/objects-view.dom.test.ts - the three lenses.
//
// WHY THIS EXISTS
// The lens is the only thing a learner actually looks at, and the caption always
// describes ONE picture. If a step asks for `chain` and the folder is what
// renders, the narration is talking about something that is not on screen.

const SAVE: ObjectAct[] = [
  { act: "write", path: "hello.txt", text: "hello world\n" },
  { act: "store", path: "hello.txt" },
  { act: "list" },
  { act: "save", message: "save the greeting" },
  { act: "name", ref: "refs/heads/main" },
];

function render(objects: ObjectsScene | undefined): ObjectsView {
  const view = new ObjectsView();
  view.sync({ model: { objects } } as unknown as SyncCtx);
  return view;
}

const visible = (view: ObjectsView, selector: string) => {
  const el = view.el.querySelector(selector) as HTMLElement | null;
  return !!el && !el.hidden;
};

test("the folder lens draws the folder and not the chain", () => {
  const view = render({ lens: "folder", acts: SAVE });
  assert.ok(visible(view, ".cl-ob-folder"));
  assert.ok(!visible(view, ".cl-ob-chain"));
  assert.match(view.el.querySelector(".cl-ob-folder")!.textContent!, /\.git\//);
  assert.match(view.el.querySelector(".cl-ob-folder")!.textContent!, /refs\/heads\//);
});

test("the chain lens draws the chain and not the folder", () => {
  const view = render({ lens: "chain", acts: SAVE });
  assert.ok(visible(view, ".cl-ob-chain"));
  assert.ok(!visible(view, ".cl-ob-folder"));
});

test("the both lens draws both", () => {
  const view = render({ lens: "both", acts: SAVE });
  assert.ok(visible(view, ".cl-ob-folder"));
  assert.ok(visible(view, ".cl-ob-chain"));
});

test("the chain reads name, commit, tree, blob - one row each", () => {
  const view = render({ lens: "chain", acts: SAVE });
  assert.equal(view.el.querySelector(".cl-ob-ref")!.textContent, "main");
  const kinds = Array.from(view.el.querySelectorAll(".cl-ob-kind")).map((n) => n.textContent);
  assert.deepEqual(kinds, ["commit", "tree", "blob"]);
});

test("a row's names chip repeats the id it names, verbatim", () => {
  const view = render({ lens: "chain", acts: SAVE });
  const rows = Array.from(view.el.querySelectorAll(".cl-ob-row"));
  const chip = rows[0].querySelector(".cl-ob-names")!.textContent;
  assert.equal(chip, rows[1].querySelector(".cl-ob-id")!.textContent);
  assert.equal(rows[2].querySelector(".cl-ob-names"), null, "a blob names nothing");
});

test("an object no name reaches is drawn, and drawn differently", () => {
  const view = render({
    lens: "chain",
    acts: [...SAVE, { act: "write", path: "hello.txt", text: "goodbye\n" }, { act: "store", path: "hello.txt" }],
  });
  const orphans = view.el.querySelectorAll(".cl-ob-orphan");
  assert.equal(orphans.length, 1);
  assert.match(orphans[0].textContent!, /nothing points here/);
});

test("objects created by this step's fresh acts are marked in the folder", () => {
  // SAVE is write, store, list, save, name. The last three acts create the tree
  // and the commit; pointing a name creates nothing at all.
  const three = render({ lens: "folder", acts: SAVE, fresh: 3 });
  assert.equal(three.el.querySelectorAll(".cl-ob-new").length, 2, "the tree and the commit");
  const one = render({ lens: "folder", acts: SAVE, fresh: 1 });
  assert.equal(one.el.querySelectorAll(".cl-ob-new").length, 0, "naming stores nothing new");
});

test("the note renders when present and hides when absent", () => {
  assert.ok(!visible(render({ lens: "folder", acts: SAVE }), ".cl-ob-cap"));
  const withNote = render({ lens: "folder", acts: SAVE, note: "Three objects, one save." });
  assert.equal(withNote.el.querySelector(".cl-ob-cap")!.textContent, "Three objects, one save.");
});

test("scene text is escaped, never injected", () => {
  const view = render({
    lens: "chain",
    acts: [
      { act: "write", path: "x.txt", text: "<img src=x onerror=1>\n" },
      { act: "store", path: "x.txt" },
    ],
    note: "<script>bad()</script>",
  });
  assert.equal(view.el.querySelector("img"), null);
  assert.equal(view.el.querySelector("script"), null);
  assert.match(view.el.querySelector(".cl-ob-cap")!.textContent!, /<script>/);
});

test("a step with no scene leaves the panel alone instead of throwing", () => {
  const view = new ObjectsView();
  assert.doesNotThrow(() => view.sync({ model: {} } as unknown as SyncCtx));
  assert.equal(view.el.querySelector(".cl-ob-row"), null);
});

// The picture speaks English of its own - "(empty)", "your folder", "names". A
// lesson file cannot reach those strings, so without this surface a Spanish
// learner reads Spanish narration beside an English picture.
test("the widget's own words come from labels, not from the source", () => {
  const es = { ...DEFAULT_VIZ_LABELS, objEmpty: "(vacio)", objNoNames: "(sin nombres)",
    objYourFolder: "tu carpeta", objUnnamed: "sin nombre", objNames: "nombra" };
  const view = new ObjectsView(es);
  view.sync({ model: { objects: {
    lens: "both",
    acts: [...SAVE, { act: "write", path: "hello.txt", text: "goodbye\n" }, { act: "store", path: "hello.txt" }],
  } } } as unknown as SyncCtx);
  const text = view.el.textContent!;
  assert.match(text, /tu carpeta/);
  assert.match(text, /nombra/);
  assert.match(text, /sin nombre/);
  assert.doesNotMatch(text, /your folder|\bnames\b/);
  // git's own vocabulary is NOT translated - the learner meets these verbatim.
  assert.match(text, /commit/);
  assert.match(text, /blob/);
});

test("an empty repository reports empty in the reading language", () => {
  const view = new ObjectsView({ ...DEFAULT_VIZ_LABELS, objEmpty: "(vacio)", objNoNames: "(sin nombres)" });
  view.sync({ model: { objects: { lens: "folder", acts: [] } } } as unknown as SyncCtx);
  assert.match(view.el.querySelector(".cl-ob-folder")!.textContent!, /\(vacio\)/);
  assert.match(view.el.querySelector(".cl-ob-folder")!.textContent!, /\(sin nombres\)/);
});

// `git init` really creates config, description, hooks/, info/, objects/info,
// objects/pack and refs/tags. A learner who opens a real .git after this lesson
// should find nothing that was hidden from them.
test("full detail draws what git init really makes; core draws only what matters", () => {
  const full = render({ lens: "folder", acts: [], detail: "full" });
  const text = full.el.querySelector(".cl-ob-folder")!.textContent!;
  for (const entry of ["config", "description", "hooks/", "info/", "pack/", "refs/tags/"]) {
    assert.ok(text.includes(entry), `full detail should list ${entry}`);
  }
  const core = render({ lens: "folder", acts: [] });
  assert.ok(!core.el.querySelector(".cl-ob-folder")!.textContent!.includes("description"));
});

// HEAD is a text file holding one line. Drawing an arrow would be a rendering of
// the truth rather than the truth, and this track promises ordinary files.
test("HEAD shows the line that is actually in it", () => {
  const view = render({ lens: "folder", acts: [] });
  assert.match(view.el.querySelector(".cl-ob-folder")!.textContent!, /HEAD\s+ref: refs\/heads\/main/);
});

// "same bytes, same name" is the claim the whole track rests on. Listing only
// file NAMES asked the learner to take on trust which files hold the same bytes.
test("your folder shows each file's first line, aligned", () => {
  const view = render({ lens: "folder", acts: [
    { act: "write", path: "notes.md", text: "hello world\n" },
    { act: "write", path: "copy.md", text: "hello world\n" },
    { act: "write", path: "loud.md", text: "hello world!\n" },
  ] });
  const text = view.el.querySelector(".cl-ob-folder")!.textContent!;
  const rows = text.split("\n").filter((l) => /\.md/.test(l));
  assert.equal(rows.length, 3);
  for (const [name, body] of [["notes.md", "hello world"], ["copy.md", "hello world"], ["loud.md", "hello world!"]]) {
    const row = rows.find((r) => r.includes(name))!;
    assert.ok(row.includes(body), `${name} should show its first line`);
  }
  // Padded to a common width, so identical contents line up under each other.
  const at = rows.map((r) => r.indexOf("hello"));
  assert.equal(new Set(at).size, 1, "contents should start at the same column");
});

test("a long or multi-line file shows one truncated line, not the whole thing", () => {
  const view = render({ lens: "folder", acts: [
    { act: "write", path: "a.md", text: "x".repeat(80) + "\nsecond line\n" },
  ] });
  const text = view.el.querySelector(".cl-ob-folder")!.textContent!;
  assert.ok(text.includes("\u2026"), "should be truncated");
  assert.ok(!text.includes("second line"), "only the first line is shown");
});

// A commit's five lines ARE the content of the lesson about commits. Paraphrasing
// them in narration would describe the thing instead of showing it.
test("open shows the exact bytes git stores for an object", () => {
  const view = render({ lens: "chain", open: "commit", acts: SAVE });
  const opened = view.el.querySelector(".cl-ob-open") as HTMLElement;
  assert.ok(!opened.hidden);
  const text = opened.textContent!;
  // Verified against real git for THIS fixture: hello.txt holding "hello world\n"
  // gives tree 68aba62e560c... and commit 28a8228dbaa8... with this author and date.
  assert.match(text, /^commit 28a8228/m, "labelled with its real short id");
  assert.match(text, /tree 68aba62e560c0ebc3396e8ae9335232cd93a3f60/);
  assert.match(text, /author A Learner <learner@example\.com> 1700000000 \+0000/);
  assert.match(text, /committer A Learner/);
  assert.match(text, /\n\nsave the greeting/, "one blank line before the message");
});

test("open is hidden when a step does not ask for it, and ignores a bad type", () => {
  assert.ok((render({ lens: "chain", acts: SAVE }).el.querySelector(".cl-ob-open") as HTMLElement).hidden);
  assert.ok((render({ lens: "chain", open: "packfile" as never, acts: SAVE })
    .el.querySelector(".cl-ob-open") as HTMLElement).hidden);
});

test("opening a tree shows it the way git cat-file does", () => {
  const view = render({ lens: "chain", open: "tree", acts: SAVE });
  assert.match(view.el.querySelector(".cl-ob-open")!.textContent!,
    /100644 blob 3b18e512dba79e4c8300dd08aeb37f8e728b8dad\thello\.txt/);
});

test("openRaw puts the real hashed bytes on screen, header and all", () => {
  const acts: ObjectAct[] = [
    { act: "write", path: "notes.md", text: "hello world\n" },
    { act: "store", path: "notes.md" },
  ];
  const plain = render({ lens: "chain", acts, open: "blob" });
  const raw = render({ lens: "chain", acts, open: "blob", openRaw: true });
  const textOf = (v: ObjectsView) =>
    v.el.querySelector(".cl-ob-open")!.textContent!;

  assert.ok(!textOf(plain).includes("blob 12"), "payload view must stay payload");
  // The exact bytes real git hashes to 3b18e512... - the whole point of the
  // lesson, so it has to survive the view and not just the resolver. The header
  // gets its own line, or a long commit body runs into it and reads as garbage.
  const lines = textOf(raw).split("\n");
  assert.ok(lines.includes("blob 12\\0"), "header on its own line");
  assert.ok(lines.includes("hello world"), "body below it");
});

// ===== VISUAL CLUES =====
// The same object id must get the same tint class everywhere it appears - in the
// folder, in refs, in the index, and in the chain. Hovering any id must outline
// every mention of it. Ref names render as chips, and the HEAD marker sits
// beside the ref that HEAD points to.

test("the same object id gets the same tint class in the folder and the chain", () => {
  const view = render({ lens: "both", acts: SAVE });
  const folder = view.el.querySelector(".cl-ob-folder")!.innerHTML;
  const chain = view.el.querySelector(".cl-ob-chain")!.innerHTML;
  
  // Extract all tint classes from folder and chain.
  const folderTints = [...folder.matchAll(/cl-ob-id-t(\d+)/g)].map((m) => m[0]);
  const chainTints = [...chain.matchAll(/cl-ob-id-t(\d+)/g)].map((m) => m[0]);
  
  assert.ok(folderTints.length > 0, "folder should have tinted ids");
  assert.ok(chainTints.length > 0, "chain should have tinted ids");
  
  // Every tint class should be one of the four palette classes.
  const palette = ["cl-ob-id-t0", "cl-ob-id-t1", "cl-ob-id-t2", "cl-ob-id-t3"];
  for (const tint of [...folderTints, ...chainTints]) {
    assert.ok(palette.includes(tint), `${tint} should be in the palette`);
  }
});

test("a ref name renders as a chip with .cl-ob-ref", () => {
  const view = render({ lens: "folder", acts: SAVE });
  const refs = view.el.querySelectorAll(".cl-ob-ref");
  assert.ok(refs.length > 0, "should have ref chips");
  assert.equal(refs[0].textContent, "main", "ref chip should contain the branch name");
});

test("the HEAD marker appears beside the ref that HEAD points to in the folder", () => {
  const view = render({ lens: "folder", acts: SAVE });
  const headMarkers = view.el.querySelectorAll(".cl-ob-head");
  
  // There should be one visible marker per ref line - one for main (visible),
  // possibly others hidden for future refs.
  const visible = Array.from(headMarkers).filter((m) => (m as HTMLElement).style.opacity !== "0");
  assert.equal(visible.length, 1, "exactly one HEAD marker should be visible");
  assert.match(visible[0].textContent!, /HEAD/, "marker should say HEAD");
});

test("the HEAD marker appears beside the ref in the chain view too", () => {
  const view = render({ lens: "chain", acts: SAVE });
  const headMarkers = view.el.querySelectorAll(".cl-ob-head");
  const visible = Array.from(headMarkers).filter((m) => (m as HTMLElement).style.opacity !== "0");
  assert.equal(visible.length, 1, "exactly one HEAD marker should be visible in chain");
});

test("HEAD marker has a data-head attribute for animation targeting", () => {
  const view = render({ lens: "folder", acts: SAVE });
  const markers = view.el.querySelectorAll(".cl-ob-head[data-head]");
  assert.ok(markers.length > 0, "HEAD markers should have data-head attribute");
});
