using System.Security.Claims;
using LeagueHub.Api.Contracts;
using LeagueHub.Api.Infrastructure;

namespace LeagueHub.Api.Endpoints;

public static class SeasonEndpoints
{
    public static void Map(IEndpointRouteBuilder api, RouteGroupBuilder user)
    {
        api.MapGet("/leagues/{id:long}/seasons", (long id, DbExecutor db) => db.Query("""
            SELECT id, name, starts_on AS startsOn, ends_on AS endsOn, points_win AS pointsWin,
                   points_draw AS pointsDraw, points_loss AS pointsLoss, status
            FROM seasons WHERE league_id = @id ORDER BY id DESC
            """, new { id }));

        user.MapPost("/leagues/{id:long}/seasons", (long id, SeasonReq request, ClaimsPrincipal principal, DbExecutor db) => db.Insert("""
            INSERT INTO seasons (league_id, name, starts_on, ends_on, points_win, points_draw, points_loss)
            SELECT id, TRIM(@Name), @StartsOn, @EndsOn, @PointsWin, @PointsDraw, @PointsLoss
            FROM leagues WHERE id = @id AND organizer_id = @uid
            """, DbExecutor.Params(request, principal, id)));

        user.MapPut("/seasons/{id:long}", (long id, SeasonReq request, ClaimsPrincipal principal, DbExecutor db) => db.Exec("""
            UPDATE seasons s JOIN leagues l ON l.id = s.league_id
            SET s.name = TRIM(@Name), s.starts_on = @StartsOn, s.ends_on = @EndsOn,
                s.points_win = @PointsWin, s.points_draw = @PointsDraw, s.points_loss = @PointsLoss
            WHERE s.id = @id AND l.organizer_id = @uid AND s.status = 'preparation'
            """, DbExecutor.Params(request, principal, id)));

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