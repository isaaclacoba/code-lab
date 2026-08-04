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

// REGRESSION: `public Dog(string name)` also matches the METHOD shape, with
// "public" landing in the return-type slot. The method branch ran first and
// claimed it, so `d.` offered `Dog` and accepting it wrote `d.Dog()` - CS1061.
// The guard that was supposed to stop this sat after the method branch and was
// unreachable. Every course class with a modifier on its constructor hit this.
test("a constructor is not offered as an instance member", () => {
  for (const mod of ["public", "private", "protected", "internal"]) {
    const src = `class Dog {
        public string Name { get; set; }
        ${mod} Dog(string name) { Name = name; }
        public void Bark() { }
      }
      class P { static void Main() { var d = new Dog("x"); } }`;
    const s = scanCSharp(src);
    const names = membersOf(s, "d")!.map((m) => m.name).sort();
    assert.deepEqual(names, ["Bark", "Name"], `${mod} ctor must not be a member`);
  }
});

// The same shape must not swallow real methods: `void Bark()` ALSO matches the
// constructor regex, so the fix cannot simply test the ctor shape first.
test("a real method is still found when a constructor is present", () => {
  const src = `class Dog {
      public Dog() { }
      public void Bark() { }
      public int Age() { return 1; }
      public static Dog Create() { return new Dog(); }
    }
    class P { static void Main() { var d = new Dog(); } }`;
  const s = scanCSharp(src);
  assert.deepEqual(membersOf(s, "d")!.map((m) => m.name).sort(), ["Age", "Bark"]);
  assert.deepEqual(membersOf(s, "Dog")!.map((m) => m.name), ["Create"]);
});

// --- base lists -------------------------------------------------------------
// SOLID is taught through the arrows between types, so a structure view needs
// the `: Base, IFace` list, not just the type name.
test("a base class and interfaces are captured in declaration order", () => {
  const s = scanCSharp(`
    public interface IAnimal { string Speak(); }
    public interface INamed { string Name(); }
    public class Animal { }
    public class Cat : Animal, IAnimal, INamed {
      public string Speak() { return "Meow"; }
      public string Name() { return "cat"; }
    }`);
  const cat = s.types.find((t) => t.name === "Cat")!;
  assert.deepEqual(cat.bases, ["Animal", "IAnimal", "INamed"]);
});

test("a type with no base list reports an empty array, never undefined", () => {
  const s = scanCSharp(`class Program { static void Main() { } }`);
  assert.deepEqual(s.types.find((t) => t.name === "Program")!.bases, []);
});

test("generic arguments are stripped from a base name", () => {
  const s = scanCSharp(`public class Box<T> : List<T>, IBox<T> { }`);
  assert.deepEqual(s.types.find((t) => t.name === "Box")!.bases, ["List", "IBox"]);
});

test("a positional record's parameters are not mistaken for a base list", () => {
  const s = scanCSharp(`public record Pet(string Name, int Legs) : IAnimal;`);
  assert.deepEqual(s.types.find((t) => t.name === "Pet")!.bases, ["IAnimal"]);
});

test("a where-constraint clause is not read as a base", () => {
  const s = scanCSharp(`public class Cage<T> : ICage where T : IAnimal { }`);
  assert.deepEqual(s.types.find((t) => t.name === "Cage")!.bases, ["ICage"]);
});

// The declaration must not reach past its own body into the next type: a
// bodyless record ends at its `;`, and a plain class ends at its `{`.
test("one type's base list never leaks into the next declaration", () => {
  const s = scanCSharp(`
    public class Sparrow : IMover { public string Move() { return "Fly"; } }
    public class Penguin { public string Move() { return "Swim"; } }`);
  assert.deepEqual(s.types.find((t) => t.name === "Sparrow")!.bases, ["IMover"]);
  assert.deepEqual(s.types.find((t) => t.name === "Penguin")!.bases, []);
});

