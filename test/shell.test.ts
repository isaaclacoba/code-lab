import { test } from "node:test";
import assert from "node:assert/strict";
import { Shell, tokenize, tokenizeLine, editDistance, type ShellCommand } from "../src/terminal/shell.ts";

// --- the world the test commands act on ------------------------------------

interface Notes {
  said: string[];
}

const say: ShellCommand<Notes> = {
  name: "say",
  summary: "Repeat what you were given.",
  run: (argv, state) => ({ state: { said: [...state.said, argv.join("|")] }, output: argv.join("|") }),
  help: () => "say <word>...\n\nAppends the words to the notes.",
};

const boom: ShellCommand<Notes> = {
  name: "boom",
  summary: "Throw, on purpose.",
  run: () => {
    throw new Error("boom: the disk caught fire");
  },
};

function shell(): Shell<Notes> {
  return new Shell<Notes>().register(say);
}

const EMPTY: Notes = { said: [] };

// --- tokenizing ------------------------------------------------------------

test("tokenize splits on whitespace and collapses runs", () => {
  assert.deepEqual(tokenize("  git   status  "), ["git", "status"]);
  assert.deepEqual(tokenize("git\tstatus"), ["git", "status"]);
});

test("tokenize keeps a quoted argument as one token", () => {
  assert.deepEqual(tokenize('git commit -m "add cat"'), ["git", "commit", "-m", "add cat"]);
  assert.deepEqual(tokenize("git commit -m 'add cat'"), ["git", "commit", "-m", "add cat"]);
});

test("tokenize handles quotes inside a word, and an empty quoted token", () => {
  assert.deepEqual(tokenize('say a"b c"d'), ["say", "ab cd"]);
  assert.deepEqual(tokenize('say ""'), ["say", ""]);
  assert.deepEqual(tokenize('say "he said \'hi\'"'), ["say", "he said 'hi'"]);
});

test("tokenize returns nothing for a blank line", () => {
  assert.deepEqual(tokenize(""), []);
  assert.deepEqual(tokenize("   \t "), []);
});

test("editDistance counts single-character edits", () => {
  assert.equal(editDistance("git", "git"), 0);
  assert.equal(editDistance("gi", "git"), 1);
  assert.equal(editDistance("gti", "git"), 2);
  assert.equal(editDistance("", "git"), 3);
});

// --- dispatch --------------------------------------------------------------

test("an empty line does nothing at all", () => {
  const result = shell().run("   ", EMPTY);
  assert.equal(result.output, "");
  assert.equal(result.error, undefined);
  assert.equal(result.effect, undefined);
  assert.equal(result.state, EMPTY, "the same state comes back");
});

test("a registered command gets argv without its own name, and its state back", () => {
  const result = shell().run('say hello "big world"', EMPTY);
  assert.equal(result.output, "hello|big world");
  assert.deepEqual(result.state, { said: ["hello|big world"] });
  assert.equal(result.error, undefined);
});

test("the shell holds no state of its own", () => {
  const sh = shell();
  const first = sh.run("say a", EMPTY);
  const second = sh.run("say b", EMPTY);
  assert.deepEqual(first.state, { said: ["a"] });
  assert.deepEqual(second.state, { said: ["b"] });
});

test("commands() lists what was registered, sorted by name", () => {
  const sh = shell().register(boom);
  assert.deepEqual(
    sh.commands().map((c) => c.name),
    ["boom", "say"],
  );
});

test("register replaces a command of the same name", () => {
  const sh = shell().register({ ...say, summary: "Second take.", run: (_argv, state) => ({ state, output: "2" }) });
  assert.equal(sh.commands().length, 1);
  assert.equal(sh.run("say x", EMPTY).output, "2");
});

// --- built-ins -------------------------------------------------------------

test("help lists every command and the built-ins, aligned and sorted", () => {
  const result = shell().run("help", EMPTY);
  assert.equal(
    result.output,
    [
      "clear  Clear the terminal screen.",
      "help   List the commands, or explain one: help <name>.",
      "say    Repeat what you were given.",
    ].join("\n"),
  );
  assert.equal(result.error, undefined);
});

