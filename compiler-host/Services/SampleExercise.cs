using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace CodeLab.Host;

// The default exercise, used only when no exercise is supplied at build time.
// It keeps the host demonstrable on its own and documents the contract by
// example. A real consumer replaces it via the ExerciseSource build property.
public sealed class SampleExercise : IExercise
{
    public string Title => "Hello, code-lab";
    public string Lead => "A tiny sample exercise. Supply your own to replace it.";
    public string Brief => "Write a program that prints a greeting to the console.";

    public string StarterCode => @"using System;

class Program
{
    static void Main()
    {
        // Print a greeting here.
    }
}";

    public string ReferenceSolution => @"using System;

class Program
{
    static void Main()
    {
        Console.WriteLine(""Hello, code-lab"");
    }
}";

    public IReadOnlyList<Milestone> Milestones { get; } = new[]
    {
        new Milestone(
            1,
            "Print a greeting",
            "Your program writes to the console.",
            "Nothing is printed yet.",
            new[] { new Hint("Call Console.WriteLine with a message inside Main.") }),
    };

    public IReadOnlyList<MilestoneResult> Check(string code)
    {
        var root = CSharpSyntaxTree.ParseText(code).GetRoot();
        var prints = root.DescendantNodes().OfType<MemberAccessExpressionSyntax>()
            .Any(m => m.Name.Identifier.Text == "WriteLine");

        var m = Milestones[0];
        return new[]
        {
            new MilestoneResult(m.Id, m.Title, prints, prints ? m.PassMessage : m.TodoMessage,
                System.Array.Empty<CodeAnchor>()),
        };
    }
}
