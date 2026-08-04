using System.Reflection;
using System.Text.Json;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;

namespace CodeLab.Host;

public class CompileResult
{
    public bool Compiled { get; set; }
    public string Output { get; set; } = "";
    public string? RuntimeError { get; set; }
    public List<CompileError> Errors { get; set; } = new();

    // Diagnostics that did NOT stop the build but almost always mean the code
    // does not do what the writer thought. Kept apart from Errors so a run that
    // compiles is never reported as a failure - these are read after the output.
    public List<CompileError> Warnings { get; set; } = new();
}

public record CompileError(int? Line, int? Column, string? Friendly, string Raw, string? Why = null);

public class CompilerService
{
    private readonly HttpClient _http;
    private List<MetadataReference>? _references;

    public CompilerService(HttpClient http) => _http = http;

    public bool Ready => _references != null;

    // The metadata references gathered by InitAsync, shared with the tracer so
    // it compiles the instrumented program against the same runtime.
    public IReadOnlyList<MetadataReference> References => _references ?? new List<MetadataReference>();

    public async Task InitAsync()
    {
        if (_references != null) return;

        var refs = new List<MetadataReference>();
        var bootJson = await _http.GetStringAsync("_framework/blazor.boot.json");
        using var doc = JsonDocument.Parse(bootJson);

        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        CollectAssemblyNames(doc.RootElement, names);

        foreach (var name in names)
        {
            try
            {
                var bytes = await _http.GetByteArrayAsync($"_framework/{name}");
                refs.Add(MetadataReference.CreateFromImage(bytes));
            }
            catch
            {
                // Skip anything that is not a readable managed assembly.
            }
        }

        _references = refs;
    }

