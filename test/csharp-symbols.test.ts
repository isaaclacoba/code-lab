import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scanCSharp,
  receiverBefore,
  membersOf,
  stripCommentsAndStrings,
} from "../src/core/csharp-symbols.ts";

// The learner writes a class; the editor must offer it back. That is the whole
// point of this module, so it is the first test.
test("finds a class the learner declared", () => {
  const s = scanCSharp("public class Dog { }");
  assert.deepEqual(s.types.map((t) => t.name), ["Dog"]);
  assert.equal(s.types[0].kind, "class");
});

test("finds every type kind", () => {
  const src = `
    class A { }
    interface IB { }
    record C { }
    struct D { }
    enum E { One, Two }
  `;
  const s = scanCSharp(src);
  assert.deepEqual(s.types.map((t) => t.name).sort(), ["A", "C", "D", "E", "IB"]);
  assert.equal(s.types.find((t) => t.name === "IB")!.kind, "interface");
  assert.equal(s.types.find((t) => t.name === "E")!.kind, "enum");
});

// --- members ---------------------------------------------------------------

test("finds methods, properties and fields of a type", () => {
  const src = `
    public class Dog {
      public string Name { get; set; }
      private int age = 3;
      public void Bark() { Console.WriteLine("woof"); }
      public int Fetch(int times) { return times; }
    }`;
  const d = scanCSharp(src).types[0];
  const byName = (n: string) => d.members.find((m) => m.name === n);
  assert.equal(byName("Name")!.kind, "property");
  assert.equal(byName("age")!.kind, "field");
  assert.equal(byName("Bark")!.kind, "method");
  assert.equal(byName("Fetch")!.type, "int");
});

test("a local inside a method is not mistaken for a field", () => {
  const src = `class Dog { public void Bark() { int loudness = 11; } }`;
  const d = scanCSharp(src).types[0];
  assert.equal(d.members.some((m) => m.name === "loudness"), false);
  assert.equal(d.members.some((m) => m.name === "Bark"), true);
});

test("positional record parameters become properties", () => {
  const s = scanCSharp("record Animal(string Name, int Legs);");
  const a = s.types[0];
  assert.deepEqual(a.members.map((m) => m.name), ["Name", "Legs"]);
  assert.equal(a.members[1].type, "int");
});

test("enum members are captured", () => {
  const s = scanCSharp("enum Size { Small, Medium = 5, Large }");
  assert.deepEqual(s.types[0].members.map((m) => m.name), ["Small", "Medium", "Large"]);
});

// --- the false positives that would make completions WORSE than none --------

test("control flow is never read as a declaration", () => {
  const src = `
    class P {
      public void M() { }
    }
    class Q {
      public void Run(int n) {
        if (n > 0) { }
        while (n > 0) { n--; }
        foreach (var item in items) { }
        for (int i = 0; i < n; i++) { }
        switch (n) { }
        try { } catch (Exception ex) { }
      }
    }`;
  const s = scanCSharp(src);
  assert.deepEqual(s.types.map((t) => t.name).sort(), ["P", "Q"]);
  const q = s.types.find((t) => t.name === "Q")!;
  for (const bad of ["if", "while", "foreach", "for", "switch", "try", "catch"]) {
    assert.equal(q.members.some((m) => m.name === bad), false, `"${bad}" must not be a member`);
  }
});

test("declarations inside comments and strings are ignored", () => {
  const src = `
    // class Ghost { }
    /* class Phantom { } */
    var s = "class Spectre { }";
    class Real { }`;
  const names = scanCSharp(src).types.map((t) => t.name);
  assert.deepEqual(names, ["Real"]);
});

test("stripCommentsAndStrings preserves length and newlines", () => {
  const src = 'a\n// hide\n"txt"\nb';
  const out = stripCommentsAndStrings(src);
  assert.equal(out.length, src.length);
  assert.equal(out.split("\n").length, src.split("\n").length);
  assert.match(out, /^a\n/);
});

