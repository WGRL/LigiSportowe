using System.Security.Claims;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.RateLimiting;
using Dapper;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using MySqlConnector;

var builder = WebApplication.CreateBuilder(args);
var connectionString = builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException("Ustaw ConnectionStrings__Default (zob. run.sh).");

builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(o =>
{
    o.Cookie.Name = "leaguehub.auth";
    o.Cookie.HttpOnly = true;
    o.Cookie.SameSite = SameSiteMode.Strict;                 // + wymagany JSON => ochrona przed CSRF
    o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
    o.ExpireTimeSpan = TimeSpan.FromHours(8);
    o.SlidingExpiration = true;
    o.Events.OnRedirectToLogin = c => { c.Response.StatusCode = 401; return Task.CompletedTask; };
    o.Events.OnRedirectToAccessDenied = c => { c.Response.StatusCode = 403; return Task.CompletedTask; };
});
builder.Services.AddAuthorization();
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("auth", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1) }));
});

var app = builder.Build();

// Nagłówki bezpieczeństwa + zamiana naruszeń ograniczeń bazy na czytelne błędy 400/409.
app.Use(async (ctx, next) =>
{
    var h = ctx.Response.Headers;
    h.XContentTypeOptions = "nosniff";
    h.XFrameOptions = "DENY";
    h["Referrer-Policy"] = "no-referrer";
    h.ContentSecurityPolicy = "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
    try { await next(); }
    catch (MySqlException e) when (e.Number is 1062 or 1452 or 3819 or 4025)
    {
        var duplicate = e.Number == 1062;
        ctx.Response.StatusCode = duplicate ? 409 : 400;
        await ctx.Response.WriteAsJsonAsync(new
        {
            message = duplicate
                ? "Taki wpis już istnieje (zajęta nazwa lub zawodnik ma już drużynę w tej lidze)."
                : "Niespójne dane (np. ta sama drużyna dwa razy lub drużyna spoza ligi)."
        });
    }
});
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

// Hash porównywany, gdy użytkownik nie istnieje — stały czas odpowiedzi logowania.
var dummyHash = BCrypt.Net.BCrypt.HashPassword(Guid.NewGuid().ToString(), 12);

// Fragmenty SQL: uprawnienia sprawdzane są w tym samym zapytaniu co zmiana danych.
const string TeamAccess = """
    JOIN leagues l ON l.id = t.league_id
    LEFT JOIN team_members cap ON cap.team_id = t.id AND cap.user_id = @uid AND cap.is_captain
    """;
const string CanManageTeam = "(l.organizer_id = @uid OR cap.user_id IS NOT NULL)";
const string GameAccess = "JOIN seasons s ON s.id = g.season_id JOIN leagues l ON l.id = s.league_id";

var api = app.MapGroup("/api");
var user = api.MapGroup("").RequireAuthorization().AddEndpointFilter(async (ctx, next) =>
    ctx.Arguments.OfType<IValid>().Select(a => a.Error()).FirstOrDefault(e => e is not null) is { } error
        ? Bad(error) : await next(ctx));
var auth = api.MapGroup("/auth").RequireRateLimiting("auth");

// ---------- Konta ----------
api.MapGet("/auth/me", async (ClaimsPrincipal u) =>
{
    if (u.Identity?.IsAuthenticated != true)
        return Results.Ok(new { authenticated = false });
    await using var db = Db();
    var profile = await db.QueryFirstAsync<(string Username, string DisplayName)>(
        "SELECT username, display_name AS DisplayName FROM users WHERE id = @id",
        new { id = Uid(u) });
    return Results.Ok(new { authenticated = true, id = Uid(u), username = profile.Username, displayName = profile.DisplayName });
});

