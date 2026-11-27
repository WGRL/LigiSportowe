using System.Security.Claims;
using Dapper;
using LeagueHub.Api.Contracts;
using LeagueHub.Api.Infrastructure;
using LeagueHub.Api.Lineups;
using LeagueHub.Api.Scheduling;

namespace LeagueHub.Api.Endpoints;

public static class GameEndpoints
{
    public static void Map(IEndpointRouteBuilder api, RouteGroupBuilder user)
    {
        api.MapGet("/lineup-templates", () => Results.Ok(new
        {
            formats = LineupTemplates.Formats, strategies = LineupTemplates.Strategies, scheduleSystems = RoundRobin.Systems
        }));

        api.MapGet("/seasons/{id:long}/games", (long id, DbExecutor db) => db.Query("""
            SELECT g.id, g.starts_at AS startsAt, g.venue, g.home_team_id AS homeTeamId, h.name AS homeTeam,
                   g.away_team_id AS awayTeamId, a.name AS awayTeam, g.home_score AS homeScore, g.away_score AS awayScore,
                   g.round_no AS round, g.lineup_format AS lineupFormat, g.lineup_strategy AS lineupStrategy
            FROM games g JOIN teams h ON h.id = g.home_team_id JOIN teams a ON a.id = g.away_team_id
            WHERE g.season_id = @id ORDER BY g.starts_at, g.id
            """, new { id }));

        // Terminarz „każdy z każdym” z aktualnych drużyn ligi. Kolejność drużyn jest losowana (jak losowanie terminarza).
        // Mecze, które już są w sezonie (zawsze rozegrane, a w trybie "keep" też zaplanowane), zaliczają się jako odbyte pary —
        // dopisywane są tylko brakujące. Każdy nowy mecz od razu dostaje kadry, chronologicznie, więc rotacja działa cały sezon.
        user.MapPost("/seasons/{id:long}/schedule", async (long id, ScheduleReq request, ClaimsPrincipal principal, DbExecutor db) =>
        {
            await using var connection = db.CreateConnection();
            await connection.OpenAsync();
            await using var transaction = await connection.BeginTransactionAsync();
            var parameters = DbExecutor.Params(request, principal, id);
            var leagueId = await connection.ExecuteScalarAsync<long?>("""
                SELECT s.league_id FROM seasons s JOIN leagues l ON l.id = s.league_id
                WHERE s.id = @id AND l.organizer_id = @uid AND s.status <> 'finished' FOR UPDATE
                """, parameters, transaction);
            if (leagueId is null) return SecurityExtensions.NotAllowed();

            var teams = (await connection.QueryAsync<long>("SELECT id FROM teams WHERE league_id = @leagueId", new { leagueId }, transaction))
                .OrderBy(_ => Random.Shared.Next()).ToList();
            if (teams.Count < 2) return SecurityExtensions.Bad("Do ułożenia terminarza potrzebne są co najmniej 2 drużyny.");

            var existingCount = await connection.ExecuteScalarAsync<long>("SELECT COUNT(*) FROM games WHERE season_id = @id", parameters, transaction);
            if (existingCount > 0 && request.Existing is null)
                return Results.Conflict(new { message = "Sezon ma już mecze — wybierz, czy je zostawić, czy ułożyć nierozegrane od nowa." });
            if (request.Existing == "replace")
                await connection.ExecuteAsync("DELETE FROM games WHERE season_id = @id AND home_score IS NULL", parameters, transaction);

            var existing = (await connection.QueryAsync<(long Home, long Away, int? Round)>(
                "SELECT home_team_id, away_team_id, round_no FROM games WHERE season_id = @id", parameters, transaction)).ToList();
            var firstRound = (existing.Max(g => g.Round) ?? 0) + 1;
            var fixtures = RoundRobin.WithoutExisting(
                RoundRobin.Generate(teams, RoundRobin.System(request.System)!.Legs), existing.Select(g => (g.Home, g.Away)), firstRound);

            var roundStart = request.FirstGameAt;
            foreach (var round in fixtures.GroupBy(f => f.Round))
            {
                var startsAt = roundStart;
                foreach (var fixture in round)
                {
                    var gameId = await connection.ExecuteScalarAsync<long>("""
                        INSERT INTO games (season_id, league_id, home_team_id, away_team_id, starts_at, venue, round_no, lineup_format, lineup_strategy)
                        VALUES (@id, @leagueId, @home, @away, @startsAt, NULLIF(TRIM(@venue), ''), @round, @format, @strategy);
                        SELECT LAST_INSERT_ID();
                        """, new
                    {
                        id, leagueId, home = fixture.HomeTeamId, away = fixture.AwayTeamId, startsAt, venue = request.Venue,
                        round = fixture.Round, format = request.Format, strategy = request.Strategy
                    }, transaction);
                    await LineupService.Draw(connection, transaction, gameId);
                    startsAt = startsAt.AddMinutes(request.GameIntervalMinutes);
                }
                // Turniej jednego dnia: następna kolejka zaczyna się po ostatnim meczu poprzedniej.
                roundStart = request.RoundIntervalDays == 0 ? startsAt : roundStart.AddDays(request.RoundIntervalDays);
            }

            await transaction.CommitAsync();
            return Results.Ok(new { games = fixtures.Count, rounds = fixtures.Select(f => f.Round).Distinct().Count(), kept = existing.Count });
        });

        // Nowy mecz od razu dostaje kadry obu drużyn.
        user.MapPost("/seasons/{id:long}/games", async (long id, GameReq request, ClaimsPrincipal principal, DbExecutor db) =>
        {
            await using var connection = db.CreateConnection();
            await connection.OpenAsync();
            await using var transaction = await connection.BeginTransactionAsync();
            if (await connection.ExecuteAsync("""
                INSERT INTO games (season_id, league_id, home_team_id, away_team_id, starts_at, venue, lineup_format, lineup_strategy)
                SELECT s.id, s.league_id, @HomeTeamId, @AwayTeamId, @StartsAt, NULLIF(TRIM(@Venue), ''), @Format, @Strategy
                FROM seasons s JOIN leagues l ON l.id = s.league_id
                WHERE s.id = @id AND l.organizer_id = @uid AND s.status <> 'finished'
                """, DbExecutor.Params(request, principal, id), transaction) == 0)
                return SecurityExtensions.NotAllowed();
            var gameId = await connection.ExecuteScalarAsync<long>("SELECT LAST_INSERT_ID()", transaction: transaction);
            await LineupService.Draw(connection, transaction, gameId);
            await transaction.CommitAsync();
            return Results.Ok(new { id = gameId });
        });

        // Zmiana drużyn, formatu lub sposobu doboru → kadra dobierana od nowa.
        user.MapPut("/games/{id:long}", async (long id, GameReq request, ClaimsPrincipal principal, DbExecutor db) =>
        {
            await using var connection = db.CreateConnection();
            await connection.OpenAsync();
            await using var transaction = await connection.BeginTransactionAsync();
            var before = (await connection.QueryAsync<(long Home, long Away, string Format, string Strategy)>(
                "SELECT home_team_id, away_team_id, lineup_format, lineup_strategy FROM games WHERE id = @id FOR UPDATE",
                new { id }, transaction)).ToList();
            if (before.Count == 0 || await connection.ExecuteAsync($"""
                UPDATE games g {SqlFragments.GameAccess}
                SET g.home_team_id = @HomeTeamId, g.away_team_id = @AwayTeamId, g.starts_at = @StartsAt, g.venue = NULLIF(TRIM(@Venue), ''),
                    g.lineup_format = @Format, g.lineup_strategy = @Strategy
                WHERE g.id = @id AND l.organizer_id = @uid AND s.status <> 'finished' AND g.home_score IS NULL
                """, DbExecutor.Params(request, principal, id), transaction) == 0)
                return SecurityExtensions.NotAllowed();
            if (before[0] !=(request.HomeTeamId, request.AwayTeamId, request.Format, request.Strategy))
                await LineupService.Draw(connection, transaction, id);
            await transaction.CommitAsync();
            return Results.NoContent();
        });

        user.MapDelete("/games/{id:long}", (long id, ClaimsPrincipal principal, DbExecutor db) => db.Exec($"""
            DELETE g FROM games g {SqlFragments.GameAccess}
            WHERE g.id = @id AND l.organizer_id = @uid AND s.status <> 'finished' AND g.home_score IS NULL
            """, DbExecutor.Params(null, principal, id)));

        user.MapPut("/games/{id:long}/result", (long id, ResultReq request, ClaimsPrincipal principal, DbExecutor db) => db.Exec($"""
            UPDATE games g {SqlFragments.GameAccess} SET g.home_score = @HomeScore, g.away_score = @AwayScore
            WHERE g.id = @id AND l.organizer_id = @uid AND s.status = 'ongoing'
            """, DbExecutor.Params(request, principal, id)));

        // Kadry widzą zalogowani — tak jak składy drużyn.
        user.MapGet("/games/{id:long}/lineup", (long id, DbExecutor db) => db.Query("""
            SELECT gl.team_id AS teamId, u.id AS userId, u.username, u.display_name AS displayName, gl.role, gl.slot,
                   COALESCE(m.is_captain, FALSE) AS isCaptain
            FROM game_lineups gl JOIN users u ON u.id = gl.user_id
            LEFT JOIN team_members m ON m.team_id = gl.team_id AND m.user_id = gl.user_id
            WHERE gl.game_id = @id ORDER BY gl.team_id, gl.slot
            """, new { id }));

        // Ponowne losowanie przed meczem: organizator (obie lub jedna drużyna) albo kapitan (tylko swoja).
        user.MapPost("/games/{id:long}/lineup/draw", async (long id, DrawReq request, ClaimsPrincipal principal, DbExecutor db) =>
        {
            await using var connection = db.CreateConnection();
            await connection.OpenAsync();
            await using var transaction = await connection.BeginTransactionAsync();
            var allowed = await connection.ExecuteScalarAsync<long?>($"""
                SELECT g.id FROM games g {SqlFragments.GameAccess}
                LEFT JOIN team_members cap ON cap.team_id = @TeamId AND cap.user_id = @uid AND cap.is_captain
                WHERE g.id = @id AND s.status <> 'finished' AND g.home_score IS NULL
                  AND (@TeamId IS NULL OR @TeamId IN (g.home_team_id, g.away_team_id))
                  AND (l.organizer_id = @uid OR cap.user_id IS NOT NULL)
                """, DbExecutor.Params(request, principal, id), transaction);
            if (allowed is null) return SecurityExtensions.NotAllowed();
            await LineupService.Draw(connection, transaction, id, request.TeamId, request.Strategy);
            await transaction.CommitAsync();
            return Results.NoContent();
        });
    }
}