test("never throws on garbage or unbalanced source", () => {
  for (const bad of ["", "class", "class {", "public class Dog { public void", '"unterminated', "/* open"]) {
    assert.doesNotThrow(() => scanCSharp(bad), `threw on: ${bad}`);
  }
});

// --- variables + member-aware completion ------------------------------------

test("tracks a variable's type through var-new and explicit typing", () => {
  const s = scanCSharp(`class Dog { }
    class P { static void Main() { var d = new Dog(); Dog other = new Dog(); } }`);
  assert.equal(s.vars.find((v) => v.name === "d")!.type, "Dog");
  assert.equal(s.vars.find((v) => v.name === "other")!.type, "Dog");
});

test("receiverBefore reads the identifier left of a dot", () => {
  assert.equal(receiverBefore("        d."), "d");
  assert.equal(receiverBefore("var x = dog.Ba"), "dog");
  assert.equal(receiverBefore("Dog."), "Dog");
  assert.equal(receiverBefore("no dot here"), null);
  assert.equal(receiverBefore("a.b."), null, "chained access is out of scope");
});

test("dot on an instance offers that type's instance members only", () => {
  const src = `class Dog {
      public string Name { get; set; }
      public void Bark() { }
      public static Dog Create() { return new Dog(); }
    }
    class P { static void Main() { var d = new Dog(); } }`;
  const s = scanCSharp(src);
  const got = membersOf(s, "d")!.map((m) => m.name).sort();
  assert.deepEqual(got, ["Bark", "Name"]);
  assert.equal(membersOf(s, "d")!.some((m) => m.name === "Create"), false, "static must not appear on an instance");
});

test("dot on a type name offers static members", () => {
  const src = `class Dog { public static Dog Create() { return null; } public void Bark() { } }`;
  const s = scanCSharp(src);
  assert.deepEqual(membersOf(s, "Dog")!.map((m) => m.name), ["Create"]);
});

// The honest answer for an unknown receiver is SILENCE. Guessing would offer a
// wrong list, which is worse for a learner than offering nothing.
test("an unknown receiver yields null, not a guess", () => {
  const s = scanCSharp("class Dog { public void Bark() { } }");
  assert.equal(membersOf(s, "mystery"), null);
  assert.equal(membersOf(s, ""), null);
  assert.equal(membersOf(scanCSharp(""), "d"), null);
});

// REGRESSION: these passed for the wrong reason at first. The control-flow test
// above exercises the brace-depth logic, NOT the keyword guard - method bodies
// are skipped wholesale, so the guard is never consulted there. The cases that
// genuinely need it are statements at TYPE-BODY or TOP level, where `X y;` is
// shaped exactly like a field declaration. Emptying NOT_A_DECLARATION must fail
// this test; it did not fail the one above.
test("statement keywords never become variables (the guard is load-bearing)", () => {
  const cases: Array<[string, string]> = [
    ["using System;\nclass P { }", "System"],
    ["return value;", "value"],
    ["class P { throw ex; }", "ex"],
    ["class P { lock obj; }", "obj"],
  ];
  for (const [src, leaked] of cases) {
    const s = scanCSharp(src);
    assert.equal(
      s.vars.some((v) => v.name === leaked), false,
      `"${leaked}" must not be offered as a variable for: ${src.split("\n")[0]}`,
    );
    assert.equal(
      s.types.some((t) => t.members.some((m) => m.name === leaked)), false,
      `"${leaked}" must not be offered as a member for: ${src.split("\n")[0]}`,
    );
  }
});

// `using System;` opens virtually every C# file the course ships, so a bogus
// `System` completion would be on screen constantly.
test("a plain using directive contributes nothing", () => {
  const s = scanCSharp("using System;\nusing System.Collections.Generic;\nclass Dog { }");
  assert.deepEqual(s.vars.map((v) => v.name), []);
  assert.deepEqual(s.types.map((t) => t.name), ["Dog"]);
});
