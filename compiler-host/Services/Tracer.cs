using System.Collections.Immutable;
using System.Reflection;
using System.Text.Json;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using static Microsoft.CodeAnalysis.CSharp.SyntaxFactory;

namespace CodeLab.Host;

// The result of tracing a program. When Compiled is false the Errors explain why
// (reusing the same friendly CompileError shape as CompilerService). When it is
// true, TraceJson holds an ExecTrace payload whose shape matches the TypeScript
// contract in src/core/exec-tracer-model.ts, ready to hand to traceToSteps.
public record TraceResult(
    bool Compiled,
    string? TraceJson,
    string? RuntimeError,
    List<CompileError> Errors);

// A source-instrumentation tracer: it rewrites the learner's syntax tree so each
// statement is followed by a hook that records the current line, the in-scope
// locals, and the objects they point at. Running the rewritten program therefore
// produces a step-by-step ExecTrace with no debugger and no WASM-specific code -
// which is what lets the same core be verified with a plain dotnet console host.
public static class Tracer
{
    public const int DefaultBudget = 400;

    public static TraceResult Trace(string code, IReadOnlyList<MetadataReference> references, int budget = DefaultBudget)
    {
        var tree = CSharpSyntaxTree.ParseText(code);

        var syntaxErrors = tree.GetDiagnostics()
            .Where(d => d.Severity == DiagnosticSeverity.Error)
            .ToList();
        if (syntaxErrors.Count > 0)
            return new TraceResult(false, null, null, ToErrors(syntaxErrors));

        var options = new CSharpCompilationOptions(OutputKind.ConsoleApplication, concurrentBuild: false);

        // Analyse the ORIGINAL tree: decide, per statement, which locals are both
        // in scope and definitely assigned right after it runs. That set is what a
        // step should show, and computing it up front keeps the rewrite mechanical.
        var analysis = CSharpCompilation.Create("Analysis", new[] { tree }, references, options);
        var model = analysis.GetSemanticModel(tree);
        var plan = BuildPlan(tree, model);

        var instrumented = new Instrumenter(plan).Visit(tree.GetRoot());
        var runtimeTree = CSharpSyntaxTree.ParseText(RuntimeSource);
        var userTree = CSharpSyntaxTree.ParseText(instrumented.ToFullString());

        var compilation = CSharpCompilation.Create(
            "TracedProgram",
            new[] { userTree, runtimeTree },
            references,
            options);

        using var ms = new MemoryStream();
        var emit = compilation.Emit(ms);
        if (!emit.Success)
        {
            // If instrumentation somehow broke compilation, fall back to reporting
            // the learner's own errors from a clean compile of their code.
            var clean = CSharpCompilation.Create("Plain", new[] { tree }, references, options);
            using var pms = new MemoryStream();
            var plainEmit = clean.Emit(pms);
            var diags = (plainEmit.Success ? emit.Diagnostics : plainEmit.Diagnostics)
                .Where(d => d.Severity == DiagnosticSeverity.Error);
            return new TraceResult(false, null, null, ToErrors(diags));
        }

        ms.Seek(0, SeekOrigin.Begin);
        var assembly = Assembly.Load(ms.ToArray());
        var entry = assembly.EntryPoint;
        if (entry == null)
            return new TraceResult(false, null, null,
                new List<CompileError> { new(null, null, "Your program needs a Main method to run.", "No Main method was found to run.") });

        var trace = assembly.GetType("__CLTrace")!;
        trace.GetMethod("Reset")!.Invoke(null, new object[] { budget });

        string? runtimeError = null;
        var originalOut = Console.Out;
        try
        {
            var parameters = entry.GetParameters().Length == 0 ? null : new object[] { Array.Empty<string>() };
            entry.Invoke(null, parameters);
        }
        catch (TargetInvocationException tie)
        {
            var inner = tie.InnerException ?? tie;
            var stopped = (bool)trace.GetProperty("Stopped")!.GetValue(null)!;
            if (!stopped)
                runtimeError = inner.Message;
        }
        catch (Exception ex)
        {
            runtimeError = ex.Message;
        }
        finally
        {
            Console.SetOut(originalOut);
        }

        var stepsJson = (string)trace.GetMethod("Dump")!.Invoke(null, null)!;
        var truncated = (bool)trace.GetProperty("Truncated")!.GetValue(null)!;

        var traceJson = ComposeTrace(code, stepsJson, truncated);
        return new TraceResult(true, traceJson, runtimeError, new List<CompileError>());
    }