auth.MapPost("/register", async (Credentials c) =>
{
    var name = c.Username?.Trim() ?? "";
    var displayName = c.DisplayName?.Trim() ?? name;
    if (name.Length < 3)
        return Bad("Nazwa użytkownika musi mieć co najmniej 3 znaki.");
    if (!Regex.IsMatch(name, "^[A-Za-z0-9_.-]{3,32}$"))
        return Bad("Nazwa użytkownika: 3–32 znaki (litery, cyfry, . _ -).");
    if (!Check.Len(displayName, 1, 100))
        return Bad("Nazwa wyświetlana: 1–100 znaków.");
    if (!IsStrongPassword(c.Password))
        return Bad("Hasło: co najmniej 8 znaków, w tym 1 wielka litera i 1 cyfra.");
    await using var db = Db();
    await db.ExecuteAsync("INSERT INTO users (username, display_name, password_hash) VALUES (@name, @displayName, @hash)",
        new { name, displayName, hash = BCrypt.Net.BCrypt.HashPassword(c.Password, 12) });
    return Results.Created();
});

user.MapPut("/auth/profile", async (DisplayNameReq r, ClaimsPrincipal u) =>
{
    if (r.Error() is { } error)
        return Bad(error);
    return await Exec("UPDATE users SET display_name = TRIM(@DisplayName) WHERE id = @uid",
        P(r, u), "Nie udało się zaktualizować nazwy wyświetlanej.");
});

auth.MapPost("/login", async (Credentials c, HttpContext ctx) =>
{
    await using var db = Db();
    var u = await db.QueryFirstOrDefaultAsync<(long Id, string Name, string Hash)>(
        "SELECT id, username, password_hash FROM users WHERE username = @name",
        new { name = c.Username?.Trim() ?? "" });
    if (!BCrypt.Net.BCrypt.Verify(c.Password ?? "", u.Hash ?? dummyHash)) return Results.Unauthorized();
    await ctx.SignInAsync(new ClaimsPrincipal(new ClaimsIdentity(
        [new Claim(ClaimTypes.NameIdentifier, u.Id.ToString()), new Claim(ClaimTypes.Name, u.Name)],
        CookieAuthenticationDefaults.AuthenticationScheme)));
    return Results.NoContent();
});

api.MapPost("/auth/logout", async (HttpContext ctx) =>
{
    await ctx.SignOutAsync();
    return Results.NoContent();
});

user.MapGet("/me/teams", (ClaimsPrincipal u) => Query("""
    SELECT t.id, t.name, l.id AS leagueId, l.name AS league, m.is_captain AS isCaptain
    FROM team_members m JOIN teams t ON t.id = m.team_id JOIN leagues l ON l.id = t.league_id
    WHERE m.user_id = @uid ORDER BY l.name
    """, new { uid = Uid(u) }));

// ---------- Ligi ----------
api.MapGet("/leagues", () => Query("""
    SELECT l.id, l.name, l.sport, l.description, l.organizer_id AS organizerId,
           u.display_name AS organizer
    FROM leagues l JOIN users u ON u.id = l.organizer_id ORDER BY l.name
    """));

user.MapPost("/leagues", (LeagueReq r, ClaimsPrincipal u) => Insert("""
    INSERT INTO leagues (organizer_id, name, sport, description)
    VALUES (@uid, TRIM(@Name), TRIM(@Sport), NULLIF(TRIM(@Description), ''))
    """, P(r, u)));

user.MapPut("/leagues/{id:long}", (long id, LeagueReq r, ClaimsPrincipal u) => Exec("""
    UPDATE leagues SET name = TRIM(@Name), sport = TRIM(@Sport), description = NULLIF(TRIM(@Description), '')
    WHERE id = @id AND organizer_id = @uid
    """, P(r, u, id)));

// ---------- Sezony ----------
api.MapGet("/leagues/{id:long}/seasons", (long id) => Query("""
    SELECT id, name, starts_on AS startsOn, ends_on AS endsOn, points_win AS pointsWin,
           points_draw AS pointsDraw, points_loss AS pointsLoss, status
    FROM seasons WHERE league_id = @id ORDER BY id DESC
    """, new { id }));

user.MapPost("/leagues/{id:long}/seasons", (long id, SeasonReq r, ClaimsPrincipal u) => Insert("""
    INSERT INTO seasons (league_id, name, starts_on, ends_on, points_win, points_draw, points_loss)
    SELECT id, TRIM(@Name), @StartsOn, @EndsOn, @PointsWin, @PointsDraw, @PointsLoss
    FROM leagues WHERE id = @id AND organizer_id = @uid
    """, P(r, u, id)));

