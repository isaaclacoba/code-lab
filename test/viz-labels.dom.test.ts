import { test } from "node:test";
import assert from "node:assert/strict";
import "./setup-dom.ts";
import { HeapCardsView } from "../src/dom/heapcards-view.ts";
import { ConsoleView } from "../src/dom/console-view.ts";
import { DEFAULT_VIZ_LABELS, deriveRefs } from "../src/core/memory-model.ts";
import type { ResolvedModel, VizLabels } from "../src/core/memory-model.ts";
import { placeholdersOf } from "../src/core/template.ts";
import type { SyncCtx } from "../src/dom/panel.ts";

// test/viz-labels.dom.test.ts - the memory picture speaks the lesson's language.
//
// WHY THIS EXISTS
// A Spanish lesson mounting this widget used to render a Spanish page whose
// memory panel said MEMORY, entry point and Nothing printed yet. in English,
// because `VizLabels` stopped at the transport controls and these views had
// their strings baked in.
//
// The test is driven from the label table, not from a list of selectors: every
// `hp*` / `console*` key is swapped for a sentinel and the rendered DOM must
// contain the sentinel and none of the English. Add a key without wiring it up
// and this fails - which is the only way it can keep being true later.

const KEYS = Object.keys(DEFAULT_VIZ_LABELS).filter(
  (k) => k.startsWith("hp") || k.startsWith("console"),
) as Array<keyof VizLabels>;

/** A sentinel per key that keeps the key's slots, so `fill` still has something
 *  to substitute and a dropped slot is not what we are measuring here. */
function sentinelLabels(): VizLabels {
  const out = { ...DEFAULT_VIZ_LABELS };
  for (const key of KEYS) {
    const slots = placeholdersOf(DEFAULT_VIZ_LABELS[key]).map((p) => `{${p}}`).join(" ");
    out[key] = `[${key}]${slots ? " " + slots : ""}`;
  }
  return out;
}

/** A model that lights up every labelled branch at once: statics, constants, all
 *  four frame kinds, a caller paused at a line, an instance call whose receiver
 *  is only a label (the `on Cat #1` fallback), and one whose receiver has a real
 *  id - which is what draws the `this` row and the two section heads.
 *  Deliberately free of English words that collide with a label. */
const MODEL = {
  pc: 3,
  stack: [
    { id: "f0", name: "Main", kind: "entry", line: 12, vars: [] },
    { id: "f1", name: "Helper", kind: "static", line: 20, vars: [] },
    { id: "f2", name: "new Cat", kind: "ctor", line: 4, vars: [] },
    { id: "f3", name: "Speak", kind: "method", recv: "Cat #1", vars: [{ id: "s1", k: "x", v: "1" }] },
    {
      id: "f4", name: "Feed", kind: "method", recv: "Cat #1", recvId: "o1",
      vars: [
        { id: "s2", k: "grams", v: "40", role: "param" },
        { id: "s3", k: "left", v: "2", role: "local" },
      ],
    },
  ],
  heap: [{ id: "o1", type: "Cat", no: 1, fields: [["_name", "\"Ada\""]], hotFields: [] }],
  globals: [{ id: "Cat.Count", k: "Cat.Count", v: "2" }],
  rodata: [{ id: "Cat.Max", k: "Cat.Max", v: "9" }],
  refs: [],
} as unknown as ResolvedModel;

function heapHtml(labels?: VizLabels): string {
  const view = new HeapCardsView(1, labels);
  view.sync({ model: MODEL } as unknown as SyncCtx);
  return view.el.innerHTML;
}

/** The words a learner actually READS. A leak has to be judged on text, not on
 *  markup: `hpThis` is the C# keyword `this`, which also occurs in a class name
 *  and a dot id, and matching those would report a leak that nobody can see. */
function heapText(labels?: VizLabels): string {
  const view = new HeapCardsView(1, labels);
  view.sync({ model: MODEL } as unknown as SyncCtx);
  return view.el.textContent ?? "";
}

