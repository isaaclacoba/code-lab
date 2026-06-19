namespace Level3Capstone.Services;

public record Hint(string Text, string? Code = null);

public record Milestone(int Id, string Title, string PassMessage, string TodoMessage, Hint[] Hints, string? Why = null, string? Diagram = null);

public static class Capstone
{
    public const string StarterCode = @"using System;

// This works, but TestRunner does three jobs and is welded to the console.
// Refactor it step by step. Watch the milestones fill in as you go.
public class TestRunner
{
    public void Run()
    {
        bool passed = true;
        string report = passed ? ""PASS"" : ""FAIL"";   // formatting lives here
        Console.WriteLine(report);                       // welded to the console
    }
}

public class Program
{
    public static void Main()
    {
        var runner = new TestRunner();
        runner.Run();
    }
}";

    public const string ReferenceSolution = @"using System;

// A pure function: same input -> same output, no side effects.
// It needs no interface - you can test it directly.
public class ReportFormatter
{
    public string Format(bool passed) => passed ? ""PASS"" : ""FAIL"";
}

// The destination is a side effect. An interface gives us a seam
// we can swap (or fake in a test) without touching TestRunner.
public interface IReporter
{
    void Send(string message);
}

public class ConsoleReporter : IReporter
{
    public void Send(string message) => Console.WriteLine(message);
}

public class SilentReporter : IReporter
{
    public void Send(string message) { }
}

public class TestRunner
{
    private ReportFormatter _formatter;
    private IReporter _reporter;

    // Both dependencies arrive from outside. TestRunner builds neither.
    public TestRunner(ReportFormatter formatter, IReporter reporter)
    {
        _formatter = formatter;
        _reporter = reporter;
    }

    public void Run()
    {
        bool passed = true;
        string result = _formatter.Format(passed);
        _reporter.Send(result);
    }
}

public class Program
{
    public static void Main()
    {
        var formatter = new ReportFormatter();

        // Same TestRunner code, two different destinations - Liskov in action.
        var runner = new TestRunner(formatter, new ConsoleReporter());
        runner.Run();

        var silentRunner = new TestRunner(formatter, new SilentReporter());
        silentRunner.Run();
    }
}";

