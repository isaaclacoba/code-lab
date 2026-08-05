// test/repo-scene.test.ts - the `repo` scene's resolver.
//
// WHY THIS EXISTS
// The first version of this scene handed each step a ready-made RepoState. It
// mounted fine in isolation and died in a real lesson, because the stepper
// deep-clones every step and a structural clone turns a RepoState's Maps into
// plain objects - GitGraph then gets a `commits` with no `.keys()`. The scene now
// carries plain COMMANDS and replays them in the view. The clone-safety test
// below is the one that would have caught it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRepo } from "../src/core/repo-scene.ts";
import { deepClone } from "../src/core/memory-model.ts";

test("a scene with no command list resolves to nothing rather than throwing", () => {
  assert.equal(resolveRepo(undefined), null);
  assert.equal(resolveRepo({} as never), null);
  assert.equal(resolveRepo({ commands: "git init" } as never), null, "a string is not a list");
});

test("commands and files come back as given", () => {
  const out = resolveRepo({ files: ["cat.txt"], commands: ["git add cat.txt"] })!;
  assert.deepEqual(out.files, ["cat.txt"]);
  assert.deepEqual(out.commands, ["git add cat.txt"]);
});

test("a scene with no files resolves to an empty folder, never undefined", () => {
  const out = resolveRepo({ commands: ["git init"] })!;
  assert.deepEqual(out.files, [], "the view must never index into undefined");
});

test("the resolved scene is a copy, so a step cannot be mutated by rendering it", () => {
  const scene = { files: ["cat.txt"], commands: ["git init"] };
  const out = resolveRepo(scene)!;
  out.files.push("sneaky.txt");
  out.commands.push("git commit -m 'sneaky'");
  assert.deepEqual(scene.files, ["cat.txt"], "the author's data is untouched");
  assert.deepEqual(scene.commands, ["git init"]);
});

test("the caption is carried through as authored", () => {
  assert.equal(resolveRepo({ commands: [], note: "main has not moved" })!.note, "main has not moved");
  assert.equal(resolveRepo({ commands: [] })!.note, undefined);
});

// THE REGRESSION THAT CAUSED THE REWRITE.
test("a step survives the deep clone the stepper puts every step through", () => {
  const step = { repo: { files: ["cat.txt"], commands: ["git add cat.txt", 'git commit -m "add cat"'] } };
  const cloned = deepClone(step) as typeof step;
  const out = resolveRepo(cloned.repo)!;
  assert.deepEqual(out.files, ["cat.txt"], "files survive the clone");
  assert.deepEqual(out.commands, ["git add cat.txt", 'git commit -m "add cat"'], "commands survive the clone");
});

// --- which commands a step shows -------------------------------------------
// A step's picture changes and nothing says why. The strip above the board names
// the command that caused it - which is the only way a learner can see WHAT MOVED
// HEAD, rather than noticing after the fact that it sits somewhere new.
test("a step shows its last command by default", () => {
  const out = resolveRepo({ commands: ["git init", "git switch feature"] })!;
  assert.deepEqual(out.ran, ["git switch feature"]);
});

test("a step can show several trailing commands", () => {
  const out = resolveRepo({ commands: ["git init", "git add a", "git commit -m \"x\""], ran: 2 })!;
  assert.deepEqual(out.ran, ["git add a", 'git commit -m "x"']);
});

test("a step that only re-explains the previous picture shows nothing", () => {
  const out = resolveRepo({ commands: ["git init"], ran: 0 })!;
  assert.deepEqual(out.ran, []);
});

test("asking for more commands than exist yields all of them, not a crash", () => {
  const out = resolveRepo({ commands: ["git init"], ran: 9 })!;
  assert.deepEqual(out.ran, ["git init"], "clamped to what is there");
});

test("a negative count is treated as none", () => {
  assert.deepEqual(resolveRepo({ commands: ["git init"], ran: -3 })!.ran, []);
});
