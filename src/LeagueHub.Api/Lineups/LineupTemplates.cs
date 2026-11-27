namespace LeagueHub.Api.Lineups;

/// <summary>Format kadry meczowej: ilu zawodników zaczyna mecz i ilu może siedzieć na ławce (wg typowych przepisów).</summary>
public sealed record LineupFormat(string Id, string Name, int Starters, int Substitutes);

/// <summary>Sposób wyboru zawodników do kadry spośród składu drużyny.</summary>
public sealed record LineupStrategy(string Id, string Name, string Description);

public static class LineupTemplates
{
    public static readonly IReadOnlyList<LineupFormat> Formats =
    [
        new("football11", "Piłka nożna 11-osobowa", 11, 7),
        new("football7", "Piłka nożna 7-osobowa (orlik)", 7, 5),
        new("futsal", "Futsal / piłka halowa", 5, 9),
        new("basketball", "Koszykówka 5×5", 5, 7),
        new("basketball3x3", "Koszykówka 3×3", 3, 1),
        new("volleyball", "Siatkówka", 6, 8),
        new("handball", "Piłka ręczna", 7, 9),
        new("hockey", "Hokej na lodzie", 6, 14)
    ];

    public static readonly IReadOnlyList<LineupStrategy> Strategies =
    [
        new("rotation", "Rotacja", "Najpierw grają ci, którzy w tym sezonie najrzadziej wychodzili w pierwszym składzie — równe szanse gry."),
        new("regulars", "Podstawowy skład", "Trener stawia na sprawdzonych: pierwszeństwo mają zawodnicy z największą liczbą występów w pierwszym składzie."),
        new("seniority", "Staż w drużynie", "Pierwszeństwo mają zawodnicy, którzy najdłużej są w drużynie."),
        new("random", "Losowanie", "Kadra losowana spośród wszystkich zawodników drużyny.")
    ];

    public const string DefaultFormat = "football11";
    public const string DefaultStrategy = "rotation";

    public static LineupFormat? Format(string? id) => Formats.FirstOrDefault(f => f.Id == id);
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
        IEnumerable<SquadCandidate> candidates, LineupFormat format, LineupStrategy strategy, Random random)
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

        return squad.Take(format.Starters + format.Substitutes)
            .Select((c, i) => new LineupPick(c.UserId, i < format.Starters, i + 1))
            .ToList();
    }
}
