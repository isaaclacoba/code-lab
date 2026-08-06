import { test } from "node:test";
import assert from "node:assert/strict";
import "./setup-dom.ts";
import { ObjectsView } from "../src/dom/objects-view.ts";
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
  assert.match(orphans[0].textContent!, /unnamed/);
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