    // Wrap the runtime's steps array with the source lines and the truncated flag,
    // producing the exact ExecTrace object the TypeScript adapter expects.
    private static string ComposeTrace(string code, string stepsJson, bool truncated)
    {
        var lines = code.Replace("\r\n", "\n").Split('\n');
        using var steps = JsonDocument.Parse(stepsJson);
        using var stream = new MemoryStream();
        using (var w = new Utf8JsonWriter(stream))
        {
            w.WriteStartObject();
            w.WritePropertyName("code");
            w.WriteStartArray();
            foreach (var line in lines) w.WriteStringValue(line);
            w.WriteEndArray();
            w.WritePropertyName("steps");
            steps.RootElement.WriteTo(w);
            if (truncated) w.WriteBoolean("truncated", true);
            w.WriteEndObject();
        }
        return System.Text.Encoding.UTF8.GetString(stream.ToArray());
    }

    // ---- planning: statement -> (line, local names to snapshot) ----

    public sealed record StepPlan(int Line, ImmutableArray<string> Vars);

    private static Dictionary<StatementSyntax, StepPlan> BuildPlan(SyntaxTree tree, SemanticModel model)
    {
        var plan = new Dictionary<StatementSyntax, StepPlan>();
        foreach (var stmt in tree.GetRoot().DescendantNodes().OfType<StatementSyntax>())
        {
            if (!ShouldInstrument(stmt)) continue;
            var line = stmt.GetLocation().GetLineSpan().StartLinePosition.Line + 1;
            plan[stmt] = new StepPlan(line, SnapshotVars(model, stmt));
        }
        return plan;
    }

    private static bool ShouldInstrument(StatementSyntax stmt)
    {
        // Skip pure structure (a block, or the header of a control statement); we
        // instrument the leaf statements they contain instead, and never a Step
        // call we ourselves inserted.
        switch (stmt)
        {
            case BlockSyntax:
                return false;
        }
        // Only statements that live directly inside a block or a global-statement
        // list can safely be followed by another statement.
        return stmt.Parent is BlockSyntax || stmt.Parent is GlobalStatementSyntax || stmt.Parent is CompilationUnitSyntax;
    }

    private static ImmutableArray<string> SnapshotVars(SemanticModel model, StatementSyntax stmt)
    {
        try
        {
            var flow = model.AnalyzeDataFlow(stmt);
            if (flow is null || !flow.Succeeded) return ImmutableArray<string>.Empty;
            var assigned = new HashSet<ISymbol>(flow.DefinitelyAssignedOnExit, SymbolEqualityComparer.Default);

            var inScope = model.LookupSymbols(stmt.Span.End)
                .Where(s => s.Kind == SymbolKind.Local || s.Kind == SymbolKind.Parameter)
                .Where(assigned.Contains)
                .Where(s => s.Locations.Length > 0 && s.Locations[0].IsInSource)
                .GroupBy(s => s.Name)
                .Select(g => g.First())
                .OrderBy(s => s.Locations[0].SourceSpan.Start)
                .Select(s => s.Name)
                .ToImmutableArray();
            return inScope;
        }
        catch
        {
            return ImmutableArray<string>.Empty;
        }
    }

    // ---- the rewriter ----

    private sealed class Instrumenter : CSharpSyntaxRewriter
    {
        private readonly Dictionary<StatementSyntax, StepPlan> _plan;
        public Instrumenter(Dictionary<StatementSyntax, StepPlan> plan) => _plan = plan;

        public override SyntaxNode? VisitBlock(BlockSyntax node)
        {
            var visited = (BlockSyntax)base.VisitBlock(node)!;
            var rebuilt = new List<StatementSyntax>();
            for (var i = 0; i < node.Statements.Count; i++)
            {
                rebuilt.Add(visited.Statements[i]);
                if (_plan.TryGetValue(node.Statements[i], out var info))
                    rebuilt.Add(StepCall(info));
            }
            return visited.WithStatements(List(rebuilt));
        }

