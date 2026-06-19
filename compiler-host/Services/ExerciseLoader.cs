using System.Reflection;

namespace CodeLab.Host;

// Finds the IExercise compiled into this host. Exactly one implementation is
// expected: a consumer supplies its own via the ExerciseSource build property,
// otherwise the built-in SampleExercise is used so the host runs standalone.
public static class ExerciseLoader
{
    public static IExercise Load()
    {
        var type = Assembly.GetExecutingAssembly()
            .GetTypes()
            .Where(t => typeof(IExercise).IsAssignableFrom(t) && t is { IsInterface: false, IsAbstract: false })
            // A supplied exercise wins over the built-in sample.
            .OrderBy(t => t == typeof(SampleExercise) ? 1 : 0)
            .FirstOrDefault();

        return type is null
            ? new SampleExercise()
            : (IExercise)Activator.CreateInstance(type)!;
    }
}
