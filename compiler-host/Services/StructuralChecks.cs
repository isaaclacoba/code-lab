using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace Level3Capstone.Services;

// Kind: "problem" (red - this is the weld) or "target" (green - move it here).
public record CodeAnchor(int StartLine, int StartCol, int EndLine, int EndCol, string Kind, string Label);

public record MilestoneResult(int Id, string Title, bool Passed, string Detail, IReadOnlyList<CodeAnchor> Anchors);

// Orchestrates the milestone rules over the student's code. Each rule owns one
// milestone's pass condition and the code it points at, so adding a milestone
// means adding a rule - this class never changes (open/closed).
public class StructuralChecks
{
    private static readonly IMilestoneRule[] Rules =
    {
        new FormatterExtractedRule(),
        new RunnerStopsFormattingRule(),
        new InjectFormatterRule(),
        new ReporterInterfaceRule(),
        new InjectReporterRule(),
        new SecondReporterRule(),
        new ProveSubstitutabilityRule(),
    };

    public static List<MilestoneResult> Run(string code)
    {
        var syntax = new CapstoneSyntax(code);

        return Capstone.Milestones
            .Select(m =>
            {
                var rule = Rules.First(r => r.MilestoneId == m.Id);
                var (passed, anchors) = rule.Evaluate(syntax);
                return new MilestoneResult(
                    m.Id, m.Title, passed,
                    passed ? m.PassMessage : m.TodoMessage,
                    anchors);
            })
            .ToList();
    }
}

// One milestone check. Single reason to change: the rule for that milestone.
internal interface IMilestoneRule
{
    int MilestoneId { get; }
    (bool Passed, IReadOnlyList<CodeAnchor> Anchors) Evaluate(CapstoneSyntax syntax);
}

// The student's code, parsed once and exposed as the few nodes every rule needs.
// Sharing this keeps the rules free of duplicated parsing and querying.
internal sealed class CapstoneSyntax
{
    public CapstoneSyntax(string code)
    {
        Root = CSharpSyntaxTree.ParseText(code).GetRoot();
        Classes = Root.DescendantNodes().OfType<ClassDeclarationSyntax>().ToList();
        Interfaces = Root.DescendantNodes().OfType<InterfaceDeclarationSyntax>().ToList();

        Runner = Classes.FirstOrDefault(c => c.Identifier.Text == "TestRunner");
        ReporterInterface = Interfaces.FirstOrDefault(i => HasMethodNamed(i, "Send"))
            ?? Interfaces.FirstOrDefault(i => i.Identifier.Text.Contains("Report"));
        FormatterClass = Classes.FirstOrDefault(c =>
            c.Identifier.Text != "TestRunner" &&
            c.Identifier.Text != "Program" &&
            MentionsLiterals(c, "PASS", "FAIL"));
        RunnerConstructor = Runner?.Members.OfType<ConstructorDeclarationSyntax>().FirstOrDefault();
    }

    public SyntaxNode Root { get; }
    public IReadOnlyList<ClassDeclarationSyntax> Classes { get; }
    public IReadOnlyList<InterfaceDeclarationSyntax> Interfaces { get; }
    public ClassDeclarationSyntax? Runner { get; }
    public InterfaceDeclarationSyntax? ReporterInterface { get; }
    public ClassDeclarationSyntax? FormatterClass { get; }
    public ConstructorDeclarationSyntax? RunnerConstructor { get; }

    public ObjectCreationExpressionSyntax? CreationInRunner(string typeNameFragment)
        => Runner?.DescendantNodes().OfType<ObjectCreationExpressionSyntax>()
            .FirstOrDefault(o => o.Type is IdentifierNameSyntax id && id.Identifier.Text.Contains(typeNameFragment));

    public SyntaxNode? ConsoleAccessInRunner()
        => Runner?.DescendantNodes().OfType<MemberAccessExpressionSyntax>()
            .FirstOrDefault(m => m.Expression is IdentifierNameSyntax id && id.Identifier.Text == "Console");