function consoleText(model: Partial<ResolvedModel>, labels?: VizLabels): string {
  const view = new ConsoleView(labels);
  view.sync({ model } as unknown as SyncCtx);
  return view.el.textContent ?? "";
}

function consoleHtml(model: Partial<ResolvedModel>, labels?: VizLabels): string {
  const view = new ConsoleView(labels);
  view.sync({ model } as unknown as SyncCtx);
  return view.el.innerHTML;
}

test("the English defaults still render, byte for byte", () => {
  const html = heapHtml();
  assert.ok(html.includes("MEMORY"), html);
  assert.ok(html.includes("the call stack on the left, objects on the heap on the right"));
  assert.ok(html.includes("STATICS"));
  assert.ok(html.includes("values shared across the program"));
  assert.ok(html.includes("CONSTANTS"));
  assert.ok(html.includes("fixed at compile time"));
  assert.ok(html.includes("entry point"));
  assert.ok(html.includes("static method"));
  assert.ok(html.includes("instance method"));
  assert.ok(html.includes("constructor"));
  assert.ok(html.includes("on Cat #1"));
  assert.ok(html.includes("paused at line 12"));

  assert.ok(consoleHtml({}).includes("Console"));
  assert.ok(consoleHtml({}).includes("Nothing printed yet."));
});

test("every hp* / console* label is actually used by a view", () => {
  // If a key is added to the table and never read, its sentinel never appears -
  // a string that looks translatable but is not.
  const labels = sentinelLabels();
  const html = heapHtml(labels) + consoleHtml({}, labels) + consoleHtml({ output: "x\n" }, labels);
  for (const key of KEYS) {
    assert.ok(html.includes(`[${key}]`), `label \`${key}\` is never rendered`);
  }
});

test("with every label translated, NO English is left in the two views", () => {
  const labels = sentinelLabels();
  const html = heapText(labels) + consoleText({}, labels);
  for (const key of KEYS) {
    const english = DEFAULT_VIZ_LABELS[key];
    // A template's English never appears verbatim (it still holds its slots), so
    // check what it RENDERS as - the literal text either side of the slot.
    for (const piece of english.split(/\{\w+\}/).map((p) => p.trim()).filter((p) => p.length > 2)) {
      assert.ok(!html.includes(piece), `English leaked from \`${key}\`: ${piece}\n${html}`);
    }
  }
});

test("a slot in a label is filled, not printed raw", () => {
  const labels = sentinelLabels();
  const html = heapHtml(labels);
  assert.ok(html.includes("[hpOn] Cat #1"), html);
  assert.ok(html.includes("[hpPaused] 12"), html);
  assert.ok(!/\{recv\}|\{line\}/.test(html), html);
});

test("a partial label set keeps English for the keys it omits", () => {
  const html = heapHtml({ ...DEFAULT_VIZ_LABELS, hpMemory: "MEMORIA" });
  assert.ok(html.includes("MEMORIA"), html);
  assert.ok(html.includes("entry point"), html);
});

test("a `this` row's dot is the one the derived arrow starts from", () => {
  // The row draws an arrow glyph and a dot. If the ref list names a different
  // id, the dot is an arrow pointing at nothing - which looks like a bug in the
  // picture rather than a mismatch between two files. Deriving both from
  // `thisDotId` is what keeps them together; this is the test that says so.
  const html = heapHtml();
  const refs = deriveRefs(MODEL.stack);
  const thisRef = refs.find((r) => r.from.endsWith(":this"));
  assert.ok(thisRef, "no arrow was derived for the frame that has a receiver");
  assert.equal(thisRef.to, "o1");
  assert.ok(html.includes(`data-dot="${thisRef.from}"`), html);
});

test("a frame with no receiver id keeps the prose line, so an old trace does not regress", () => {
  const html = heapHtml();
  assert.ok(html.includes("on Cat #1"), "the fallback line is gone");
  assert.equal(deriveRefs(MODEL.stack).filter((r) => r.from.endsWith(":this")).length, 1);
});