        public override SyntaxNode? VisitMethodDeclaration(MethodDeclarationSyntax node)
        {
            var visited = (MethodDeclarationSyntax)base.VisitMethodDeclaration(node)!;
            if (visited.Body is null) return visited;

            var name = node.Identifier.Text;
            var isMain = name == "Main";
            var pre = new List<StatementSyntax>();
            if (isMain) pre.Add(HookCall("Begin"));
            pre.Add(HookCall("Enter", Literal(name)));

            var body = TryFinally(visited.Body.Statements, pre);
            return visited.WithBody(body);
        }

        public override SyntaxNode? VisitCompilationUnit(CompilationUnitSyntax node)
        {
            var visited = (CompilationUnitSyntax)base.VisitCompilationUnit(node)!;
            var globals = visited.Members.OfType<GlobalStatementSyntax>().ToList();
            if (globals.Count == 0) return visited;

            // Top-level statements: bracket them with Begin/Enter ... Leave, and let
            // VisitBlock-style Step insertion be handled here since they are not in a
            // block. We map each original global statement to its plan entry.
            var origGlobals = node.Members.OfType<GlobalStatementSyntax>().ToList();
            var members = new List<MemberDeclarationSyntax>();
            var prelude = new List<StatementSyntax> { HookCall("Begin"), HookCall("Enter", Literal("Main")) };
            foreach (var s in prelude) members.Add(GlobalStatement(s));

            for (var i = 0; i < origGlobals.Count; i++)
            {
                members.Add(globals[i]);
                if (_plan.TryGetValue(origGlobals[i].Statement, out var info))
                    members.Add(GlobalStatement(StepCall(info)));
            }
            members.Add(GlobalStatement(HookCall("Leave")));

            var others = visited.Members.Where(m => m is not GlobalStatementSyntax);
            return visited.WithMembers(List(members.Concat(others)));
        }

        private static BlockSyntax TryFinally(SyntaxList<StatementSyntax> body, List<StatementSyntax> pre)
        {
            var tryBlock = Block(body);
            var fin = FinallyClause(Block(HookCall("Leave")));
            var tryStmt = TryStatement().WithBlock(tryBlock).WithFinally(fin);
            return Block(pre.Append<StatementSyntax>(tryStmt));
        }

        private static ExpressionStatementSyntax StepCall(StepPlan info)
        {
            var args = new List<ArgumentSyntax>
            {
                Argument(LiteralExpression(SyntaxKind.NumericLiteralExpression, Literal(info.Line))),
            };
            foreach (var v in info.Vars)
            {
                args.Add(Argument(LiteralExpression(SyntaxKind.StringLiteralExpression, Literal(v))));
                args.Add(Argument(CastExpression(
                    PredefinedType(Token(SyntaxKind.ObjectKeyword)),
                    IdentifierName(v))));
            }
            return ExpressionStatement(Invoke("Step", args.ToArray()));
        }

        private static ExpressionStatementSyntax HookCall(string method, SyntaxToken? literal = null)
        {
            var args = literal is null
                ? Array.Empty<ArgumentSyntax>()
                : new[] { Argument(LiteralExpression(SyntaxKind.StringLiteralExpression, literal.Value)) };
            return ExpressionStatement(Invoke(method, args));
        }

        private static InvocationExpressionSyntax Invoke(string method, params ArgumentSyntax[] args)
            => InvocationExpression(
                    MemberAccessExpression(
                        SyntaxKind.SimpleMemberAccessExpression,
                        IdentifierName("__CLTrace"),
                        IdentifierName(method)))
                .WithArgumentList(ArgumentList(SeparatedList(args)));
    }