user.MapPut("/seasons/{id:long}", (long id, SeasonReq r, ClaimsPrincipal u) => Exec("""
    UPDATE seasons s JOIN leagues l ON l.id = s.league_id
    SET s.name = TRIM(@Name), s.starts_on = @StartsOn, s.ends_on = @EndsOn,
        s.points_win = @PointsWin, s.points_draw = @PointsDraw, s.points_loss = @PointsLoss
    WHERE s.id = @id AND l.organizer_id = @uid AND s.status = 'preparation'
    """, P(r, u, id)));

// Przygotowanie -> trwający -> zakończony (tylko do przodu).
user.MapPost("/seasons/{id:long}/advance", (long id, ClaimsPrincipal u) => Exec("""
    UPDATE seasons s JOIN leagues l ON l.id = s.league_id
    SET s.status = IF(s.status = 'preparation', 'ongoing', 'finished')
    WHERE s.id = @id AND l.organizer_id = @uid AND s.status <> 'finished'
    """, P(null, u, id)));

api.MapGet("/seasons/{id:long}/standings", (long id) => Query("""
    SELECT t.id, t.name,
           COUNT(r.gf)                  AS played,
           COALESCE(SUM(r.gf > r.ga), 0) AS won,
           COALESCE(SUM(r.gf = r.ga), 0) AS drawn,
           COALESCE(SUM(r.gf < r.ga), 0) AS lost,
           COALESCE(SUM(r.gf), 0)       AS goalsFor,
           COALESCE(SUM(r.ga), 0)       AS goalsAgainst,
           COALESCE(SUM(CASE WHEN r.gf > r.ga THEN s.points_win
                             WHEN r.gf = r.ga THEN s.points_draw
                             WHEN r.gf < r.ga THEN s.points_loss END), 0) AS points
    FROM seasons s
    JOIN (SELECT season_id, home_team_id AS team_id, home_score AS gf, away_score AS ga FROM games WHERE season_id = @id
          UNION ALL
          SELECT season_id, away_team_id, away_score, home_score FROM games WHERE season_id = @id) r ON r.season_id = s.id
    JOIN teams t ON t.id = r.team_id
    WHERE s.id = @id
    GROUP BY t.id, t.name
    ORDER BY points DESC, SUM(r.gf) - SUM(r.ga) DESC, goalsFor DESC, t.name
    """, new { id }));

// ---------- Drużyny i zawodnicy ----------
api.MapGet("/leagues/{id:long}/teams", (long id) => Query("""
    SELECT t.id, t.name, c.user_id AS captainId, u.display_name AS captain,
           (SELECT COUNT(*) FROM team_members m WHERE m.team_id = t.id) AS players
    FROM teams t
    LEFT JOIN team_members c ON c.team_id = t.id AND c.is_captain
    LEFT JOIN users u ON u.id = c.user_id
    WHERE t.league_id = @id ORDER BY t.name
    """, new { id }));

user.MapPost("/leagues/{id:long}/teams", (long id, NameReq r, ClaimsPrincipal u) => Insert(
    "INSERT INTO teams (league_id, name) SELECT id, TRIM(@Name) FROM leagues WHERE id = @id AND organizer_id = @uid",
    P(r, u, id)));

user.MapPut("/teams/{id:long}", (long id, NameReq r, ClaimsPrincipal u) => Exec(
    $"UPDATE teams t {TeamAccess} SET t.name = TRIM(@Name) WHERE t.id = @id AND {CanManageTeam}", P(r, u, id)));

user.MapGet("/teams/{id:long}/players", (long id) => Query("""
    SELECT u.id, u.username, u.display_name AS displayName, m.is_captain AS isCaptain
    FROM team_members m JOIN users u ON u.id = m.user_id
    WHERE m.team_id = @id ORDER BY m.is_captain DESC, u.username
    """, new { id }));

user.MapPost("/teams/{id:long}/players", (long id, PlayerReq r, ClaimsPrincipal u) => Exec($"""
    INSERT INTO team_members (team_id, league_id, user_id)
    SELECT t.id, t.league_id, p.id FROM teams t {TeamAccess} JOIN users p ON p.username = TRIM(@Username)
    WHERE t.id = @id AND {CanManageTeam}
    """, P(r, u, id), "Nie znaleziono użytkownika lub brak uprawnień."));

