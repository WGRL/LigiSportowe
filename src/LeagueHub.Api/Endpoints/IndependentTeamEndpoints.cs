using System.Security.Claims;
using Dapper;
using LeagueHub.Api.Contracts;
using LeagueHub.Api.Infrastructure;

namespace LeagueHub.Api.Endpoints;

/// <summary>
/// Drużyny poza ligą: zakłada je dowolny zalogowany użytkownik (właściciel), który zaprasza innych po nazwie użytkownika.
/// Zaproszony widzi zaproszenie w powiadomieniach i może je przyjąć albo odrzucić.
/// </summary>
public static class IndependentTeamEndpoints
{
    private const string IsMember =
        "EXISTS (SELECT 1 FROM independent_team_members me WHERE me.team_id = @id AND me.user_id = @uid)";

    public static void Map(RouteGroupBuilder user)
    {
        user.MapGet("/independent-teams", (ClaimsPrincipal principal, DbExecutor db) => db.Query("""
            SELECT t.id, t.name, t.owner_id AS ownerId, o.display_name AS owner,
                   (SELECT COUNT(*) FROM independent_team_members x WHERE x.team_id = t.id) AS players
            FROM independent_team_members m
            JOIN independent_teams t ON t.id = m.team_id
            JOIN users o ON o.id = t.owner_id
            WHERE m.user_id = @uid ORDER BY t.name
            """, new { uid = principal.Uid() }));

        user.MapPost("/independent-teams", async (NameReq request, ClaimsPrincipal principal, DbExecutor db) =>
        {
            await using var connection = db.CreateConnection();
            await connection.OpenAsync();
            await using var transaction = await connection.BeginTransactionAsync();
            var parameters = DbExecutor.Params(request, principal);
            await connection.ExecuteAsync("INSERT INTO independent_teams (owner_id, name) VALUES (@uid, TRIM(@Name))", parameters, transaction);
            var id = await connection.ExecuteScalarAsync<long>("SELECT LAST_INSERT_ID()", transaction: transaction);
            await connection.ExecuteAsync("INSERT INTO independent_team_members (team_id, user_id) VALUES (@id, @uid)",
                new { id, uid = principal.Uid() }, transaction);
            await transaction.CommitAsync();
            return Results.Ok(new { id });
        });

        user.MapPut("/independent-teams/{id:long}", (long id, NameReq request, ClaimsPrincipal principal, DbExecutor db) => db.Exec(
            "UPDATE independent_teams SET name = TRIM(@Name) WHERE id = @id AND owner_id = @uid",
            DbExecutor.Params(request, principal, id)));

        user.MapDelete("/independent-teams/{id:long}", (long id, ClaimsPrincipal principal, DbExecutor db) => db.Exec(
            "DELETE FROM independent_teams WHERE id = @id AND owner_id = @uid",
            DbExecutor.Params(null, principal, id)));

        // Skład widzą tylko członkowie drużyny; oczekujące zaproszenia — tylko właściciel.
        user.MapGet("/independent-teams/{id:long}/members", async (long id, ClaimsPrincipal principal, DbExecutor db) =>
        {
            var parameters = DbExecutor.Params(null, principal, id);
            await using var connection = db.CreateConnection();
            var members = (await connection.QueryAsync($"""
                SELECT u.id, u.username, u.display_name AS displayName, u.id = t.owner_id AS isOwner
                FROM independent_team_members m
                JOIN independent_teams t ON t.id = m.team_id
                JOIN users u ON u.id = m.user_id
                WHERE m.team_id = @id AND {IsMember}
                ORDER BY isOwner DESC, u.display_name
                """, parameters)).ToList();
            if (members.Count == 0) return SecurityExtensions.NotAllowed();
            var invitations = await connection.QueryAsync("""
                SELECT u.id, u.username, u.display_name AS displayName, i.created_at AS createdAt
                FROM team_invitations i
                JOIN independent_teams t ON t.id = i.team_id
                JOIN users u ON u.id = i.user_id
                WHERE i.team_id = @id AND t.owner_id = @uid
                ORDER BY i.created_at
                """, parameters);
            return Results.Ok(new { members, invitations });
        });

        user.MapPost("/independent-teams/{id:long}/invitations", async (long id, PlayerReq request, ClaimsPrincipal principal, DbExecutor db) =>
        {
            await using var connection = db.CreateConnection();
            if (await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM independent_teams WHERE id = @id AND owner_id = @uid",
                    DbExecutor.Params(null, principal, id)) == 0)
                return SecurityExtensions.NotAllowed("Tylko właściciel drużyny może zapraszać zawodników.");
            var invitee = await connection.QueryFirstOrDefaultAsync<long?>(
                "SELECT id FROM users WHERE username = TRIM(@Username)", request);
            if (invitee is null)
                return SecurityExtensions.NotAllowed("Nie ma użytkownika o takiej nazwie.");
            var target = new { id, invitee, uid = principal.Uid() };
            if (await connection.ExecuteScalarAsync<int>(
                    "SELECT COUNT(*) FROM independent_team_members WHERE team_id = @id AND user_id = @invitee", target) > 0)
                return Results.Conflict(new { message = "Ten użytkownik jest już w drużynie." });
            if (await connection.ExecuteAsync("""
                    INSERT IGNORE INTO team_invitations (team_id, user_id, invited_by) VALUES (@id, @invitee, @uid)
                    """, target) == 0)
                return Results.Conflict(new { message = "Ten użytkownik ma już zaproszenie do tej drużyny." });
            return Results.NoContent();
        });

