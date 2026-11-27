using System.Security.Claims;
using Dapper;
using LeagueHub.Api.Contracts;
using LeagueHub.Api.Infrastructure;

namespace LeagueHub.Api.Endpoints;

public static class TeamEndpoints
{
    public static void Map(RouteGroupBuilder user)
    {
        user.MapPost("/leagues/{id:long}/teams", (long id, NameReq request, ClaimsPrincipal principal, DbExecutor db) => db.Insert(
            "INSERT INTO teams (league_id, name) SELECT id, TRIM(@Name) FROM leagues WHERE id = @id AND organizer_id = @uid",
            DbExecutor.Params(request, principal, id)));

        user.MapPut("/teams/{id:long}", (long id, NameReq request, ClaimsPrincipal principal, DbExecutor db) => db.Exec(
            $"UPDATE teams t {SqlFragments.TeamAccess} SET t.name = TRIM(@Name) WHERE t.id = @id AND {SqlFragments.CanManageTeam}",
            DbExecutor.Params(request, principal, id)));

        user.MapGet("/teams/{id:long}/players", (long id, DbExecutor db) => db.Query("""
            SELECT u.id, u.username, m.is_captain AS isCaptain
            FROM team_members m JOIN users u ON u.id = m.user_id
            WHERE m.team_id = @id ORDER BY m.is_captain DESC, u.username
            """, new { id }));

        user.MapPost("/teams/{id:long}/players", (long id, PlayerReq request, ClaimsPrincipal principal, DbExecutor db) => db.Exec($"""
            INSERT INTO team_members (team_id, league_id, user_id)
            SELECT t.id, t.league_id, p.id FROM teams t {SqlFragments.TeamAccess} JOIN users p ON p.username = TRIM(@Username)
            WHERE t.id = @id AND {SqlFragments.CanManageTeam}
            """, DbExecutor.Params(request, principal, id), "Nie znaleziono użytkownika lub brak uprawnień."));

        user.MapDelete("/teams/{id:long}/players/{userId:long}", (long id, long userId, ClaimsPrincipal principal, DbExecutor db) => db.Exec($"""
            DELETE m FROM team_members m JOIN teams t ON t.id = m.team_id {SqlFragments.TeamAccess}
            WHERE m.team_id = @id AND m.user_id = @userId AND {SqlFragments.CanManageTeam}
            """, DbExecutor.Params(new { userId }, principal, id)));

        user.MapPut("/teams/{id:long}/captain", async (long id, CaptainReq request, ClaimsPrincipal principal, DbExecutor db) =>
        {
            const string scope = "team_members m JOIN teams t ON t.id = m.team_id JOIN leagues l ON l.id = t.league_id";
            var parameters = DbExecutor.Params(request, principal, id);
            await using var connection = db.CreateConnection();
            await connection.OpenAsync();
            await using var transaction = await connection.BeginTransactionAsync();
            await connection.ExecuteAsync($"UPDATE {scope} SET m.is_captain = FALSE WHERE m.team_id = @id AND l.organizer_id = @uid", parameters, transaction);
            if (await connection.ExecuteAsync($"UPDATE {scope} SET m.is_captain = TRUE WHERE m.team_id = @id AND m.user_id = @UserId AND l.organizer_id = @uid", parameters, transaction) == 0)
                return SecurityExtensions.NotAllowed();
            await transaction.CommitAsync();
            return Results.NoContent();
        });
    }
}