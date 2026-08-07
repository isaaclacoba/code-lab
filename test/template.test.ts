import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fill,
  mergeTemplates,
  missingPlaceholders,
  placeholdersOf,
} from "../src/core/template.ts";

// test/template.test.ts - the guard around translated strings.
//
// WHY THIS EXISTS
// A translated template that loses a `{slot}` renders perfectly and says the
// wrong thing: "Traced steps." with no number in it, and nothing fails. That has
// actually shipped in this project before. So the merge is not a spread - it
// checks that a replacement still carries every slot the English carried, and
// refuses the ones that do not. These tests are what stop that check rotting.

test("placeholdersOf lists each slot once, in order", () => {
  assert.deepEqual(placeholdersOf("Called `{method}` on `{recv}`"), ["method", "recv"]);
  assert.deepEqual(placeholdersOf("{n} of {n}"), ["n"]);
  assert.deepEqual(placeholdersOf("no slots here"), []);
});

test("fill substitutes every slot", () => {
  assert.equal(fill("Traced {n} steps.", { n: 4 }), "Traced 4 steps.");
  assert.equal(
    fill("Called `{method}` on `{recv}`", { method: "Speak()", recv: "Cat #1" }),
    "Called `Speak()` on `Cat #1`",
  );
});

test("a slot with no value is left visible rather than blanked", () => {
  // Silently emptying it would hide the mistake; leaving `{recv}` on screen is
  // ugly and obvious, which is the point.
  assert.equal(fill("on {recv}", {}), "on {recv}");
});

test("missingPlaceholders names what a candidate dropped", () => {
  assert.deepEqual(missingPlaceholders("Traced {n} steps.", "Trazados {n} pasos."), []);
  assert.deepEqual(missingPlaceholders("Traced {n} steps.", "Trazado."), ["n"]);
  assert.deepEqual(
    missingPlaceholders("Called `{method}` on `{recv}`", "Llamado `{method}`"),
    ["recv"],
  );
});

test("mergeTemplates keeps the default for any key not overridden", () => {
  const defaults = { a: "one", b: "two" };
  const { merged, issues } = mergeTemplates(defaults, { a: "uno" });
  assert.deepEqual(merged, { a: "uno", b: "two" });
  assert.deepEqual(issues, []);
});

test("mergeTemplates REFUSES an override that dropped a slot, and says so", () => {
  const defaults = { traced: "Traced {n} steps.", hint: "Press {button}." };
  const { merged, issues } = mergeTemplates(defaults, {
    traced: "Trazado.",
    hint: "Pulsa {button}.",
  });
  // The bad one falls back to English rather than shipping a numberless label.
  assert.equal(merged.traced, "Traced {n} steps.");
  assert.equal(merged.hint, "Pulsa {button}.");
  assert.deepEqual(issues, [{ key: "traced", missing: ["n"] }]);
});

test("mergeTemplates does not mutate the defaults it was handed", () => {
  const defaults = { a: "one" };
  mergeTemplates(defaults, { a: "uno" });
  assert.equal(defaults.a, "one");
});

test("an override with no slots is fine when the default had none", () => {
  const { merged, issues } = mergeTemplates({ a: "Console" }, { a: "Consola" });
  assert.equal(merged.a, "Consola");
  assert.deepEqual(issues, []);
});