test("a base list written inside a comment or string is ignored", () => {
  const s = scanCSharp(`
    // class Ghost : IHaunt
    public class Cat { public string S() { return "class Fake : IFake"; } }`);
  assert.equal(s.types.some((t) => t.name === "Ghost"), false);
  assert.deepEqual(s.types.find((t) => t.name === "Cat")!.bases, []);
});

// --- constructors -----------------------------------------------------------

// A goal tracker has to be able to ask "does `Cat` take its hours in a
// constructor yet?", so the constructor must be a real member, not dropped.
test("a constructor is reported as a member of its type", () => {
  const s = scanCSharp(`
    public class Cat {
      private int _hours;
      public Cat(int hours) { _hours = hours; }
      public bool IsHungry() { return _hours >= 6; }
    }`);
  const cat = s.types.find((t) => t.name === "Cat")!;
  const ctor = cat.members.find((m) => m.kind === "constructor");
  assert.ok(ctor, "the constructor is a member");
  assert.equal(ctor!.name, "Cat");
  assert.equal(ctor!.detail, "Cat(int hours)");
  // and the other members still land
  assert.ok(cat.members.some((m) => m.kind === "field" && m.name === "_hours"));
  assert.ok(cat.members.some((m) => m.kind === "method" && m.name === "IsHungry"));
});

// ...but you never call a constructor on an instance, so completion drops it.
test("a constructor is not offered as a member completion", () => {
  const s = scanCSharp(`
    public class Cat { public Cat(int hours) { } public bool IsHungry() { return true; } }
    class Program { static void Main() { var cat = new Cat(7); } }`);
  const offered = membersOf(s, "cat")!;
  assert.ok(offered.some((m) => m.name === "IsHungry"), "methods are offered");
  assert.equal(offered.some((m) => m.kind === "constructor"), false, "constructors are not");
});

// --- library types the course actually hands out ----------------------------

// `catList.` used to answer with silence because `List` is not a learner type.
test("a List variable offers the list members the course uses", () => {
  const s = scanCSharp(`
    class Program { static void Main() { var catList = new List<Cat>(); } }`);
  const offered = membersOf(s, "catList")!;
  const names = offered.map((m) => m.name);
  assert.ok(names.includes("Add"), "Add is offered");
  assert.ok(names.includes("Count"), "Count is offered");
  assert.ok(names.includes("Remove"));
});

test("a Dictionary and a string variable also answer", () => {
  const s = scanCSharp(`
    class Program {
      static void Main() {
        var map = new Dictionary<string, int>();
        string name = "Whiskers";
      }
    }`);
  assert.ok(membersOf(s, "map")!.some((m) => m.name === "ContainsKey"));
  assert.ok(membersOf(s, "name")!.some((m) => m.name === "ToUpper"));
});

// A learner type still wins over the builtin table.
test("a learner type named List shadows the builtin members", () => {
  const s = scanCSharp(`
    public class List { public void Purr() { } }
    class Program { static void Main() { var mine = new List(); } }`);
  const names = membersOf(s, "mine")!.map((m) => m.name);
  assert.ok(names.includes("Purr"), "the learner's own member is offered");
  assert.equal(names.includes("Add"), false, "the builtin table does not leak in");
});

// A generic written the way people write it - with a space after the comma -
// used to survive as the garbage type "Dictionary<string," and complete nothing.
test("a generic with a space in its argument list reduces to the bare name", () => {
  const s = scanCSharp(`
    class Program {
      static void Main() {
        var byName = new Dictionary<string, int>();
        var pairs = new Dictionary<string, List<Cat>>();
      }
    }`);
  assert.equal(s.vars.find((v) => v.name === "byName")!.type, "Dictionary");
  assert.equal(s.vars.find((v) => v.name === "pairs")!.type, "Dictionary");
});

