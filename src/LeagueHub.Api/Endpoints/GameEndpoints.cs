using System.Security.Claims;
using LeagueHub.Api.Contracts;
using LeagueHub.Api.Infrastructure;

namespace LeagueHub.Api.Endpoints;

public static class GameEndpoints
{
    public static void Map(IEndpointRouteBuilder api, RouteGroupBuilder user)
    {
        api.MapGet("/seasons/{id:long}/games", (long id, DbExecutor db) => db.Query("""
            SELECT g.id, g.starts_at AS startsAt, g.venue, g.home_team_id AS homeTeamId, h.name AS homeTeam,
                   g.away_team_id AS awayTeamId, a.name AS awayTeam, g.home_score AS homeScore, g.away_score AS awayScore
            FROM games g JOIN teams h ON h.id = g.home_team_id JOIN teams a ON a.id = g.away_team_id
            WHERE g.season_id = @id ORDER BY g.starts_at, g.id
            """, new { id }));

        user.MapPost("/seasons/{id:long}/games", (long id, GameReq request, ClaimsPrincipal principal, DbExecutor db) => db.Insert("""
            INSERT INTO games (season_id, league_id, home_team_id, away_team_id, starts_at, venue)
            SELECT s.id, s.league_id, @HomeTeamId, @AwayTeamId, @StartsAt, NULLIF(TRIM(@Venue), '')
            FROM seasons s JOIN leagues l ON l.id = s.league_id
            WHERE s.id = @id AND l.organizer_id = @uid AND s.status <> 'finished'
            """, DbExecutor.Params(request, principal, id)));

        user.MapPut("/games/{id:long}", (long id, GameReq request, ClaimsPrincipal principal, DbExecutor db) => db.Exec($"""
            UPDATE games g {SqlFragments.GameAccess}
            SET g.home_team_id = @HomeTeamId, g.away_team_id = @AwayTeamId, g.starts_at = @StartsAt, g.venue = NULLIF(TRIM(@Venue), '')
            WHERE g.id = @id AND l.organizer_id = @uid AND s.status <> 'finished' AND g.home_score IS NULL
            """, DbExecutor.Params(request, principal, id)));

        user.MapDelete("/games/{id:long}", (long id, ClaimsPrincipal principal, DbExecutor db) => db.Exec($"""
            DELETE g FROM games g {SqlFragments.GameAccess}
            WHERE g.id = @id AND l.organizer_id = @uid AND s.status <> 'finished' AND g.home_score IS NULL
            """, DbExecutor.Params(null, principal, id)));

        user.MapPut("/games/{id:long}/result", (long id, ResultReq request, ClaimsPrincipal principal, DbExecutor db) => db.Exec($"""
            UPDATE games g {SqlFragments.GameAccess} SET g.home_score = @HomeScore, g.away_score = @AwayScore
            WHERE g.id = @id AND l.organizer_id = @uid AND s.status = 'ongoing'
            """, DbExecutor.Params(request, principal, id)));
    }
}