        user.MapDelete("/independent-teams/{id:long}/invitations/{userId:long}", (long id, long userId, ClaimsPrincipal principal, DbExecutor db) => db.Exec("""
            DELETE i FROM team_invitations i JOIN independent_teams t ON t.id = i.team_id
            WHERE i.team_id = @id AND i.user_id = @userId AND t.owner_id = @uid
            """, DbExecutor.Params(new { userId }, principal, id)));

        // Właściciel usuwa zawodnika albo zawodnik sam odchodzi. Właściciela nie można usunąć — może usunąć całą drużynę.
        user.MapDelete("/independent-teams/{id:long}/members/{userId:long}", (long id, long userId, ClaimsPrincipal principal, DbExecutor db) => db.Exec("""
            DELETE m FROM independent_team_members m JOIN independent_teams t ON t.id = m.team_id
            WHERE m.team_id = @id AND m.user_id = @userId AND m.user_id <> t.owner_id
              AND (t.owner_id = @uid OR m.user_id = @uid)
            """, DbExecutor.Params(new { userId }, principal, id)));

        // ---------- Zaproszenia do drużyny (lista: GET /api/notifications) ----------
        user.MapPost("/invitations/{id:long}/accept", async (long id, ClaimsPrincipal principal, DbExecutor db) =>
        {
            var parameters = DbExecutor.Params(null, principal, id);
            await using var connection = db.CreateConnection();
            await connection.OpenAsync();
            await using var transaction = await connection.BeginTransactionAsync();
            await connection.ExecuteAsync("""
                INSERT IGNORE INTO independent_team_members (team_id, user_id)
                SELECT team_id, user_id FROM team_invitations WHERE id = @id AND user_id = @uid
                """, parameters, transaction);
            if (await connection.ExecuteAsync("DELETE FROM team_invitations WHERE id = @id AND user_id = @uid", parameters, transaction) == 0)
                return SecurityExtensions.NotAllowed("Zaproszenie nie istnieje lub zostało wycofane.");
            await transaction.CommitAsync();
            return Results.NoContent();
        });

        user.MapPost("/invitations/{id:long}/reject", (long id, ClaimsPrincipal principal, DbExecutor db) => db.Exec(
            "DELETE FROM team_invitations WHERE id = @id AND user_id = @uid",
            DbExecutor.Params(null, principal, id), "Zaproszenie nie istnieje lub zostało wycofane."));
    }
}