test("help <name> gives the long help, or falls back to the summary", () => {
  const sh = shell().register(boom);
  assert.equal(sh.run("help say", EMPTY).output, "say <word>...\n\nAppends the words to the notes.");
  assert.equal(sh.run("help boom", EMPTY).output, "Throw, on purpose.");
  assert.equal(sh.run("help clear", EMPTY).output, "Clear the terminal screen.");
});

test("help for something unknown is an error", () => {
  const result = shell().run("help nope", EMPTY);
  assert.equal(result.output, "help: no such command: nope");
  assert.equal(result.error, true);
});

test("clear returns the clear effect and prints nothing", () => {
  const result = shell().run("clear", EMPTY);
  assert.deepEqual(result.effect, { kind: "clear" });
  assert.equal(result.output, "");
  assert.equal(result.error, undefined);
  assert.equal(result.state, EMPTY);
});

test("a built-in cannot be shadowed by a registered command", () => {
  const sh = shell().register({
    name: "clear",
    summary: "Not the real clear.",
    run: (_argv, state) => ({ state, output: "hijacked" }),
  });
  const result = sh.run("clear", EMPTY);
  assert.deepEqual(result.effect, { kind: "clear" });
  assert.equal(result.output, "");
  assert.ok(sh.run("help", EMPTY).output.includes("clear  Clear the terminal screen."));
});

// --- failure ---------------------------------------------------------------

test("an unknown command reports not found", () => {
  const result = shell().run("wandering-albatross", EMPTY);
  assert.equal(result.output, "wandering-albatross: command not found");
  assert.equal(result.error, true);
  assert.equal(result.state, EMPTY);
});

test("a near miss gets a suggestion, the closest one", () => {
  const sh = shell().register(boom);
  assert.equal(sh.run("sey x", EMPTY).output, "sey: command not found  Did you mean 'say'?");
  assert.equal(sh.run("hepl", EMPTY).output, "hepl: command not found  Did you mean 'help'?");
  assert.equal(sh.run("bom", EMPTY).output, "bom: command not found  Did you mean 'boom'?");
});

test("a command that throws is caught and reported, not raised", () => {
  const sh = shell().register(boom);
  const result = sh.run("boom now", EMPTY);
  assert.equal(result.output, "boom: the disk caught fire");
  assert.equal(result.error, true);
  assert.equal(result.state, EMPTY, "state is untouched when a command blows up");
});

test("a command that throws a non-Error is still reported", () => {
  const sh = shell().register({
    name: "odd",
    summary: "Throw a string.",
    run: () => {
      throw "just a string";
    },
  });
  const result = sh.run("odd", EMPTY);
  assert.equal(result.output, "just a string");
  assert.equal(result.error, true);
});

// --- unterminated quotes ---------------------------------------------------
// A shell that "helpfully" closes your quote for you teaches a lie: the learner
// types `git commit -m "add the pets` and the commit lands, so they never learn
// the quote matters. It must fail, and the command must not run.
test("a line with an unclosed double quote does not tokenize", () => {
  const { error } = tokenizeLine('git commit -m "add the pets');
  assert.match(String(error), /unexpected EOF while looking for matching "/);
});

test("a line with an unclosed single quote does not tokenize", () => {
  const { error } = tokenizeLine("git commit -m 'add the pets");
  assert.match(String(error), /unexpected EOF while looking for matching '/);
});

test("a balanced line still tokenizes with no error", () => {
  const { tokens, error } = tokenizeLine('git commit -m "add the pets"');
  assert.equal(error, undefined);
  assert.deepEqual(tokens, ["git", "commit", "-m", "add the pets"]);
});

test("the shell refuses an unclosed quote instead of running the command", () => {
  let ran = false;
  const shell = new Shell<number>().register({
    name: "boom",
    summary: "should never run",
    run: (_argv, state) => { ran = true; return { state, output: "ran" }; },
  });
  const res = shell.run('boom -m "never closed', 1);
  assert.equal(ran, false);
  assert.equal(res.error, true);
  assert.equal(res.state, 1);
  assert.match(res.output, /unexpected EOF/);
});