user.MapDelete("/teams/{id:long}/players/{userId:long}", (long id, long userId, ClaimsPrincipal u) => Exec($"""
    DELETE m FROM team_members m JOIN teams t ON t.id = m.team_id {TeamAccess}
    WHERE m.team_id = @id AND m.user_id = @userId AND {CanManageTeam}
    """, P(new { userId }, u, id)));

// Kapitana wskazuje organizator; musi być zawodnikiem drużyny.
user.MapPut("/teams/{id:long}/captain", async (long id, CaptainReq r, ClaimsPrincipal u) =>
{
    const string scope = "team_members m JOIN teams t ON t.id = m.team_id JOIN leagues l ON l.id = t.league_id";
    var p = P(r, u, id);
    await using var db = Db();
    await db.OpenAsync();
    await using var tx = await db.BeginTransactionAsync();
    await db.ExecuteAsync($"UPDATE {scope} SET m.is_captain = FALSE WHERE m.team_id = @id AND l.organizer_id = @uid", p, tx);
    if (await db.ExecuteAsync($"UPDATE {scope} SET m.is_captain = TRUE WHERE m.team_id = @id AND m.user_id = @UserId AND l.organizer_id = @uid", p, tx) == 0)
        return NotAllowed();
    await tx.CommitAsync();
    return Results.NoContent();
});

// ---------- Terminarz i wyniki ----------
api.MapGet("/seasons/{id:long}/games", (long id) => Query("""
    SELECT g.id, g.starts_at AS startsAt, g.venue, g.home_team_id AS homeTeamId, h.name AS homeTeam,
           g.away_team_id AS awayTeamId, a.name AS awayTeam, g.home_score AS homeScore, g.away_score AS awayScore
    FROM games g JOIN teams h ON h.id = g.home_team_id JOIN teams a ON a.id = g.away_team_id
    WHERE g.season_id = @id ORDER BY g.starts_at, g.id
    """, new { id }));

user.MapPost("/seasons/{id:long}/games", (long id, GameReq r, ClaimsPrincipal u) => Insert("""
    INSERT INTO games (season_id, league_id, home_team_id, away_team_id, starts_at, venue)
    SELECT s.id, s.league_id, @HomeTeamId, @AwayTeamId, @StartsAt, NULLIF(TRIM(@Venue), '')
    FROM seasons s JOIN leagues l ON l.id = s.league_id
    WHERE s.id = @id AND l.organizer_id = @uid AND s.status <> 'finished'
    """, P(r, u, id)));

user.MapPut("/games/{id:long}", (long id, GameReq r, ClaimsPrincipal u) => Exec($"""
    UPDATE games g {GameAccess}
    SET g.home_team_id = @HomeTeamId, g.away_team_id = @AwayTeamId, g.starts_at = @StartsAt, g.venue = NULLIF(TRIM(@Venue), '')
    WHERE g.id = @id AND l.organizer_id = @uid AND s.status <> 'finished' AND g.home_score IS NULL
    """, P(r, u, id)));

user.MapDelete("/games/{id:long}", (long id, ClaimsPrincipal u) => Exec($"""
    DELETE g FROM games g {GameAccess}
    WHERE g.id = @id AND l.organizer_id = @uid AND s.status <> 'finished' AND g.home_score IS NULL
    """, P(null, u, id)));

// Wprowadzenie / poprawa wyniku (null, null = cofnięcie wyniku). Tylko w trwającym sezonie.
user.MapPut("/games/{id:long}/result", (long id, ResultReq r, ClaimsPrincipal u) => Exec($"""
    UPDATE games g {GameAccess} SET g.home_score = @HomeScore, g.away_score = @AwayScore
    WHERE g.id = @id AND l.organizer_id = @uid AND s.status = 'ongoing'
    """, P(r, u, id)));

app.Run();

// ---------- Pomocnicze ----------
MySqlConnection Db() => new(connectionString);

async Task<IResult> Query(string sql, object? p = null)
{
    await using var db = Db();
    return Results.Ok(await db.QueryAsync(sql, p));
}

