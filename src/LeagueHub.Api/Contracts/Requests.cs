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

public record Credentials(string? Username, string? Password);

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

public record GameReq(long HomeTeamId, long AwayTeamId, DateTime StartsAt, string? Venue) : IValid
{
    public string? Error() =>
        HomeTeamId <= 0 || AwayTeamId <= 0 || HomeTeamId == AwayTeamId ? "Wybierz dwie różne drużyny."
        : StartsAt == default ? "Podaj termin meczu."
        : Check.Len(Venue, 0, 120) ? null : "Miejsce: do 120 znaków.";
}

public record ResultReq(int? HomeScore, int? AwayScore) : IValid
{
    public string? Error() => (HomeScore, AwayScore) is (null, null) or (>= 0 and <= 999, >= 0 and <= 999)
        ? null : "Podaj oba wyniki (0–999) albo zostaw oba puste, aby cofnąć wynik.";
}