    public static readonly Milestone[] Milestones =
    {
        new(
            1,
            "A formatter class of its own",
            "Nice - the PASS/FAIL words now live in their own class.",
            "Right now Run() is the only place the words PASS/FAIL exist.",
            new[]
            {
                new Hint("Run() is doing two different jobs: checking the result, and deciding the words \"PASS\" or \"FAIL\". Those are two separate reasons to change this one class."),
                new Hint("Create a brand-new class whose only job is turning a true/false result into text. Give it one method that takes a bool and returns a string."),
                new Hint("Here's the shape - you fill the hole:", "public class ReportFormatter\n{\n    public string Format(bool passed) => /* return \"PASS\" or \"FAIL\" */;\n}"),
            },
            "One class, one reason to change. Deciding the words is a different job from running the test, so it gets its own class. This is the Single Responsibility Principle.",
            @"flowchart LR
  subgraph now[one class two jobs]
    R[TestRunner.Run] --> C[do the check]
    R --> F[pick PASS or FAIL]
  end
  subgraph goal[two classes one job each]
    R2[TestRunner] --> C2[do the check]
    FM[ReportFormatter] --> F2[pick the words]
  end"),
        new(
            2,
            "TestRunner stops formatting",
            "TestRunner isn't deciding the words anymore.",
            "TestRunner still writes \"PASS\"/\"FAIL\" itself.",
            new[]
            {
                new Hint("Now that a formatter class exists, TestRunner shouldn't still pick the words itself. It should ask someone else for them."),
                new Hint("Inside Run(), get the text from the formatter instead of writing the ternary. Remove the \"PASS\"/\"FAIL\" strings from TestRunner entirely."),
                new Hint("The line inside Run() becomes something like:", "string result = /* ask the formatter to Format(passed) */;"),
            },
            "If the same words live in two places, you have two places to fix when they change. Move them out completely - TestRunner should ask, not decide.",
            @"flowchart LR
  TR[TestRunner] -->|asks for text| FM[ReportFormatter]
  FM -->|returns PASS or FAIL| TR"),
        new(
            3,
            "Inject the formatter - don't build it",
            "TestRunner receives its formatter from outside instead of building it.",
            "TestRunner still creates the formatter itself with new.",
            new[]
            {
                new Hint("There's a trap here: calling new ReportFormatter() inside Run() still uses the class, but TestRunner is now welded to that exact formatter. It can never be given a different one."),
                new Hint("Give TestRunner a constructor that accepts a ReportFormatter and stores it in a field. Use that field in Run(). Remove any \"new ReportFormatter()\" from inside TestRunner."),
                new Hint("Here's the shape - you fill the holes:", "public class TestRunner\n{\n    private ReportFormatter _formatter;\n\n    public TestRunner(ReportFormatter formatter) => /* store it in the field */;\n\n    // in Run(): use _formatter.Format(passed)\n}"),
            },
            "Injection and interfaces are two separate ideas. Here we inject a plain class, no interface. The formatter is a pure function - same input, same output, no side effects - so you can test it directly. Don't reach for an interface until you actually need to swap or fake something. Receiving a dependency instead of building it is Dependency Injection.",
            @"flowchart LR
  subgraph now[welded]
    TR1[TestRunner] -->|new ReportFormatter| F1[ReportFormatter]
  end
  subgraph goal[injected]
    P[Program] -->|hands in formatter| TR2[TestRunner]
    TR2 -->|just uses it| F2[formatter]
  end"),
        new(
            4,
            "Abstract the destination",
            "There's a reporter interface to depend on.",
            "TestRunner still talks straight to the console.",
            new[]
            {
                new Hint("Writing straight to the console welds TestRunner to one destination. What if the destination were just a promise: \"something that can send a message\"?"),
                new Hint("Define an interface with a single method that sends a string somewhere. Don't implement it yet - just the promise."),
                new Hint("Here's the shape:", "public interface IReporter\n{\n    void Send(string message);\n}"),
            },
            "This is where an interface earns its place. The console is a side effect - I/O you might want to redirect, silence, or fake in a test. That is a real substitution seam, and a seam is exactly what an interface is for. The formatter had no such seam, so it got none.",
            @"flowchart LR
  subgraph now[welded to one destination]
    TR1[TestRunner] --> CON[Console]
  end
  subgraph goal[depend on a promise]
    TR2[TestRunner] --> I[IReporter]
    I -.-> CON2[ConsoleReporter]
  end"),
        new(
            5,
            "Depend on the abstraction, injected",
            "TestRunner now receives its reporter through the constructor and never touches the console.",
            "TestRunner still builds its reporter or writes to the console directly.",
            new[]
            {
                new Hint("If TestRunner builds its reporter with new, or calls Console.WriteLine itself, it's stuck with one destination. The decision belongs outside TestRunner."),
                new Hint("Add an IReporter parameter to the constructor (the interface, not a concrete reporter) and store it in a field. Use _reporter.Send(...) in Run(). Remove any new ...Reporter() and any Console. call from TestRunner."),
                new Hint("Here's the shape - you fill the holes:", "public TestRunner(ReportFormatter formatter, IReporter reporter)\n{\n    _formatter = formatter;\n    _reporter = reporter;\n}\n\n// in Run(): _reporter.Send(result);"),
            },
            "Depend on the contract, not the concrete. The constructor asks for IReporter, so TestRunner has no idea whether it's talking to a console, a file, or a test double. High-level code depending on an abstraction instead of a detail is the Dependency Inversion Principle.",
            @"flowchart LR
  subgraph now[TestRunner picks the destination]
    TR1[TestRunner] -->|new ConsoleReporter| CR1[ConsoleReporter]
  end
  subgraph goal[destination injected]
    P[Program] -->|injects IReporter| TR2[TestRunner]
    TR2 --> I[IReporter]
  end"),
        new(
            6,
            "A second reporter, no edits to the first",
            "A second reporter exists behind the same interface.",
            "Only one kind of reporter so far.",
            new[]
            {
                new Hint("This is the payoff: with the interface in place, you can add new behavior without touching old code. Where else could a report go besides the console?"),
                new Hint("Create a second class that implements IReporter - for example one that stays silent. Do not edit the first reporter."),
                new Hint("Here's the shape:", "public class SilentReporter : IReporter\n{\n    public void Send(string message) { /* do nothing */ }\n}"),
            },
            "Adding a behavior without editing existing code is the Open/Closed Principle - open to extension, closed to modification. Notice the interface just paid for itself: this is the moment that proves it wasn't over-engineering.",
            @"flowchart LR
  I[IReporter] --> CR[ConsoleReporter]
  I --> SR[SilentReporter added with no edits]"),
        new(
            7,
            "Prove substitutability",
            "Main runs TestRunner with both reporters, same TestRunner code.",
            "Main only runs TestRunner with one reporter.",
            new[]
            {
                new Hint("You now have two reporters that both honour the IReporter promise. Can the same TestRunner use either one without knowing the difference?"),
                new Hint("In Main, create two TestRunner instances - one with the console reporter, one with the silent reporter - and run both. TestRunner's code does not change between them."),
                new Hint("Here's the shape:", "var runner = new TestRunner(formatter, new ConsoleReporter());\nrunner.Run();\n\nvar silentRunner = new TestRunner(formatter, new SilentReporter());\nsilentRunner.Run();"),
            },
            "Any IReporter slots in and TestRunner never notices the swap - that is the Liskov Substitution Principle. And it's the same seam a unit test uses: inject a fake reporter, assert what it received. This is why TDD and interfaces go together - you abstract the side-effecting collaborator, which is exactly the one a test needs to fake.",
            @"flowchart LR
  TR[same TestRunner code] --> I[IReporter]
  I -.-> CR[ConsoleReporter]
  I -.-> SR[SilentReporter]"),
    };
}
