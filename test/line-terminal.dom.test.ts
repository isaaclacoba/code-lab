import { test } from "node:test";
import assert from "node:assert/strict";
import "./setup-dom.ts";
import { LineTerminal } from "../src/dom/line-terminal.ts";
import { CommandHistory } from "../src/core/terminal-history.ts";

// --- helpers ---------------------------------------------------------------

interface Harness {
  term: LineTerminal;
  host: HTMLElement;
  input: HTMLInputElement;
  commands: string[];
  lines(): string[];
  type(text: string): void;
  press(key: string): void;
}

function mount(opts: { prompt?: string; intro?: string[] } = {}): Harness {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const commands: string[] = [];
  const term = new LineTerminal();
  term.mount(host, { ...opts, onCommand: (line) => commands.push(line) });
  const input = host.querySelector(".cl-term-input") as HTMLInputElement;
  return {
    term,
    host,
    input,
    commands,
    lines: () => Array.from(host.querySelectorAll(".cl-term-line")).map((el) => el.textContent ?? ""),
    type: (text) => {
      input.value = text;
    },
    press: (key) => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    },
  };
}

function teardown(h: Harness): void {
  h.term.destroy();
  h.host.remove();
}

// --- mount -----------------------------------------------------------------

test("mount renders a .cl-term with a prompt and a focusable input", () => {
  const h = mount();
  assert.ok(h.host.querySelector(".cl-term"), "root .cl-term is present");
  const prompt = h.host.querySelector(".cl-term-row .cl-term-prompt") as HTMLElement;
  assert.equal(prompt.textContent, "$");
  assert.equal(h.input.tagName, "INPUT");
  assert.equal(h.input.type, "text");
  assert.equal(h.input.getAttribute("aria-label"), "Terminal command");
  teardown(h);
});

test("mount honours a custom prompt and prints the intro lines", () => {
  const h = mount({ prompt: "git>", intro: ["Welcome.", "Try: git status"] });
  const prompt = h.host.querySelector(".cl-term-row .cl-term-prompt") as HTMLElement;
  assert.equal(prompt.textContent, "git>");
  assert.deepEqual(h.lines(), ["Welcome.", "Try: git status"]);
  teardown(h);
});

// --- entering a command ----------------------------------------------------

test("Enter emits the trimmed line, echoes it with the prompt, and clears the input", () => {
  const h = mount();
  h.type("  git status  ");
  h.press("Enter");
  assert.deepEqual(h.commands, ["git status"]);
  assert.deepEqual(h.lines(), ["$ git status"]);
  assert.equal(h.input.value, "");
  teardown(h);
});

test("the echoed command carries the prompt as its own element", () => {
  const h = mount({ prompt: "git>" });
  h.type("log");
  h.press("Enter");
  const echoed = h.host.querySelector(".cl-term-line.is-cmd") as HTMLElement;
  const prompt = echoed.querySelector(".cl-term-prompt") as HTMLElement;
  assert.equal(prompt.textContent, "git>");
  assert.equal(prompt.getAttribute("aria-hidden"), "true");
  teardown(h);
});

test("an empty or whitespace-only Enter echoes a bare prompt and calls nothing", () => {
  const h = mount();
  h.press("Enter");
  h.type("   ");
  h.press("Enter");
  assert.deepEqual(h.commands, []);
  assert.deepEqual(h.lines(), ["$", "$"]);
  teardown(h);
});

test("output is appended as text, never as markup", () => {
  const h = mount();
  h.term.write("<img src=x onerror=boom>");
  const line = h.host.querySelector(".cl-term-line") as HTMLElement;
  assert.equal(line.querySelector("img"), null);
  assert.equal(line.textContent, "<img src=x onerror=boom>");
  teardown(h);
});

// --- write -----------------------------------------------------------------

test("write appends a line with the kind class, defaulting to out", () => {
  const h = mount();
  h.term.write("plain");
  h.term.write("broke", "err");
  h.term.write("careful", "warn");
  h.term.write("nice", "good");
  const classes = Array.from(h.host.querySelectorAll(".cl-term-line")).map((el) => el.className);
  assert.deepEqual(classes, [
    "cl-term-line is-out",
    "cl-term-line is-err",
    "cl-term-line is-warn",
    "cl-term-line is-good",
  ]);
  teardown(h);
});