async Task<IResult> Exec(string sql, object p, string? notAllowed = null)
{
    await using var db = Db();
    return await db.ExecuteAsync(sql, p) > 0 ? Results.NoContent() : NotAllowed(notAllowed);
}

async Task<IResult> Insert(string sql, object p)
{
    await using var db = Db();
    await db.OpenAsync();                                     // jedna sesja => poprawne LAST_INSERT_ID()
    if (await db.ExecuteAsync(sql, p) == 0) return NotAllowed();
    return Results.Ok(new { id = await db.ExecuteScalarAsync<long>("SELECT LAST_INSERT_ID()") });
}

static DynamicParameters P(object? body, ClaimsPrincipal u, long id = 0)
{
    var p = new DynamicParameters(body);
    p.Add("uid", Uid(u));
    p.Add("id", id);
    return p;
}

static long Uid(ClaimsPrincipal u) => long.Parse(u.FindFirstValue(ClaimTypes.NameIdentifier)!);
static IResult Bad(string message) => Results.BadRequest(new { message });
static IResult NotAllowed(string? message = null) =>
    Results.NotFound(new { message = message ?? "Nie znaleziono lub brak uprawnień do tej operacji." });

// BCrypt bierze pod uwagę tylko 72 bajty — dłuższe hasła odrzucamy.
static bool IsStrongPassword(string? p) => p is { Length: >= 8 } && Encoding.UTF8.GetByteCount(p) <= 72
    && p.Any(char.IsUpper) && p.Any(char.IsDigit);

// ---------- Żądania ----------
interface IValid { string? Error(); }

static class Check
{
    public static bool Len(string? s, int min, int max) => (s?.Trim().Length ?? 0) is var n && n >= min && n <= max;
}

record Credentials(string? Username, string? Password, string? DisplayName);

record DisplayNameReq(string? DisplayName) : IValid
{
    public string? Error() => Check.Len(DisplayName, 1, 100) ? null : "Nazwa wyświetlana: 1–100 znaków.";
}

record NameReq(string? Name) : IValid
{
    public string? Error() => Check.Len(Name, 1, 60) ? null : "Nazwa: 1–60 znaków.";
}

record PlayerReq(string? Username) : IValid
{
    public string? Error() => Check.Len(Username, 3, 32) ? null : "Podaj nazwę użytkownika zawodnika.";
}

record CaptainReq(long UserId);

record LeagueReq(string? Name, string? Sport, string? Description) : IValid
{
    public string? Error() => Check.Len(Name, 1, 100) && Check.Len(Sport, 1, 60) && Check.Len(Description, 0, 500)
        ? null : "Nazwa (1–100 znaków) i dyscyplina (1–60) są wymagane, opis do 500 znaków.";
}

record SeasonReq(string? Name, DateTime? StartsOn, DateTime? EndsOn, int PointsWin, int PointsDraw, int PointsLoss) : IValid
{
    public string? Error() =>
        !Check.Len(Name, 1, 80) ? "Nazwa sezonu: 1–80 znaków."
        : StartsOn > EndsOn ? "Koniec sezonu nie może być przed początkiem."
        : PointsLoss < 0 || PointsDraw < PointsLoss || PointsWin < PointsDraw || PointsWin > 10
            ? "Punkty: 0–10, zwycięstwo ≥ remis ≥ porażka." : null;
}

record GameReq(long HomeTeamId, long AwayTeamId, DateTime StartsAt, string? Venue) : IValid
{
    public string? Error() =>
        HomeTeamId <= 0 || AwayTeamId <= 0 || HomeTeamId == AwayTeamId ? "Wybierz dwie różne drużyny."
        : StartsAt == default ? "Podaj termin meczu."
        : Check.Len(Venue, 0, 120) ? null : "Miejsce: do 120 znaków.";
}

record ResultReq(int? HomeScore, int? AwayScore) : IValid
{
    public string? Error() => (HomeScore, AwayScore) is (null, null) or (>= 0 and <= 999, >= 0 and <= 999)
        ? null : "Podaj oba wyniki (0–999) albo zostaw oba puste, aby cofnąć wynik.";
}
