namespace LeagueHub.Api.Scheduling;

/// <summary>System rozgrywek ligowych, z którego generowany jest terminarz.</summary>
public sealed record ScheduleSystem(string Id, string Name, string Description, int Legs);

public sealed record Fixture(int Round, long HomeTeamId, long AwayTeamId);

public static class RoundRobin
{
    public static readonly IReadOnlyList<ScheduleSystem> Systems =
    [
        new("single", "Każdy z każdym (jedna runda)", "Każda para drużyn gra ze sobą raz.", 1),
        new("double", "Mecz i rewanż (dwie rundy)", "Runda jesienna i wiosenna: rewanże w tej samej kolejności, ze zamianą gospodarza.", 2),
        new("triple", "Trzy rundy", "Jak mecz i rewanż, plus trzecia runda — przy małej liczbie drużyn, żeby sezon był dłuższy.", 3)
    ];

    public static ScheduleSystem? System(string? id) => Systems.FirstOrDefault(s => s.Id == id);

    /// <summary>
    /// Terminarz metodą Bergera (rotacja wokół stałej drużyny), jak w ligach piłkarskich.
    /// Przy nieparzystej liczbie drużyn w każdej kolejce jedna pauzuje. Gospodarze rozkładają się równo
    /// (różnica najwyżej 1 mecz u siebie, nie więcej niż 2 kolejki z rzędu w tym samym miejscu).
    /// Kolejne rundy powtarzają pierwszą z zamienionym gospodarzem.
    /// </summary>
    public static IReadOnlyList<Fixture> Generate(IReadOnlyList<long> teams, int legs)
    {
        // Pauza (null) na stałej pozycji daje idealny rozkład u siebie/na wyjeździe przy nieparzystej liczbie drużyn.
        var slots = (teams.Count % 2 == 1 ? new long?[] { null } : []).Concat(teams.Select(t => (long?)t)).ToList();
        var n = slots.Count;
        var firstLeg = new List<Fixture>();

        for (var round = 0; round < n - 1; round++)
        {
            for (var i = 0; i < n / 2; i++)
            {
                if (slots[i] is not { } a || slots[n - 1 - i] is not { } b) continue;
                var aAtHome = i == 0 ? round % 2 == 0 : i % 2 == 0;
                firstLeg.Add(aAtHome ? new(round + 1, a, b) : new(round + 1, b, a));
            }
            // Obrót wszystkich poza pierwszą pozycją.
            var last = slots[n - 1];
            slots.RemoveAt(n - 1);
            slots.Insert(1, last);
        }

        var roundsPerLeg = n - 1;
        return Enumerable.Range(0, legs).SelectMany(leg => firstLeg.Select(f => leg % 2 == 0
                ? f with { Round = f.Round + leg * roundsPerLeg }
                : new Fixture(f.Round + leg * roundsPerLeg, f.AwayTeamId, f.HomeTeamId)))
            .ToList();
    }

    /// <summary>
    /// Usuwa z terminarza mecze, które już istnieją (każdy istniejący mecz „zalicza” jeden mecz terminarza:
    /// najpierw ten sam gospodarz i gość, a jeśli takiego nie ma — ta sama para z zamienionym gospodarzem).
    /// Pozostałe kolejki są numerowane od nowa, po kolei, zaczynając od <paramref name="firstRound"/>.
    /// </summary>
    public static IReadOnlyList<Fixture> WithoutExisting(IReadOnlyList<Fixture> fixtures, IEnumerable<(long Home, long Away)> existing, int firstRound)
    {
        var pending = fixtures.ToList();
        foreach (var (home, away) in existing)
        {
            var index = pending.FindIndex(f => f.HomeTeamId == home && f.AwayTeamId == away);
            if (index < 0) index = pending.FindIndex(f => f.HomeTeamId == away && f.AwayTeamId == home);
            if (index >= 0) pending.RemoveAt(index);
        }

        var renumber = pending.Select(f => f.Round).Distinct().Order()
            .Select((round, i) => (round, i)).ToDictionary(x => x.round, x => firstRound + x.i);
        return pending.Select(f => f with { Round = renumber[f.Round] }).ToList();
    }
}