    public LiteralExpressionSyntax? PassFailLiteralInRunner()
        => Runner?.DescendantNodes().OfType<LiteralExpressionSyntax>()
            .FirstOrDefault(l => l.Token.ValueText is "PASS" or "FAIL");

    public IReadOnlyList<ObjectCreationExpressionSyntax> RunnerCreations()
        => Root.DescendantNodes().OfType<ObjectCreationExpressionSyntax>()
            .Where(o => o.Type is IdentifierNameSyntax id && id.Identifier.Text == "TestRunner")
            .ToList();

    public bool RunnerMentions(params string[] needles)
        => Runner != null && MentionsLiterals(Runner, needles);

    public bool RunnerConstructorTakesType(string typeName)
        => Runner != null && Runner.Members.OfType<ConstructorDeclarationSyntax>()
            .Any(ctor => ctor.ParameterList.Parameters
                .Any(p => p.Type is IdentifierNameSyntax id && id.Identifier.Text == typeName));

    public bool RunnerConstructorTakesInterface()
    {
        if (Runner == null) return false;
        var ifaceNames = Interfaces.Select(i => i.Identifier.Text).ToHashSet();
        return Runner.Members.OfType<ConstructorDeclarationSyntax>()
            .Any(ctor => ctor.ParameterList.Parameters
                .Any(p => p.Type is IdentifierNameSyntax id && ifaceNames.Contains(id.Identifier.Text)));
    }

    public int ReporterImplementerCount()
        => ReporterInterface == null
            ? 0
            : Classes.Count(c => Implements(c, ReporterInterface.Identifier.Text));

    public int DistinctInjectedReporterTypes()
        => RunnerCreations()
            .SelectMany(o => o.ArgumentList?.Arguments ?? default)
            .Select(a => a.Expression)
            .OfType<ObjectCreationExpressionSyntax>()
            .Where(inner => inner.Type is IdentifierNameSyntax id && id.Identifier.Text.Contains("Reporter"))
            .Select(inner => ((IdentifierNameSyntax)inner.Type).Identifier.Text)
            .Distinct()
            .Count();

    private static bool MentionsLiterals(SyntaxNode node, params string[] needles)
    {
        var text = node.ToFullString();
        return needles.All(n => text.Contains($"\"{n}\""));
    }

    private static bool HasMethodNamed(InterfaceDeclarationSyntax iface, string name)
        => iface.Members.OfType<MethodDeclarationSyntax>().Any(m => m.Identifier.Text == name);

    private static bool Implements(ClassDeclarationSyntax cls, string interfaceName)
        => cls.BaseList?.Types.Any(t => t.Type is IdentifierNameSyntax id && id.Identifier.Text == interfaceName) == true;
}

// Builds CodeAnchor lists from syntax nodes. Kept apart so rules read as intent.
internal static class Anchor
{
    public static IReadOnlyList<CodeAnchor> None { get; } = System.Array.Empty<CodeAnchor>();

    public static IReadOnlyList<CodeAnchor> On(SyntaxNode? node, string kind, string label)
        => node == null ? None : new[] { From(node, kind, label) };

    public static IReadOnlyList<CodeAnchor> Combine(params IReadOnlyList<CodeAnchor>[] groups)
        => groups.SelectMany(g => g).ToList();

    public static CodeAnchor From(SyntaxNode node, string kind, string label)
    {
        var span = node.GetLocation().GetLineSpan();
        return new CodeAnchor(
            span.StartLinePosition.Line + 1,
            span.StartLinePosition.Character + 1,
            span.EndLinePosition.Line + 1,
            span.EndLinePosition.Character + 1,
            kind, label);
    }
}

// 1. A formatter class of its own holds the PASS/FAIL words.
internal sealed class FormatterExtractedRule : IMilestoneRule
{
    public int MilestoneId => 1;

    public (bool Passed, IReadOnlyList<CodeAnchor> Anchors) Evaluate(CapstoneSyntax s)
    {
        var passed = s.FormatterClass != null;
        var anchors = passed
            ? Anchor.None
            : Anchor.On(s.PassFailLiteralInRunner()?.Parent, "problem", "this PASS/FAIL logic wants its own class");
        return (passed, anchors);
    }
}

