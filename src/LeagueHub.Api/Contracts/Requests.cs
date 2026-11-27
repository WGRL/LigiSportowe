using LeagueHub.Api.Lineups;
using LeagueHub.Api.Scheduling;

namespace LeagueHub.Api.Contracts;

public interface IValid
{
    string? Error();
}

public static class Check
{
    public static bool Len(string? value, int min, int max) =>
        (value?.Trim().Length ?? 0) is var length && length >= min && length <= max;
}

public record Credentials(string? Username, string? Password, string? DisplayName = null);

public record DisplayNameReq(string? DisplayName) : IValid
{
    public string? Error() => Check.Len(DisplayName, 1, 100) ? null : "Nazwa wyświetlana: 1–100 znaków.";
}

public record NameReq(string? Name) : IValid
{
    public string? Error() => Check.Len(Name, 1, 60) ? null : "Nazwa: 1–60 znaków.";
}

public record PlayerReq(string? Username) : IValid
{
    public string? Error() => Check.Len(Username, 3, 32) ? null : "Podaj nazwę użytkownika zawodnika.";
}

public record CaptainReq(long UserId);

public record LeagueReq(string? Name, string? Sport, string? Description) : IValid
{
    public string? Error() => Check.Len(Name, 1, 100) && Check.Len(Sport, 1, 60) && Check.Len(Description, 0, 500)
        ? null : "Nazwa (1–100 znaków) i dyscyplina (1–60) są wymagane, opis do 500 znaków.";
}

public record SeasonReq(string? Name, DateTime? StartsOn, DateTime? EndsOn, int PointsWin, int PointsDraw, int PointsLoss) : IValid
{
    public string? Error() =>
        !Check.Len(Name, 1, 80) ? "Nazwa sezonu: 1–80 znaków."
        : StartsOn > EndsOn ? "Koniec sezonu nie może być przed początkiem."
        : PointsLoss < 0 || PointsDraw < PointsLoss || PointsWin < PointsDraw || PointsWin > 10
            ? "Punkty: 0–10, zwycięstwo ≥ remis ≥ porażka." : null;
}

public record GameReq(long HomeTeamId, long AwayTeamId, DateTime StartsAt, string? Venue,
    string? LineupFormat = null, string? LineupStrategy = null) : IValid
{
    public string Format => LineupFormat ?? LineupTemplates.DefaultFormat;
    public string Strategy => LineupStrategy ?? LineupTemplates.DefaultStrategy;

    public string? Error() =>
        HomeTeamId <= 0 || AwayTeamId <= 0 || HomeTeamId == AwayTeamId ? "Wybierz dwie różne drużyny."
        : StartsAt == default ? "Podaj termin meczu."
        : !Check.Len(Venue, 0, 120) ? "Miejsce: do 120 znaków."
        : LineupTemplates.Format(Format) is null ? "Nieznany format kadry meczowej."
        : LineupTemplates.Strategy(Strategy) is null ? "Nieznany sposób doboru zawodników." : null;
}

/// <summary>
/// Generowanie terminarza sezonu z aktualnych drużyn ligi. Existing — co zrobić z meczami, które już są w sezonie:
/// "keep" = zostaw je i dopisz brakujące pary, "replace" = usuń nierozegrane i ułóż je od nowa (rozegrane zostają zawsze).
/// </summary>
public record ScheduleReq(string? System, DateTime FirstGameAt, int RoundIntervalDays, int GameIntervalMinutes, string? Venue,
    string? LineupFormat = null, string? LineupStrategy = null, string? Existing = null) : IValid
{
    public string Format => LineupFormat ?? LineupTemplates.DefaultFormat;
    public string Strategy => LineupStrategy ?? LineupTemplates.DefaultStrategy;

    public string? Error() =>
        RoundRobin.System(System) is null ? "Wybierz system rozgrywek."
        : FirstGameAt == default ? "Podaj termin pierwszego meczu."
        : RoundIntervalDays is < 0 or > 60 ? "Odstęp między kolejkami: 0–60 dni."
        : GameIntervalMinutes is < 0 or > 1440 ? "Odstęp między meczami kolejki: 0–1440 minut."
        : RoundIntervalDays == 0 && GameIntervalMinutes == 0 ? "Turniej jednego dnia (0 dni między kolejkami) wymaga odstępu między meczami."
        : !Check.Len(Venue, 0, 120) ? "Miejsce: do 120 znaków."
        : Existing is not (null or "keep" or "replace") ? "Nieznana opcja dla istniejących meczów."
        : LineupTemplates.Format(Format) is null ? "Nieznany format kadry meczowej."
        : LineupTemplates.Strategy(Strategy) is null ? "Nieznany sposób doboru zawodników." : null;
}

/// <summary>Ponowne losowanie kadry: TeamId = null → obie drużyny (tylko organizator).</summary>
public record DrawReq(long? TeamId, string? Strategy) : IValid
{
    public string? Error() => Strategy is not null && LineupTemplates.Strategy(Strategy) is null
        ? "Nieznany sposób doboru zawodników." : null;
}

public record ResultReq(int? HomeScore, int? AwayScore) : IValid
{
    public string? Error() => (HomeScore, AwayScore) is (null, null) or (>= 0 and <= 999, >= 0 and <= 999)
        ? null : "Podaj oba wyniki (0–999) albo zostaw oba puste, aby cofnąć wynik.";
}