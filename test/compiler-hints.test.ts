import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The learner-facing text for a diagnostic lives in three tables in one C# file.
// They are easy to grow out of step, and when they do the failure is silent:
// the panel simply renders without its "Learn why", and no test notices.
// These checks make that drift loud.
const SOURCE = fileURLToPath(
  new URL("../compiler-host/Services/CompilerService.cs", import.meta.url),
);

function idsBetween(text: string, startMarker: string, endMarker?: string): Set<string> {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `could not find ${startMarker} - did the table get renamed?`);
  const end = endMarker ? text.indexOf(endMarker, start) : text.length;
  const slice = text.slice(start, end === -1 ? text.length : end);
  return new Set([...slice.matchAll(/"(CS\d+)"/g)].map((m) => m[1]));
}

const source = readFileSync(SOURCE, "utf8");
const teaching = idsBetween(source, "TeachingWarningIds", "private static bool IsTeachingWarning");
const friendly = idsBetween(source, "string? FriendlyHint", "string? WhyHint");
const why = idsBetween(source, "string? WhyHint");

test("every diagnostic with friendly text also explains why", () => {
  const missing = [...friendly].filter((id) => !why.has(id)).sort();
  assert.deepEqual(
    missing,
    [],
    `these ids render a message but no "Learn why" disclosure: ${missing.join(", ")}`,
  );
});

test("every why explanation belongs to a diagnostic we actually surface", () => {
  const orphans = [...why].filter((id) => !friendly.has(id)).sort();
  assert.deepEqual(
    orphans,
    [],
    `these ids have why text that can never be shown: ${orphans.join(", ")}`,
  );
});

test("every warning we choose to show the learner is explained", () => {
  const unexplained = [...teaching].filter((id) => !friendly.has(id)).sort();
  assert.deepEqual(
    unexplained,
    [],
    `these warnings reach the learner as raw compiler jargon: ${unexplained.join(", ")}`,
  );
});
