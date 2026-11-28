namespace LeagueHub.Api.Lineups;

/// <summary>
/// Rozmiar kadry meczowej z ustawień sezonu. Starters = null → bez podziału: w kadrze jest cała drużyna.
/// Substitutes = null → na ławce siadają wszyscy pozostali zawodnicy.
/// </summary>
public sealed record SquadSize(int? Starters, int? Substitutes);

/// <summary>Sposób wyboru zawodników do kadry spośród składu drużyny.</summary>
public sealed record LineupStrategy(string Id, string Name, string Description);

public static class LineupTemplates
{
    public static readonly IReadOnlyList<LineupStrategy> Strategies =
    [
        new("rotation", "Rotacja", "Najpierw grają ci, którzy w tym sezonie najrzadziej wychodzili w pierwszym składzie — równe szanse gry."),
        new("regulars", "Podstawowy skład", "Trener stawia na sprawdzonych: pierwszeństwo mają zawodnicy z największą liczbą występów w pierwszym składzie."),
        new("seniority", "Staż w drużynie", "Pierwszeństwo mają zawodnicy, którzy najdłużej są w drużynie."),
        new("random", "Losowanie", "Kadra losowana spośród wszystkich zawodników drużyny.")
    ];

    public const string DefaultStrategy = "rotation";

    public static LineupStrategy? Strategy(string? id) => Strategies.FirstOrDefault(s => s.Id == id);
}

/// <summary>Zawodnik drużyny wraz z jego dotychczasowymi występami w sezonie.</summary>
public sealed class SquadCandidate
{
    public long UserId { get; init; }
    public bool IsCaptain { get; init; }
    public DateTime JoinedAt { get; init; }
    public long Starts { get; init; }
    public long Appearances { get; init; }
}

public sealed record LineupPick(long UserId, bool Starter, int Slot);

public static class LineupSelector
{
    /// <summary>
    /// Wybiera kadrę meczową. Kapitan, jeśli jest, zawsze wychodzi w pierwszym składzie.
    /// Przy remisach w kryterium decyduje losowanie, więc ponowne losowanie daje szansę innym.
    /// </summary>
    public static IReadOnlyList<LineupPick> Select(
        IEnumerable<SquadCandidate> candidates, SquadSize size, LineupStrategy strategy, Random random)
    {
        var shuffled = candidates.Select(c => (Candidate: c, Tiebreak: random.Next())).ToList();
        IOrderedEnumerable<(SquadCandidate Candidate, int Tiebreak)> ordered = strategy.Id switch
        {
            "rotation" => shuffled.OrderBy(x => x.Candidate.Starts).ThenBy(x => x.Candidate.Appearances),
            "regulars" => shuffled.OrderByDescending(x => x.Candidate.Starts).ThenByDescending(x => x.Candidate.Appearances),
            "seniority" => shuffled.OrderBy(x => x.Candidate.JoinedAt),
            _ => shuffled.OrderBy(_ => 0)
        };

        var squad = ordered.ThenBy(x => x.Tiebreak).Select(x => x.Candidate).ToList();
        var captain = squad.FindIndex(c => c.IsCaptain);
        if (captain > 0)
        {
            var c = squad[captain];
            squad.RemoveAt(captain);
            squad.Insert(0, c);
        }

        if (size.Starters is not { } starters)
            return squad.Select((c, i) => new LineupPick(c.UserId, true, i + 1)).ToList();
        return squad.Take(starters + (size.Substitutes ?? squad.Count))
            .Select((c, i) => new LineupPick(c.UserId, i < starters, i + 1))
            .ToList();
    }
}