test("write splits embedded newlines into separate lines", () => {
  const h = mount();
  h.term.write("on main\nnothing to commit", "good");
  assert.deepEqual(h.lines(), ["on main", "nothing to commit"]);
  assert.equal(h.host.querySelectorAll(".cl-term-line.is-good").length, 2);
  teardown(h);
});

// --- history ---------------------------------------------------------------

test("ArrowUp and ArrowDown walk the entered commands", () => {
  const h = mount();
  for (const cmd of ["git init", "git add .", "git commit"]) {
    h.type(cmd);
    h.press("Enter");
  }
  h.press("ArrowUp");
  assert.equal(h.input.value, "git commit");
  h.press("ArrowUp");
  assert.equal(h.input.value, "git add .");
  h.press("ArrowDown");
  assert.equal(h.input.value, "git commit");
  teardown(h);
});

test("walking past the ends stops, and coming back down restores the draft", () => {
  const h = mount();
  h.type("git init");
  h.press("Enter");

  h.type("half-typed");
  h.press("ArrowUp");
  assert.equal(h.input.value, "git init");
  h.press("ArrowUp"); // already at the oldest entry
  assert.equal(h.input.value, "git init");
  h.press("ArrowDown");
  assert.equal(h.input.value, "half-typed", "the parked draft comes back");
  h.press("ArrowDown"); // already on the live line
  assert.equal(h.input.value, "half-typed");
  teardown(h);
});

test("ArrowUp on an empty history leaves the line alone", () => {
  const h = mount();
  h.type("typing");
  h.press("ArrowUp");
  h.press("ArrowDown");
  assert.equal(h.input.value, "typing");
  teardown(h);
});

test("a blank line is not recorded in history", () => {
  const h = mount();
  h.type("git status");
  h.press("Enter");
  h.press("Enter"); // blank
  h.press("ArrowUp");
  assert.equal(h.input.value, "git status");
  teardown(h);
});

// --- clear / destroy -------------------------------------------------------

test("clear empties the scrollback but keeps the prompt and the input text", () => {
  const h = mount({ intro: ["hello"] });
  h.term.write("more");
  h.type("half-typed");
  h.term.clear();
  assert.deepEqual(h.lines(), []);
  assert.ok(h.host.querySelector(".cl-term-row .cl-term-prompt"), "prompt survives");
  assert.equal((h.host.querySelector(".cl-term-input") as HTMLInputElement).value, "half-typed");
  teardown(h);
});

test("destroy removes the root and stops listening", () => {
  const h = mount();
  h.term.destroy();
  assert.equal(h.host.querySelector(".cl-term"), null);
  h.type("git status");
  h.press("Enter");
  h.input.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  assert.deepEqual(h.commands, []);
  h.host.remove();
});

test("write and clear are safe before mount and after destroy", () => {
  const term = new LineTerminal();
  term.write("nowhere");
  term.clear();
  term.focus();
  const h = mount();
  h.term.destroy();
  h.term.write("still nowhere");
  h.term.clear();
  h.term.focus();
  h.host.remove();
});

// --- history ring (pure logic) --------------------------------------------

test("CommandHistory keeps entries in order and skips blanks and repeats", () => {
  const hist = new CommandHistory();
  hist.push("one");
  hist.push("one");
  hist.push("  ");
  hist.push("two");
  assert.deepEqual([...hist.entries], ["one", "two"]);
});

test("CommandHistory drops the oldest entry past its limit", () => {
  const hist = new CommandHistory(2);
  hist.push("a");
  hist.push("b");
  hist.push("c");
  assert.deepEqual([...hist.entries], ["b", "c"]);
});

test("CommandHistory returns null at both ends of the walk", () => {
  const hist = new CommandHistory();
  assert.equal(hist.prev("draft"), null);
  assert.equal(hist.next(), null);
  hist.push("a");
  assert.equal(hist.prev("draft"), "a");
  assert.equal(hist.prev("draft"), null);
  assert.equal(hist.next(), "draft");
  assert.equal(hist.next(), null);
});

test("CommandHistory pushing resets the walk position", () => {
  const hist = new CommandHistory();
  hist.push("a");
  hist.push("b");
  hist.prev("");
  hist.push("c");
  assert.equal(hist.prev(""), "c");
});
