using System.Security.Claims;
using Dapper;
using LeagueHub.Api.Lineups;
using LeagueHub.Api.Contracts;
using LeagueHub.Api.Infrastructure;

namespace LeagueHub.Api.Endpoints;

public static class SeasonEndpoints
{
    public static void Map(IEndpointRouteBuilder api, RouteGroupBuilder user)
    {
        api.MapGet("/leagues/{id:long}/seasons", (long id, DbExecutor db) => db.Query("""
            SELECT id, name, starts_on AS startsOn, ends_on AS endsOn, points_win AS pointsWin,
                   points_draw AS pointsDraw, points_loss AS pointsLoss, status,
                   team_size AS teamSize, bench_size AS benchSize
            FROM seasons WHERE league_id = @id ORDER BY id DESC
            """, new { id }));

        user.MapPost("/leagues/{id:long}/seasons", (long id, SeasonReq request, ClaimsPrincipal principal, DbExecutor db) => db.Insert("""
            INSERT INTO seasons (league_id, name, starts_on, ends_on, points_win, points_draw, points_loss, team_size, bench_size)
            SELECT id, TRIM(@Name), @StartsOn, @EndsOn, @PointsWin, @PointsDraw, @PointsLoss, @TeamSize, @BenchSize
            FROM leagues WHERE id = @id AND organizer_id = @uid
            """, DbExecutor.Params(request, principal, id)));

        // Zmiana rozmiaru kadry losuje od nowa kadry wszystkich zaplanowanych meczów sezonu (chronologicznie, dla rotacji).
        user.MapPut("/seasons/{id:long}", async (long id, SeasonReq request, ClaimsPrincipal principal, DbExecutor db) =>
        {
            var parameters = DbExecutor.Params(request, principal, id);
            await using var connection = db.CreateConnection();
            await connection.OpenAsync();
            await using var transaction = await connection.BeginTransactionAsync();
            var before = (await connection.QueryAsync<(long? TeamSize, long? BenchSize)>("""
                SELECT CAST(s.team_size AS SIGNED), CAST(s.bench_size AS SIGNED) FROM seasons s JOIN leagues l ON l.id = s.league_id
                WHERE s.id = @id AND l.organizer_id = @uid AND s.status = 'preparation' FOR UPDATE
                """, parameters, transaction)).ToList();
            if (before.Count == 0) return SecurityExtensions.NotAllowed();
            await connection.ExecuteAsync("""
                UPDATE seasons
                SET name = TRIM(@Name), starts_on = @StartsOn, ends_on = @EndsOn,
                    points_win = @PointsWin, points_draw = @PointsDraw, points_loss = @PointsLoss,
                    team_size = @TeamSize, bench_size = @BenchSize
                WHERE id = @id
                """, parameters, transaction);
            if (before[0] != (request.TeamSize, request.BenchSize))
                foreach (var gameId in await connection.QueryAsync<long>(
                             "SELECT id FROM games WHERE season_id = @id AND home_score IS NULL ORDER BY starts_at, id", parameters, transaction))
                    await LineupService.Draw(connection, transaction, gameId);
            await transaction.CommitAsync();
            return Results.NoContent();
        });

        user.MapPost("/seasons/{id:long}/advance", (long id, ClaimsPrincipal principal, DbExecutor db) => db.Exec("""
            UPDATE seasons s JOIN leagues l ON l.id = s.league_id
            SET s.status = IF(s.status = 'preparation', 'ongoing', 'finished')
            WHERE s.id = @id AND l.organizer_id = @uid AND s.status <> 'finished'
            """, DbExecutor.Params(null, principal, id)));

        api.MapGet("/seasons/{id:long}/standings", (long id, DbExecutor db) => db.Query("""
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
    }
}