    private static List<CompileError> ToErrors(IEnumerable<Diagnostic> diagnostics)
        => diagnostics
            .Select(d =>
            {
                var pos = d.Location.GetLineSpan().StartLinePosition;
                var line = d.Location.IsInSource ? pos.Line + 1 : (int?)null;
                var col = d.Location.IsInSource ? pos.Character + 1 : (int?)null;
                return new CompileError(line, col, null, d.GetMessage());
            })
            .GroupBy(e => (e.Line, e.Raw))
            .Select(g => g.First())
            .OrderBy(e => e.Line ?? int.MaxValue)
            .Take(6)
            .ToList();

    // The runtime helper, compiled alongside the learner's code as a second tree.
    // It maintains a shadow call stack and an object->id registry, and snapshots a
    // JSON-ready step each time a hook fires. It is deliberately reflection-only so
    // it never needs a reference to the host.
    private const string RuntimeSource =
""""

using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;

internal static class __CLTrace
{
    private sealed class Frame { public string Id = ""; public string Name = ""; public Dictionary<string, object?> Vars = new(); public List<string> Order = new(); }

    private static readonly List<string> _steps = new();
    private static readonly List<Frame> _stack = new();
    private static readonly Dictionary<object, string> _ids = new(ReferenceEqualityComparer.Instance);
    private static StringWriter _out = new();
    private static TextWriter? _prev;
    private static int _budget;
    private static int _count;
    private static int _callSeq;
    private static int _objSeq;

    public static bool Truncated { get; private set; }
    public static bool Stopped { get; private set; }

    public static void Reset(int budget)
    {
        _steps.Clear(); _stack.Clear(); _ids.Clear();
        _budget = budget; _count = 0; _callSeq = 0; _objSeq = 0;
        Truncated = false; Stopped = false;
        _out = new StringWriter();
    }

    public static void Begin()
    {
        _prev = Console.Out;
        Console.SetOut(_out);
    }

    public static void Enter(string name)
    {
        _stack.Add(new Frame { Id = "f" + (++_callSeq), Name = name });
    }

    public static void Leave()
    {
        if (_stack.Count > 0) _stack.RemoveAt(_stack.Count - 1);
        if (_stack.Count == 0 && _prev != null) Console.SetOut(_prev);
    }

    public static void Step(int line, params object?[] pairs)
    {
        if (Stopped) return;
        if (++_count > _budget) { Truncated = true; Stopped = true; throw new __CLStop(); }

        if (_stack.Count > 0)
        {
            var top = _stack[_stack.Count - 1];
            for (var i = 0; i + 1 < pairs.Length; i += 2)
            {
                var key = (string)pairs[i]!;
                if (!top.Vars.ContainsKey(key)) top.Order.Add(key);
                top.Vars[key] = pairs[i + 1];
            }
        }

        _steps.Add(Snapshot(line));
    }

    private static string Snapshot(int line)
    {
        var sb = new StringBuilder();
        sb.Append('{');
        sb.Append("\"line\":").Append(line);

        var heap = new List<string>();
        var seen = new HashSet<object>(ReferenceEqualityComparer.Instance);

        sb.Append(",\"frames\":[");
        for (var f = 0; f < _stack.Count; f++)
        {
            if (f > 0) sb.Append(',');
            var frame = _stack[f];
            sb.Append('{');
            sb.Append("\"id\":").Append(Str(frame.Id));
            sb.Append(",\"name\":").Append(Str(frame.Name));
            sb.Append(",\"vars\":[");
            for (var v = 0; v < frame.Order.Count; v++)
            {
                if (v > 0) sb.Append(',');
                var name = frame.Order[v];
                var val = frame.Vars[name];
                sb.Append("{\"name\":").Append(Str(name));
                AppendValue(sb, val, heap, seen);
                sb.Append('}');
            }
            sb.Append("]}");
        }
        sb.Append(']');

        sb.Append(",\"heap\":[");
        for (var h = 0; h < heap.Count; h++)
        {
            if (h > 0) sb.Append(',');
            sb.Append(heap[h]);
        }
        sb.Append(']');

        sb.Append(",\"stdout\":").Append(Str(_out.ToString()));
        sb.Append('}');
        return sb.ToString();
    }

    private static void AppendValue(StringBuilder sb, object? val, List<string> heap, HashSet<object> seen)
    {
        if (val is null) { sb.Append(",\"value\":\"null\""); return; }
        if (IsInline(val, out var text)) { sb.Append(",\"value\":").Append(Str(text)); return; }

        var id = IdOf(val);
        sb.Append(",\"ref\":").Append(Str(id));
        if (seen.Add(val)) heap.Add(ObjectCard(val, id));
    }

    private static string ObjectCard(object obj, string id)
    {
        var t = obj.GetType();
        var sb = new StringBuilder();
        sb.Append("{\"id\":").Append(Str(id));
        sb.Append(",\"type\":").Append(Str(TypeName(t)));
        sb.Append(",\"fields\":[");
        var first = true;
        foreach (var (name, value) in Members(obj, t))
        {
            if (!first) sb.Append(',');
            first = false;
            sb.Append('[').Append(Str(name)).Append(',').Append(Str(FieldText(value))).Append(']');
        }
        sb.Append("]}");
        return sb.ToString();
    }

    private static IEnumerable<(string, object?)> Members(object obj, Type t)
    {
        foreach (var p in t.GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            if (!p.CanRead || p.GetIndexParameters().Length > 0) continue;
            object? v; try { v = p.GetValue(obj); } catch { continue; }
            yield return (p.Name, v);
        }
        foreach (var fld in t.GetFields(BindingFlags.Public | BindingFlags.Instance))
        {
            object? v; try { v = fld.GetValue(obj); } catch { continue; }
            yield return (fld.Name, v);
        }
    }

    private static string FieldText(object? v)
    {
        if (v is null) return "null";
        if (IsInline(v, out var text)) return text;
        return TypeName(v.GetType());
    }

    private static bool IsInline(object v, out string text)
    {
        switch (v)
        {
            case string s: text = "\"" + Escape(s) + "\""; return true;
            case char c: text = "'" + c + "'"; return true;
            case bool b: text = b ? "true" : "false"; return true;
        }
        var t = v.GetType();
        if (t.IsEnum) { text = v.ToString() ?? ""; return true; }
        if (t.IsPrimitive) { text = Convert.ToString(v, CultureInfo.InvariantCulture) ?? ""; return true; }
        if (v is decimal dec) { text = dec.ToString(CultureInfo.InvariantCulture); return true; }
        if (v is IEnumerable en && v is not string)
        {
            var parts = new List<string>();
            var n = 0;
            foreach (var item in en)
            {
                if (n++ >= 12) { parts.Add("..."); break; }
                parts.Add(item is null ? "null" : (IsInline(item, out var it) ? it : TypeName(item.GetType())));
            }
            text = "[" + string.Join(", ", parts) + "]";
            return true;
        }
        if (t.IsValueType) { text = v.ToString() ?? ""; return true; }
        text = ""; return false;
    }

    private static string IdOf(object o)
    {
        if (_ids.TryGetValue(o, out var id)) return id;
        id = "o" + (++_objSeq);
        _ids[o] = id;
        return id;
    }

    private static string TypeName(Type t)
    {
        if (!t.IsGenericType) return t.Name;
        var baseName = t.Name;
        var tick = baseName.IndexOf('`');
        if (tick >= 0) baseName = baseName.Substring(0, tick);
        var args = string.Join(", ", Array.ConvertAll(t.GetGenericArguments(), TypeName));
        return baseName + "<" + args + ">";
    }

    private static string Str(string? s)
    {
        return "\"" + Escape(s ?? "") + "\"";
    }

    private static string Escape(string s)
    {
        var sb = new StringBuilder(s.Length + 2);
        foreach (var ch in s)
        {
            switch (ch)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (ch < ' ') sb.Append("\\u").Append(((int)ch).ToString("x4"));
                    else sb.Append(ch);
                    break;
            }
        }
        return sb.ToString();
    }

    public static string Dump()
    {
        var sb = new StringBuilder();
        sb.Append('[');
        for (var i = 0; i < _steps.Count; i++)
        {
            if (i > 0) sb.Append(',');
            sb.Append(_steps[i]);
        }
        sb.Append(']');
        return sb.ToString();
    }
}

internal sealed class __CLStop : Exception { }

"""";
}