// A collection initializer has no argument list, so the type must still be read
// off `new List<int> { ... }` and off `new int[3]`.
test("a collection initializer and an array still yield their type", () => {
  const s = scanCSharp(`
    class Program {
      static void Main() {
        var hours = new List<int> { 7, 5, 2 };
        var names = new Dictionary<string, int> { ["a"] = 1 };
        var plain = new List<Cat>();
      }
    }`);
  assert.equal(s.vars.find((v) => v.name === "hours")!.type, "List");
  assert.equal(s.vars.find((v) => v.name === "names")!.type, "Dictionary");
  assert.equal(s.vars.find((v) => v.name === "plain")!.type, "List");
  assert.ok(membersOf(s, "hours")!.some((m) => m.name === "Add"), "and it completes");
});

// --- expression-bodied members ---------------------------------------------
// `public bool IsHungry() => _hours >= 4;` declares a method just as much as the
// braced form, and learners write them constantly. A scanner that only knows
// `{` reported the member as missing, so the goal tracker left a correct answer
// grey - the exact "your right answer is wrong" failure it exists to prevent.

test("an expression-bodied method is found", () => {
  const { types } = scanCSharp("public class Cat { public bool IsHungry() => _hours >= 4; }");
  const member = types[0].members.find((m) => m.name === "IsHungry");
  assert.equal(member?.kind, "method");
  assert.equal(member?.type, "bool");
  assert.equal(member?.detail, "bool IsHungry()");
});

test("an expression-bodied constructor is found", () => {
  const { types } = scanCSharp(
    "public class Cat { public Cat(int hoursSinceMeal) => _hoursSinceMeal = hoursSinceMeal; }");
  const member = types[0].members.find((m) => m.kind === "constructor");
  assert.equal(member?.name, "Cat");
  assert.equal(member?.detail, "Cat(int hoursSinceMeal)");
});

test("an expression-bodied property is a property, not a field", () => {
  const { types } = scanCSharp('public class Cat { public string Name => "cat"; }');
  const member = types[0].members.find((m) => m.name === "Name");
  assert.equal(member?.kind, "property");
  assert.equal(member?.detail, "string Name { get; }", "no setter on a => property");
});

test("a lambda stored in a field is still a field", () => {
  // The arrow here belongs to the INITIALIZER, not to the member. Reading it as
  // an expression body would invent a method called `twice`.
  const { types } = scanCSharp(
    "public class Math { public Func<int, int> twice = value => value * 2; }");
  const member = types[0].members.find((m) => m.name === "twice");
  assert.equal(member?.kind, "field");
  assert.equal(types[0].members.some((m) => m.kind === "method"), false);
});

test("a parameterless lambda field is not mistaken for a method", () => {
  // `= () =>` ends in `)` right before the arrow, the one shape most likely to
  // fool a "does the head end in a paren" test.
  const { types } = scanCSharp(
    'public class Runner { public Action Run = () => Console.WriteLine("go"); }');
  const member = types[0].members.find((m) => m.name === "Run");
  assert.equal(member?.kind, "field");
  assert.equal(types[0].members.some((m) => m.kind === "method"), false);
});

test("expression-bodied members mix with braced ones", () => {
  const { types } = scanCSharp(`public class Cat
{
    private const int HoursUntilHungry = 4;
    private int _hoursSinceMeal;
    public Cat(int hoursSinceMeal) => _hoursSinceMeal = hoursSinceMeal;
    public bool IsHungry() => _hoursSinceMeal >= HoursUntilHungry;
    public string Describe()
    {
        return IsHungry() ? "FEED" : "FULL";
    }
}`);
  const names = types[0].members.map((m) => `${m.kind}:${m.name}`);
  assert.deepEqual(names, [
    "field:HoursUntilHungry",
    "field:_hoursSinceMeal",
    "constructor:Cat",
    "method:IsHungry",
    "method:Describe",
  ]);
});

test("a generic expression-bodied method keeps its return type", () => {
  const { types } = scanCSharp(
    "public class Box { public List<int> Nums() => new List<int> { 1, 2 }; }");
  const member = types[0].members.find((m) => m.name === "Nums");
  assert.equal(member?.kind, "method");
  assert.equal(member?.type, "List");
});
