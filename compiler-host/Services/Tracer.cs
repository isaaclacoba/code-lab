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

        // First normalize expression-bodied methods and constructors into block
        // bodies so the rewriter can step into them and push a call frame - a
        // learner's `Fake(string v) => _value = v;` becomes `{ _value = v; }`, kept
        // on the same lines so the reported line numbers still match the source.
        // Then analyse that normalized tree: decide, per statement, which locals are
        // both in scope and definitely assigned right after it runs. That set is what
        // a step should show, and computing it up front keeps the rewrite mechanical.
        var normalizedRoot = new BodyNormalizer().Visit(tree.GetRoot())!;
        var normalizedTree = tree.WithRootAndOptions(normalizedRoot, tree.Options);

        var analysis = CSharpCompilation.Create("Analysis", new[] { normalizedTree }, references, options);
        var model = analysis.GetSemanticModel(normalizedTree);
        var plan = BuildPlan(normalizedTree, model);

        var instrumented = new Instrumenter(plan).Visit(normalizedTree.GetRoot());
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

    // ---- normalization: expression bodies -> block bodies ----

    // Turns `T M() => expr;` into `T M() { return expr; }` and `C(..) => expr;`
    // into `C(..) { expr; }`, preserving every newline so line numbers are stable.
    // The instrumenter only steps into block bodies, so this is what lets a trace
    // follow a call into a one-line method or constructor.
    private sealed class BodyNormalizer : CSharpSyntaxRewriter
    {
        public override SyntaxNode? VisitMethodDeclaration(MethodDeclarationSyntax node)
        {
            var visited = (MethodDeclarationSyntax)base.VisitMethodDeclaration(node)!;
            if (visited.ExpressionBody is null || visited.Body is not null) return visited;
            var isVoid = visited.ReturnType is PredefinedTypeSyntax pt
                && pt.Keyword.IsKind(SyntaxKind.VoidKeyword);
            var block = BlockFromArrow(visited.ExpressionBody, visited.SemicolonToken, isVoid);
            return visited.WithExpressionBody(null).WithSemicolonToken(default).WithBody(block);
        }

        public override SyntaxNode? VisitConstructorDeclaration(ConstructorDeclarationSyntax node)
        {
            var visited = (ConstructorDeclarationSyntax)base.VisitConstructorDeclaration(node)!;
            if (visited.ExpressionBody is null || visited.Body is not null) return visited;
            var block = BlockFromArrow(visited.ExpressionBody, visited.SemicolonToken, isVoid: true);
            return visited.WithExpressionBody(null).WithSemicolonToken(default).WithBody(block);
        }

        private static BlockSyntax BlockFromArrow(ArrowExpressionClauseSyntax arrow, SyntaxToken semicolon, bool isVoid)
        {
            var expr = arrow.Expression;
            StatementSyntax inner;
            if (expr is ThrowExpressionSyntax te)
                inner = ThrowStatement(te.ThrowKeyword, te.Expression, Token(SyntaxKind.SemicolonToken));
            else if (isVoid)
                inner = ExpressionStatement(expr).WithSemicolonToken(Token(SyntaxKind.SemicolonToken));
            else
                inner = ReturnStatement(
                    Token(SyntaxKind.ReturnKeyword).WithTrailingTrivia(Space),
                    expr,
                    Token(SyntaxKind.SemicolonToken));

            // Keep every newline the arrow spanned so line numbers do not drift:
            // the arrow's leading trivia (any newline before =>) goes on the open
            // brace, its trailing trivia (a space, or the newline when the body sits
            // on the next line) stays right after the open brace, and the semicolon's
            // trailing trivia (the newline after ;) goes on the close brace.
            var open = Token(SyntaxKind.OpenBraceToken)
                .WithLeadingTrivia(arrow.ArrowToken.LeadingTrivia)
                .WithTrailingTrivia(arrow.ArrowToken.TrailingTrivia);
            var close = Token(SyntaxKind.CloseBraceToken)
                .WithLeadingTrivia(Space)
                .WithTrailingTrivia(semicolon.TrailingTrivia);
            return Block(open, SingletonList(inner), close);
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
                if (_plan.TryGetValue(node.Statements[i], out var info))
                {
                    if (Exits(node.Statements[i]))
                    {
                        rebuilt.Add(AtCall(info.Line)); // this frame is paused here now
                        rebuilt.Add(StepCall(info)); // snapshot before control leaves the block
                        rebuilt.Add(visited.Statements[i]);
                    }
                    else
                    {
                        rebuilt.Add(AtCall(info.Line));
                        rebuilt.Add(visited.Statements[i]);
                        rebuilt.Add(StepCall(info));
                    }
                }
                else
                {
                    rebuilt.Add(visited.Statements[i]);
                }
            }
            return visited.WithStatements(List(rebuilt));
        }

        public override SyntaxNode? VisitMethodDeclaration(MethodDeclarationSyntax node)
        {
            var visited = (MethodDeclarationSyntax)base.VisitMethodDeclaration(node)!;
            if (visited.Body is null) return visited;

            var name = node.Identifier.Text;
            var isMain = name == "Main";
            var isStatic = node.Modifiers.Any(SyntaxKind.StaticKeyword);
            var kind = isMain ? "entry" : isStatic ? "static" : "method";
            // Only an instance method has a `this` to point at; a static one must not.
            ExpressionSyntax? receiver = (!isMain && !isStatic) ? ThisExpression() : null;
            var pre = new List<StatementSyntax>();
            if (isMain) pre.Add(HookCall("Begin"));
            pre.Add(EnterCall(name, FirstBodyLine(node.Body), kind, receiver));

            var body = TryFinally(visited.Body.Statements, pre);
            return visited.WithBody(body);
        }

        public override SyntaxNode? VisitConstructorDeclaration(ConstructorDeclarationSyntax node)
        {
            var visited = (ConstructorDeclarationSyntax)base.VisitConstructorDeclaration(node)!;
            if (visited.Body is null) return visited;

            // A constructor is a call too: push a "new Type" frame so a `new Fake(...)`
            // in Main shows the object being built, then unwinds.
            var pre = new List<StatementSyntax> { EnterCall("new " + node.Identifier.Text, FirstBodyLine(node.Body), "ctor", ThisExpression()) };
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
            var firstLine = origGlobals.Count > 0
                ? origGlobals[0].Statement.GetLocation().GetLineSpan().StartLinePosition.Line + 1
                : 1;
            var prelude = new List<StatementSyntax> { HookCall("Begin"), EnterCall("Main", firstLine, "entry", null) };
            foreach (var s in prelude) members.Add(GlobalStatement(s));

            for (var i = 0; i < origGlobals.Count; i++)
            {
                if (_plan.TryGetValue(origGlobals[i].Statement, out var info))
                {
                    if (Exits(origGlobals[i].Statement))
                    {
                        members.Add(GlobalStatement(AtCall(info.Line)));
                        members.Add(GlobalStatement(StepCall(info)));
                        members.Add(globals[i]);
                    }
                    else
                    {
                        members.Add(GlobalStatement(AtCall(info.Line)));
                        members.Add(globals[i]);
                        members.Add(GlobalStatement(StepCall(info)));
                    }
                }
                else
                {
                    members.Add(globals[i]);
                }
            }
            members.Add(GlobalStatement(HookCall("Leave")));

            var others = visited.Members.Where(m => m is not GlobalStatementSyntax);
            return visited.WithMembers(List(members.Concat(others)));
        }

        private static bool Exits(StatementSyntax stmt) => stmt is ReturnStatementSyntax
            or ThrowStatementSyntax or BreakStatementSyntax or ContinueStatementSyntax
            or GotoStatementSyntax or YieldStatementSyntax;

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

        private static ExpressionStatementSyntax AtCall(int line)
            => ExpressionStatement(Invoke("At",
                Argument(LiteralExpression(SyntaxKind.NumericLiteralExpression, Literal(line)))));

        private static ExpressionStatementSyntax EnterCall(string name, int line, string kind, ExpressionSyntax? receiver)
            => ExpressionStatement(Invoke("Enter",
                Argument(LiteralExpression(SyntaxKind.StringLiteralExpression, Literal(name))),
                Argument(LiteralExpression(SyntaxKind.NumericLiteralExpression, Literal(line))),
                Argument(LiteralExpression(SyntaxKind.StringLiteralExpression, Literal(kind))),
                Argument(receiver ?? LiteralExpression(SyntaxKind.NullLiteralExpression))));

        private static int FirstBodyLine(BlockSyntax? body)
        {
            if (body is null) return 1;
            var first = body.Statements.FirstOrDefault();
            var loc = first is not null ? first.GetLocation() : body.OpenBraceToken.GetLocation();
            return loc.GetLineSpan().StartLinePosition.Line + 1;
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
using System.Runtime.CompilerServices;
using System.Text;

internal static class __CLTrace
{
    private sealed class Frame { public string Id = ""; public string Name = ""; public string Kind = ""; public string Recv = ""; public int Line; public Dictionary<string, object?> Vars = new(); public List<string> Order = new(); }
    private sealed class StaticSlot { public string Owner = ""; public string Name = ""; public string Value = ""; }

    private static readonly List<string> _steps = new();
    private static readonly List<Frame> _stack = new();
    private static readonly Dictionary<object, string> _ids = new(ReferenceEqualityComparer.Instance);
    private static readonly Dictionary<object, int> _instanceNo = new(ReferenceEqualityComparer.Instance);
    private static readonly Dictionary<string, int> _typeCount = new();
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
        _steps.Clear(); _stack.Clear(); _ids.Clear(); _instanceNo.Clear(); _typeCount.Clear();
        _budget = budget; _count = 0; _callSeq = 0; _objSeq = 0;
        Truncated = false; Stopped = false;
        _out = new StringWriter();
    }

    public static void Begin()
    {
        _prev = Console.Out;
        Console.SetOut(_out);
    }

    public static void Enter(string name, int line, string kind, object? receiver)
    {
        var frame = new Frame { Id = "f" + (++_callSeq), Name = name, Kind = kind };
        // For an instance call, note which object it runs on ("Cart #1") so several
        // instances of the same type stay tellable apart. Value types box on the way
        // in (a fresh identity each call), so their number would be meaningless - skip.
        if (receiver != null && !receiver.GetType().IsValueType) frame.Recv = LabelOf(receiver);
        frame.Line = line;
        _stack.Add(frame);
        // A call just started: record the fresh frame at its first line so the call
        // stack visibly grows here, before the call's body runs. This is what makes a
        // trace start in Main rather than jumping straight into the first callee.
        if (Stopped) return;
        if (++_count > _budget) { Truncated = true; Stopped = true; throw new __CLStop(); }
        _steps.Add(Snapshot(line));
    }

    public static void Leave()
    {
        if (_stack.Count > 0) _stack.RemoveAt(_stack.Count - 1);
        if (_stack.Count == 0 && _prev != null) Console.SetOut(_prev);
    }

    public static void At(int line)
    {
        if (_stack.Count > 0) _stack[_stack.Count - 1].Line = line;
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
            sb.Append(",\"kind\":").Append(Str(frame.Kind));
            sb.Append(",\"line\":").Append(frame.Line);
            if (frame.Recv.Length > 0) sb.Append(",\"recv\":").Append(Str(frame.Recv));
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

        var statics = new List<StaticSlot>();
        var consts = new List<StaticSlot>();
        CollectStaticFields(statics, consts);
        AppendStaticSlots(sb, "statics", statics);
        AppendStaticSlots(sb, "consts", consts);

        sb.Append(",\"stdout\":").Append(Str(_out.ToString()));
        sb.Append('}');
        return sb.ToString();
    }

    private static void CollectStaticFields(List<StaticSlot> statics, List<StaticSlot> consts)
    {
        Type[] types;
        try
        {
            types = typeof(__CLTrace).Assembly.GetTypes();
        }
        catch (ReflectionTypeLoadException ex)
        {
            var loaded = new List<Type>();
            foreach (var t in ex.Types) if (t != null) loaded.Add(t);
            types = loaded.ToArray();
        }
        catch
        {
            return;
        }

        foreach (var type in types)
        {
            try { if (SkipStaticType(type)) continue; }
            catch { continue; }

            FieldInfo[] fields;
            try
            {
                fields = type.GetFields(BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly);
            }
            catch
            {
                continue;
            }

            foreach (var field in fields)
            {
                try { if (SkipStaticField(type, field)) continue; }
                catch { continue; }

                try
                {
                    if (field.IsLiteral && !field.IsInitOnly)
                    {
                        consts.Add(StaticSlotFor(field, field.GetRawConstantValue()));
                    }
                    else if (field.IsStatic && !field.IsLiteral)
                    {
                        statics.Add(StaticSlotFor(field, field.GetValue(null)));
                    }
                }
                catch
                {
                    // A field read can run user static initialization. Never let that
                    // break tracing; skip the field and keep the snapshot usable.
                }
            }
        }

        SortStaticSlots(statics);
        SortStaticSlots(consts);
    }

    private static bool SkipStaticType(Type type)
    {
        if (type == typeof(__CLTrace) || type.DeclaringType == typeof(__CLTrace)) return true;
        var name = type.FullName ?? type.Name;
        if (name.Contains("<PrivateImplementationDetails>", StringComparison.Ordinal)) return true;
        if (type.Name.Contains("<", StringComparison.Ordinal)) return true;
        return type.IsDefined(typeof(CompilerGeneratedAttribute), inherit: false);
    }

    private static bool SkipStaticField(Type owner, FieldInfo field)
    {
        if (field.Name.Contains("<", StringComparison.Ordinal)) return true;
        if (field.IsDefined(typeof(CompilerGeneratedAttribute), inherit: false)) return true;
        return owner.IsEnum && (field.Name == "value__" || field.IsSpecialName);
    }

    private static StaticSlot StaticSlotFor(FieldInfo field, object? value)
    {
        var owner = field.DeclaringType is null ? "" : TypeName(field.DeclaringType);
        return new StaticSlot { Owner = owner, Name = field.Name, Value = StaticValueText(value) };
    }

    private static void SortStaticSlots(List<StaticSlot> slots)
    {
        slots.Sort((a, b) =>
        {
            var owner = string.Compare(a.Owner, b.Owner, StringComparison.Ordinal);
            return owner != 0 ? owner : string.Compare(a.Name, b.Name, StringComparison.Ordinal);
        });
    }

    private static void AppendStaticSlots(StringBuilder sb, string property, List<StaticSlot> slots)
    {
        sb.Append(",\"").Append(property).Append("\":[");
        for (var i = 0; i < slots.Count; i++)
        {
            if (i > 0) sb.Append(',');
            var slot = slots[i];
            sb.Append("{\"owner\":").Append(Str(slot.Owner));
            sb.Append(",\"name\":").Append(Str(slot.Name));
            sb.Append(",\"value\":").Append(Str(slot.Value));
            sb.Append('}');
        }
        sb.Append(']');
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
        sb.Append(",\"no\":").Append(InstanceNo(obj));
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
        foreach (var fld in t.GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance))
        {
            if (fld.Name.Length > 0 && fld.Name[0] == '<') continue; // compiler-generated auto-property backing field
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

    private static string StaticValueText(object? v)
    {
        if (v is null) return "null";
        if (v is string s) return s;
        var t = v.GetType();
        if (t.IsEnum) return v.ToString() ?? "";
        if (t.IsPrimitive) return Convert.ToString(v, CultureInfo.InvariantCulture) ?? "";
        if (v is decimal dec) return dec.ToString(CultureInfo.InvariantCulture);
        if (!t.IsValueType) return TypeName(t);
        if (v is IFormattable formattable) return formattable.ToString(null, CultureInfo.InvariantCulture) ?? "";
        return v.ToString() ?? "";
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

    // A per-type ordinal so the panel can label objects "Cart #1", "Cart #2" - a
    // stable, human hint that survives across steps (the raw id is not shown).
    private static int InstanceNo(object o)
    {
        if (_instanceNo.TryGetValue(o, out var n)) return n;
        var type = TypeName(o.GetType());
        _typeCount.TryGetValue(type, out var c);
        c++;
        _typeCount[type] = c;
        _instanceNo[o] = c;
        return c;
    }

    private static string LabelOf(object o) => TypeName(o.GetType()) + " #" + InstanceNo(o);

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