    private static void CollectAssemblyNames(JsonElement element, HashSet<string> names)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var prop in element.EnumerateObject())
                {
                    if (prop.Name.EndsWith(".dll", StringComparison.OrdinalIgnoreCase)
                        && IsReferenceCandidate(prop.Name))
                    {
                        names.Add(prop.Name);
                    }
                    CollectAssemblyNames(prop.Value, names);
                }
                break;
            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray())
                    CollectAssemblyNames(item, names);
                break;
        }
    }

    private static bool IsReferenceCandidate(string name)
    {
        if (name.StartsWith("System.", StringComparison.OrdinalIgnoreCase))
            return true;

        return name.Equals("System.dll", StringComparison.OrdinalIgnoreCase)
            || name.Equals("mscorlib.dll", StringComparison.OrdinalIgnoreCase)
            || name.Equals("netstandard.dll", StringComparison.OrdinalIgnoreCase)
            || name.Equals("Microsoft.CSharp.dll", StringComparison.OrdinalIgnoreCase);
    }

    public async Task<CompileResult> RunAsync(string code)
    {
        await InitAsync();

        var tree = CSharpSyntaxTree.ParseText(code);

        // A single misplaced brace/paren makes the parser misread everything after
        // it, producing a cascade of misleading semantic errors. When the code does
        // not even parse, only the syntax errors are real - show those alone.
        var syntaxErrors = tree.GetDiagnostics()
            .Where(d => d.Severity == DiagnosticSeverity.Error)
            .ToList();
        if (syntaxErrors.Count > 0)
        {
            return new CompileResult { Compiled = false, Errors = ToErrors(syntaxErrors) };
        }

        var compilation = CSharpCompilation.Create(
            "UserProgram",
            new[] { tree },
            _references,
            new CSharpCompilationOptions(OutputKind.ConsoleApplication, concurrentBuild: false));

        using var ms = new MemoryStream();
        var emit = compilation.Emit(ms);

        if (!emit.Success)
        {
            return new CompileResult
            {
                Compiled = false,
                Errors = ToErrors(emit.Diagnostics
                    .Where(d => d.Severity == DiagnosticSeverity.Error)),
            };
        }

        var warnings = ToErrors(emit.Diagnostics.Where(IsTeachingWarning));

        ms.Seek(0, SeekOrigin.Begin);
        var assembly = Assembly.Load(ms.ToArray());
        var entry = assembly.EntryPoint;
        if (entry == null)
        {
            return new CompileResult
            {
                Compiled = false,
                Errors = { new CompileError(null, null, "Your program needs a Main method to run.", "No Main method was found to run.") },
                Warnings = warnings,
            };
        }

        var originalOut = Console.Out;
        var writer = new StringWriter();
        Console.SetOut(writer);
        try
        {
            var parameters = entry.GetParameters().Length == 0
                ? null
                : new object[] { Array.Empty<string>() };
            entry.Invoke(null, parameters);
        }
        catch (Exception ex)
        {
            return new CompileResult
            {
                Compiled = true,
                Output = writer.ToString(),
                RuntimeError = (ex.InnerException ?? ex).Message,
                Warnings = warnings,
            };
        }
        finally
        {
            Console.SetOut(originalOut);
        }

        return new CompileResult { Compiled = true, Output = writer.ToString(), Warnings = warnings };
    }

    private static List<CompileError> ToErrors(IEnumerable<Diagnostic> diagnostics)
        => diagnostics
            .Select(d =>
            {
                var pos = d.Location.GetLineSpan().StartLinePosition;
                var line = d.Location.IsInSource ? pos.Line + 1 : (int?)null;
                var col = d.Location.IsInSource ? pos.Character + 1 : (int?)null;
                return new CompileError(line, col, FriendlyHint(d.Id), d.GetMessage(), WhyHint(d.Id));
            })
            .GroupBy(e => (e.Line, e.Raw))
            .Select(g => g.First())
            .OrderBy(e => e.Line ?? int.MaxValue)
            .ThenBy(e => e.Column ?? int.MaxValue)
            .Take(6)
            .ToList();

    // Warnings worth interrupting a learner for. The bar is high on purpose: a
    // wall of advisory noise teaches nothing, so this lists only diagnostics that
    // mean "this line does not do what you think it does". Everything else stays
    // hidden - the compiler is allowed to be quiet about style.
    private static readonly HashSet<string> TeachingWarningIds = new()
    {
        "CS1717", // assignment made to same variable
        "CS1718", // comparison made to same variable
        "CS0162", // unreachable code detected
        "CS0164", // label declared but never used
        "CS0168", // variable declared but never used
        "CS0169", // private field never used
        "CS0219", // variable assigned but its value is never used
        "CS0414", // private field assigned but its value is never used
        "CS8618", // non-nullable field is uninitialised
        "CS0472", // the result of the comparison is always the same
        "CS0652", // comparison to integral constant is useless
    };

    private static bool IsTeachingWarning(Diagnostic d)
        => d.Severity == DiagnosticSeverity.Warning && TeachingWarningIds.Contains(d.Id);

    internal static string? FriendlyHint(string diagnosticId) => diagnosticId switch
    {
        "CS1002" => "Looks like a missing semicolon ( ; ) at the end of a statement.",
        "CS1513" => "Looks like a missing closing brace } somewhere.",
        "CS1514" => "Looks like a missing opening brace { somewhere.",
        "CS1026" => "Looks like a missing closing parenthesis ) .",
        "CS1003" => "A symbol is missing or out of place here.",
        "CS1525" => "Something is off in an expression - maybe an extra or missing symbol.",
        "CS0246" => "C# does not recognise a type name here. Check the spelling, or that the class/interface is defined.",
        "CS0103" => "C# does not recognise a name here. Is it spelled the same as where you declared it?",
        "CS0117" => "That member does not exist on the type. Check the method or property name.",
        "CS0161" => "A method that returns a value is missing a return on some path.",
        "CS0535" => "A class says it implements an interface but is missing one of its methods.",
        "CS0759" => "Check the method signature - it may not match what is expected.",
        "CS0201" => "This line computes a value but does nothing with it. A statement has to DO something (assign, call a method, or create an object). If you meant to return it, add 'return' in front. If this is a one-line method body, use '=> value;' instead of '{ value; }'.",
        "CS0029" => "The value on the right is a different type than the left side expects. For example you cannot put a string into a bool. Make the types match - check what the method or variable was declared to be.",
        "CS0030" => "These two types cannot be converted into each other. Check that you are returning the type the method promised.",
        "CS0266" => "The types are related but C# will not convert automatically because it could lose data. Either change the declared type, or convert explicitly.",
        "CS0508" => "This override returns a different type than the method it overrides. The return types must match exactly.",
        "CS0738" => "This class implements the interface method but with a different return type. Match the return type declared in the interface.",
        "CS0407" => "The method's return type does not match what is expected here. Check the interface or delegate it must fit.",
        "CS0127" => "This method is declared to return nothing (void), but you wrote 'return' with a value. Either remove the value, or change the return type.",
        "CS0106" => "A modifier like 'public' or 'abstract' is not allowed in this place. Interface members do not need 'public', and 'abstract' belongs on the class, not here.",
        "CS1718" => "Both sides of this comparison are the same thing, so the answer is always the same. One side was probably meant to be something else - a threshold, a limit, the other value you are comparing against.",
        "CS1717" => "This assigns something to itself, which changes nothing. One of the two sides was probably meant to be a different name - this is what happens when a parameter and a field are spelled alike.",
        "CS0162" => "This code can never run. Something above it always returns, breaks or throws first, so nothing below is reachable.",
        "CS0472" or "CS0652" => "This comparison always gives the same answer, so the condition is not really deciding anything. Check the values on each side.",
        "CS0219" => "This variable is given a value that is never read afterwards. Either it is left over from an earlier attempt, or the line that was supposed to use it is missing.",
        "CS0168" => "This variable is declared but never used. Delete it, or use it.",
        "CS0169" or "CS0414" => "This field is never read. An unused field is usually either dead weight to delete, or a sign that the code that should read it was never written.",
        "CS8618" => "This field has no value until someone assigns one, so it starts as null and any use of it would crash. Give it a starting value, or set it in the constructor.",
        _ => null,
    };

    // The concept behind the error. Shown only when the learner opens "Learn why",
    // so it teaches the idea instead of just handing over the fix.
    internal static string? WhyHint(string diagnosticId) => diagnosticId switch
    {
        "CS0201" => "Every statement in C# has to perform an action: store a value, call something, or build an object. Writing a value on its own (like 'passed ? \"PASS\" : \"FAIL\";') calculates an answer and then throws it away, which is almost always a mistake - so the compiler stops you. The two normal ways to USE a value are 'return value;' (hand it back to the caller) or, for a one-line method, the expression body 'Method() => value;'.",
        "CS0029" or "CS0030" or "CS0266" => "C# is statically typed: every variable, parameter and return value has a fixed type decided when you declare it. The compiler checks that the value you provide matches that type, BEFORE the program runs. A string and a bool are unrelated, so it refuses to mix them. The lesson: decide the type first, then make every value that flows into it match.",
        "CS0508" or "CS0738" or "CS0407" or "CS0127" => "An interface (or a base class) is a contract. It promises 'this method exists and returns THIS type'. The implementing class does not get to change that promise - it must return exactly the type the interface declared. If your interface says 'string Format(bool)', every class that implements it must also return a string. The interface decides; the class obeys.",
        "CS0535" => "When a class says ': IMyInterface', it is signing the contract - promising to provide EVERY method the interface lists. Miss one, and the contract is broken, so the compiler refuses. Read the interface as a to-do list the class must complete.",
        "CS0161" => "A method with a return type (anything other than void) promises to give back a value on EVERY possible path through it. If an 'if' returns but the 'else' does not, one path breaks the promise. Make sure every branch ends in a return.",
        "CS0106" => "Interfaces and classes have different rules. Interface members are public by definition, so writing 'public' is redundant. 'abstract' describes a class that cannot be created directly - it belongs on the class declaration, not on members inside an interface.",
        "CS1718" or "CS1717" or "CS0472" or "CS0652" => "The compiler cannot know what you MEANT, but it can see when a line cannot possibly be doing useful work. Comparing a value to itself is always true; assigning a value to itself changes nothing. The program still builds and still runs - it just quietly gives the same answer forever, which is far harder to spot than a crash. This is why a test that passes is not proof: 'hours >= hours' would pass any check that expects the answer it always gives.",
        "CS0162" => "Every line you write is a claim that it should run. Unreachable code breaks that claim, and it is almost never deliberate - usually a return, break or throw above it happens earlier than intended, or an if/else covers more than it looks like it does. Read upwards from the dead line to find what always fires first.",
        "CS0219" or "CS0168" or "CS0169" or "CS0414" => "Unused things are evidence. A variable or field that is written but never read means the code that was supposed to consume it is missing, or that a refactor left debris behind. Neither is harmless: the next reader has to work out whether it matters, and dead state is where stale, wrong values hide. Delete it or finish it - do not leave it.",
        "CS8618" => "C# separates 'a reference that always points at something' from 'a reference that may be null'. A non-nullable field promises the first, so it has to be given a value by the time the constructor finishes. Leaving it unset breaks the promise and the compiler warns rather than letting a null crash surface much later, far from the cause.",
        _ => null,
    };
}