// 2. TestRunner no longer decides the words.
internal sealed class RunnerStopsFormattingRule : IMilestoneRule
{
    public int MilestoneId => 2;

    public (bool Passed, IReadOnlyList<CodeAnchor> Anchors) Evaluate(CapstoneSyntax s)
    {
        var passed = s.Runner != null && !s.RunnerMentions("PASS", "FAIL");
        var anchors = passed
            ? Anchor.None
            : Anchor.On(s.PassFailLiteralInRunner()?.Parent, "problem", "TestRunner still decides the words here");
        return (passed, anchors);
    }
}

// 3. The formatter is injected, never built inside TestRunner.
internal sealed class InjectFormatterRule : IMilestoneRule
{
    public int MilestoneId => 3;

    public (bool Passed, IReadOnlyList<CodeAnchor> Anchors) Evaluate(CapstoneSyntax s)
    {
        var creation = s.CreationInRunner("Formatter");
        var takesFormatter = s.FormatterClass != null
            && s.RunnerConstructorTakesType(s.FormatterClass.Identifier.Text);
        var passed = takesFormatter && creation == null;
        if (passed) return (true, Anchor.None);

        var ctor = s.RunnerConstructor;
        var anchors = Anchor.Combine(
            Anchor.On(creation, "problem", "you build the formatter by hand here"),
            Anchor.On((SyntaxNode?)ctor ?? s.Runner, "target",
                ctor != null ? "let it arrive through this constructor" : "a constructor goes here to receive it"));
        return (false, anchors);
    }
}

// 4. A reporter interface exists to depend on.
internal sealed class ReporterInterfaceRule : IMilestoneRule
{
    public int MilestoneId => 4;

    public (bool Passed, IReadOnlyList<CodeAnchor> Anchors) Evaluate(CapstoneSyntax s)
    {
        var passed = s.ReporterInterface != null;
        var anchors = passed
            ? Anchor.None
            : Anchor.On(s.ConsoleAccessInRunner(), "problem", "this console destination wants to become an interface");
        return (passed, anchors);
    }
}

// 5. TestRunner depends on the injected interface and never touches the console.
internal sealed class InjectReporterRule : IMilestoneRule
{
    public int MilestoneId => 5;

    public (bool Passed, IReadOnlyList<CodeAnchor> Anchors) Evaluate(CapstoneSyntax s)
    {
        var creation = s.CreationInRunner("Reporter");
        var console = s.ConsoleAccessInRunner();
        var passed = s.RunnerConstructorTakesInterface() && creation == null && console == null;
        if (passed) return (true, Anchor.None);

        var ctor = s.RunnerConstructor;
        var anchors = Anchor.Combine(
            Anchor.On((SyntaxNode?)creation ?? console, "problem", "TestRunner is welded to one destination here"),
            Anchor.On((SyntaxNode?)ctor ?? s.Runner, "target",
                ctor != null ? "inject an IReporter through this constructor" : "a constructor goes here to receive an IReporter"));
        return (false, anchors);
    }
}

// 6. A second reporter exists behind the same interface.
internal sealed class SecondReporterRule : IMilestoneRule
{
    public int MilestoneId => 6;

    // Nothing to point at - the student must add a new class.
    public (bool Passed, IReadOnlyList<CodeAnchor> Anchors) Evaluate(CapstoneSyntax s)
        => (s.ReporterImplementerCount() >= 2, Anchor.None);
}

// 7. TestRunner is run with two different reporter types.
internal sealed class ProveSubstitutabilityRule : IMilestoneRule
{
    public int MilestoneId => 7;

    public (bool Passed, IReadOnlyList<CodeAnchor> Anchors) Evaluate(CapstoneSyntax s)
    {
        var passed = s.DistinctInjectedReporterTypes() >= 2;
        var anchors = passed
            ? Anchor.None
            : Anchor.On(s.RunnerCreations().FirstOrDefault(), "problem", "only one reporter is wired up - run a second, different one too");
        return (passed, anchors);
    }
}
