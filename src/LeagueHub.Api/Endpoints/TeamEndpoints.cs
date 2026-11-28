using System.Security.Claims;
using Dapper;
using LeagueHub.Api.Contracts;
using LeagueHub.Api.Infrastructure;

namespace LeagueHub.Api.Endpoints;

public static class TeamEndpoints
{
    private static Task<(long TeamId, long LeagueId, long InvitedBy, string Team, string League, string Player)> FindInvitation(
        System.Data.IDbConnection connection, System.Data.IDbTransaction transaction, long id, long uid) =>
        connection.QueryFirstOrDefaultAsync<(long, long, long, string, string, string)>("""
            SELECT i.team_id, i.league_id, i.invited_by, t.name, l.name, u.display_name
            FROM league_team_invitations i
            JOIN teams t ON t.id = i.team_id
            JOIN leagues l ON l.id = i.league_id
            JOIN users u ON u.id = i.user_id
            WHERE i.id = @id AND i.user_id = @uid
            FOR UPDATE
            """, new { id, uid }, transaction);

    public static void Map(RouteGroupBuilder user)
    {
        user.MapPost("/leagues/{id:long}/teams", (long id, NameReq request, ClaimsPrincipal principal, DbExecutor db) => db.Insert(
            "INSERT INTO teams (league_id, name) SELECT id, TRIM(@Name) FROM leagues WHERE id = @id AND organizer_id = @uid",
            DbExecutor.Params(request, principal, id)));

        user.MapPut("/teams/{id:long}", (long id, NameReq request, ClaimsPrincipal principal, DbExecutor db) => db.Exec(
            $"UPDATE teams t {SqlFragments.TeamAccess} SET t.name = TRIM(@Name) WHERE t.id = @id AND {SqlFragments.CanManageTeam}",
            DbExecutor.Params(request, principal, id)));

        user.MapGet("/teams/{id:long}/players", (long id, DbExecutor db) => db.Query("""
            SELECT u.id, u.username, u.display_name AS displayName, m.is_captain AS isCaptain
            FROM team_members m JOIN users u ON u.id = m.user_id
            WHERE m.team_id = @id ORDER BY m.is_captain DESC, u.username
            """, new { id }));

        // ---------- Zaproszenia zawodników: dodanie do drużyny wymaga akceptacji zawodnika ----------
        user.MapGet("/teams/{id:long}/invitations", (long id, ClaimsPrincipal principal, DbExecutor db) => db.Query($"""
            SELECT u.id, u.username, u.display_name AS displayName, i.created_at AS createdAt
            FROM league_team_invitations i JOIN teams t ON t.id = i.team_id {SqlFragments.TeamAccess}
            JOIN users u ON u.id = i.user_id
            WHERE i.team_id = @id AND {SqlFragments.CanManageTeam} ORDER BY i.created_at
            """, DbExecutor.Params(null, principal, id)));

        user.MapPost("/teams/{id:long}/invitations", async (long id, PlayerReq request, ClaimsPrincipal principal, DbExecutor db) =>
        {
            await using var connection = db.CreateConnection();
            var leagueId = await connection.QueryFirstOrDefaultAsync<long?>(
                $"SELECT t.league_id FROM teams t {SqlFragments.TeamAccess} WHERE t.id = @id AND {SqlFragments.CanManageTeam}",
                DbExecutor.Params(null, principal, id));
            if (leagueId is null) return SecurityExtensions.NotAllowed("Zawodników zapraszają kapitan drużyny i organizator ligi.");
            var invitee = await connection.QueryFirstOrDefaultAsync<long?>("SELECT id FROM users WHERE username = TRIM(@Username)", request);
            if (invitee is null) return SecurityExtensions.NotAllowed("Nie ma użytkownika o takiej nazwie.");
            var target = new { id, leagueId, invitee, uid = principal.Uid() };
            var current = await connection.QueryFirstOrDefaultAsync<(long TeamId, string Name)>("""
                SELECT t.id, t.name FROM team_members m JOIN teams t ON t.id = m.team_id
                WHERE m.league_id = @leagueId AND m.user_id = @invitee
                """, target);
            if (current != default)
                return Results.Conflict(new { message = current.TeamId == id
                    ? "Ten użytkownik jest już w drużynie."
                    : $"Ten użytkownik gra już w drużynie {current.Name} w tej lidze." });
            if (await connection.ExecuteAsync("""
                    INSERT IGNORE INTO league_team_invitations (team_id, league_id, user_id, invited_by) VALUES (@id, @leagueId, @invitee, @uid)
                    """, target) == 0)
                return Results.Conflict(new { message = "Ten użytkownik ma już zaproszenie do tej drużyny." });
            return Results.NoContent();
        });

        user.MapDelete("/teams/{id:long}/invitations/{userId:long}", (long id, long userId, ClaimsPrincipal principal, DbExecutor db) => db.Exec($"""
            DELETE i FROM league_team_invitations i JOIN teams t ON t.id = i.team_id {SqlFragments.TeamAccess}
            WHERE i.team_id = @id AND i.user_id = @userId AND {SqlFragments.CanManageTeam}
            """, DbExecutor.Params(new { userId }, principal, id)));

        // Odpowiedź zawodnika. Zapraszający dostaje powiadomienie o przyjęciu albo odrzuceniu.
        user.MapPost("/league-team-invitations/{id:long}/accept", async (long id, ClaimsPrincipal principal, DbExecutor db) =>
        {
            await using var connection = db.CreateConnection();
            await connection.OpenAsync();
            await using var transaction = await connection.BeginTransactionAsync();
            var invitation = await FindInvitation(connection, transaction, id, principal.Uid());
            if (invitation == default)
                return SecurityExtensions.NotAllowed("Zaproszenie nie istnieje lub zostało wycofane.");
            var other = await connection.QueryFirstOrDefaultAsync<string>("""
                SELECT t.name FROM team_members m JOIN teams t ON t.id = m.team_id
                WHERE m.league_id = @LeagueId AND m.user_id = @uid
                """, new { invitation.LeagueId, uid = principal.Uid() }, transaction);
            if (other is not null)
                return Results.Conflict(new { message = $"Grasz już w drużynie {other} w tej lidze. Odejdź z niej albo odrzuć zaproszenie." });
            await connection.ExecuteAsync("INSERT INTO team_members (team_id, league_id, user_id) VALUES (@TeamId, @LeagueId, @uid)",
                new { invitation.TeamId, invitation.LeagueId, uid = principal.Uid() }, transaction);
            await connection.ExecuteAsync("DELETE FROM league_team_invitations WHERE id = @id", new { id }, transaction);
            await Notifications.Send(connection, transaction, "SELECT @inviter", new { inviter = invitation.InvitedBy },
                $"{invitation.Player} dołączył(a) do drużyny {invitation.Team} (liga {invitation.League}).");
            await transaction.CommitAsync();
            return Results.NoContent();
        });

        user.MapPost("/league-team-invitations/{id:long}/reject", async (long id, ClaimsPrincipal principal, DbExecutor db) =>
        {
            await using var connection = db.CreateConnection();
            await connection.OpenAsync();
            await using var transaction = await connection.BeginTransactionAsync();
            var invitation = await FindInvitation(connection, transaction, id, principal.Uid());
            if (invitation == default)
                return SecurityExtensions.NotAllowed("Zaproszenie nie istnieje lub zostało wycofane.");
            await connection.ExecuteAsync("DELETE FROM league_team_invitations WHERE id = @id", new { id }, transaction);
            await Notifications.Send(connection, transaction, "SELECT @inviter", new { inviter = invitation.InvitedBy },
                $"{invitation.Player} odrzucił(a) zaproszenie do drużyny {invitation.Team} (liga {invitation.League}).");
            await transaction.CommitAsync();
            return Results.NoContent();
        });

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