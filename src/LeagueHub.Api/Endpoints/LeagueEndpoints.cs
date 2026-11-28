using System.Security.Claims;
using LeagueHub.Api.Contracts;
using LeagueHub.Api.Infrastructure;

namespace LeagueHub.Api.Endpoints;

public static class LeagueEndpoints
{
    public static void Map(IEndpointRouteBuilder api, RouteGroupBuilder user)
    {
        user.MapGet("/me/teams", (ClaimsPrincipal principal, DbExecutor db) => db.Query("""
            SELECT t.id, t.name, l.id AS leagueId, l.name AS league, m.is_captain AS isCaptain
            FROM team_members m JOIN teams t ON t.id = m.team_id JOIN leagues l ON l.id = t.league_id
            WHERE m.user_id = @uid ORDER BY l.name
            """, new { uid = principal.Uid() }));

        api.MapGet("/leagues", (DbExecutor db) => db.Query("""
            SELECT l.id, l.name, l.sport, l.description, l.organizer_id AS organizerId, u.display_name AS organizer
            FROM leagues l JOIN users u ON u.id = l.organizer_id ORDER BY l.name
            """));

        user.MapPost("/leagues", (LeagueReq request, ClaimsPrincipal principal, DbExecutor db) => db.Insert("""
            INSERT INTO leagues (organizer_id, name, sport, description)
            VALUES (@uid, TRIM(@Name), TRIM(@Sport), NULLIF(TRIM(@Description), ''))
            """, DbExecutor.Params(request, principal)));

        user.MapPut("/leagues/{id:long}", (long id, LeagueReq request, ClaimsPrincipal principal, DbExecutor db) => db.Exec("""
            UPDATE leagues SET name = TRIM(@Name), sport = TRIM(@Sport), description = NULLIF(TRIM(@Description), '')
            WHERE id = @id AND organizer_id = @uid
            """, DbExecutor.Params(request, principal, id)));

        api.MapGet("/leagues/{id:long}/teams", (long id, DbExecutor db) => db.Query("""
            SELECT t.id, t.name, t.independent_team_id AS independentTeamId, c.user_id AS captainId, u.display_name AS captain,
                   (SELECT COUNT(*) FROM team_members m WHERE m.team_id = t.id) AS players
            FROM teams t
            LEFT JOIN team_members c ON c.team_id = t.id AND c.is_captain
            LEFT JOIN users u ON u.id = c.user_id
            WHERE t.league_id = @id ORDER BY t.name
            """, new { id }));
    }
}