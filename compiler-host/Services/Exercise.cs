namespace CodeLab.Host;

// The generic, language-neutral contract between the code-lab host and an
// exercise. The host knows nothing about any specific exercise: it loads one
// implementation of this interface at startup and drives its milestones. A
// course (or any consumer) supplies the exercise by compiling its own
// implementation into the host via the ExerciseSource build property.

// A single guided hint. Code is optional sample text shown under the hint.
public record Hint(string Text, string? Code = null);

// A span the host can highlight in the editor. Kind: "problem" (red) or
// "target" (green). Lines/columns are 1-based.
public record CodeAnchor(int StartLine, int StartCol, int EndLine, int EndCol, string Kind, string Label);

// One step of the exercise the learner works toward.
public record Milestone(int Id, string Title, string PassMessage, string TodoMessage, Hint[] Hints, string? Why = null, string? Diagram = null);

// The evaluated state of a milestone for a given submission.
public record MilestoneResult(int Id, string Title, bool Passed, string Detail, IReadOnlyList<CodeAnchor> Anchors);

public interface IExercise
{
    // Heading shown above the editor.
    string Title { get; }

    // One-line summary under the heading.
    string Lead { get; }

    // A short paragraph describing the task (rendered as the brief).
    string Brief { get; }

    // The code the editor opens with.
    string StarterCode { get; }

    // A complete worked solution, revealed only when the learner gives up.
    string ReferenceSolution { get; }

    // The milestones, in display order.
    IReadOnlyList<Milestone> Milestones { get; }

    // Evaluate a submission against every milestone.
    IReadOnlyList<MilestoneResult> Check(string code);
}
