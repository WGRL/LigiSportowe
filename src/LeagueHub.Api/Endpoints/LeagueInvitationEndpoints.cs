using System.Security.Claims;
using Dapper;
using LeagueHub.Api.Contracts;
using LeagueHub.Api.Infrastructure;

namespace LeagueHub.Api.Endpoints;

/// <summary>
/// Drużyny poza ligą w ligach: organizator zaprasza drużynę, jej właściciel (kapitan) przyjmuje albo odrzuca zaproszenie.
/// Po przyjęciu w lidze powstaje drużyna o tej samej nazwie i składzie, a właściciel zostaje jej kapitanem.
/// Organizator może też usunąć drużynę z ligi — wtedy każdy jej zawodnik dostaje powiadomienie.
/// </summary>
public static class LeagueInvitationEndpoints
{
    public static void Map(RouteGroupBuilder user)
    {
        // Organizator wpisuje nazwę użytkownika kapitana i wybiera jedną z jego drużyn poza ligą.
        user.MapGet("/users/{username}/independent-teams", (string username, DbExecutor db) => db.Query("""
            SELECT t.id, t.name, (SELECT COUNT(*) FROM independent_team_members m WHERE m.team_id = t.id) AS players
            FROM independent_teams t JOIN users u ON u.id = t.owner_id
            WHERE u.username = @username ORDER BY t.name
            """, new { username }));

        user.MapGet("/leagues/{id:long}/invitations", (long id, ClaimsPrincipal principal, DbExecutor db) => db.Query("""
            SELECT i.id, t.name AS team, o.display_name AS captain, o.username AS captainUsername, i.created_at AS createdAt
            FROM league_invitations i
            JOIN leagues l ON l.id = i.league_id
            JOIN independent_teams t ON t.id = i.independent_team_id
            JOIN users o ON o.id = t.owner_id
            WHERE i.league_id = @id AND l.organizer_id = @uid ORDER BY i.created_at
            """, DbExecutor.Params(null, principal, id)));

        user.MapPost("/leagues/{id:long}/invitations", async (long id, LeagueInviteReq request, ClaimsPrincipal principal, DbExecutor db) =>
        {
            var parameters = DbExecutor.Params(request, principal, id);
            await using var connection = db.CreateConnection();
            if (await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM leagues WHERE id = @id AND organizer_id = @uid", parameters) == 0)
                return SecurityExtensions.NotAllowed("Tylko organizator ligi może zapraszać drużyny.");
            if (await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM independent_teams WHERE id = @IndependentTeamId", parameters) == 0)
                return SecurityExtensions.NotAllowed("Nie ma takiej drużyny poza ligą.");
            if (await connection.ExecuteScalarAsync<int>(
                    "SELECT COUNT(*) FROM teams WHERE league_id = @id AND independent_team_id = @IndependentTeamId", parameters) > 0)
                return Results.Conflict(new { message = "Ta drużyna już gra w tej lidze." });
            if (await connection.ExecuteAsync("""
                    INSERT IGNORE INTO league_invitations (league_id, independent_team_id, invited_by) VALUES (@id, @IndependentTeamId, @uid)
                    """, parameters) == 0)
                return Results.Conflict(new { message = "Ta drużyna ma już zaproszenie do tej ligi." });
            return Results.NoContent();
        });

        user.MapDelete("/leagues/{id:long}/invitations/{invitationId:long}", (long id, long invitationId, ClaimsPrincipal principal, DbExecutor db) => db.Exec("""
            DELETE i FROM league_invitations i JOIN leagues l ON l.id = i.league_id
            WHERE i.id = @invitationId AND i.league_id = @id AND l.organizer_id = @uid
            """, DbExecutor.Params(new { invitationId }, principal, id)));

        user.MapPost("/league-invitations/{id:long}/accept", async (long id, ClaimsPrincipal principal, DbExecutor db) =>
        {
            await using var connection = db.CreateConnection();
            await connection.OpenAsync();
            await using var transaction = await connection.BeginTransactionAsync();
            var invitation = await connection.QueryFirstOrDefaultAsync<(long LeagueId, long TeamId, string Team, string League, long OrganizerId)>("""
                SELECT i.league_id, t.id, t.name, l.name, l.organizer_id
                FROM league_invitations i
                JOIN independent_teams t ON t.id = i.independent_team_id
                JOIN leagues l ON l.id = i.league_id
                WHERE i.id = @id AND t.owner_id = @uid
                FOR UPDATE
                """, DbExecutor.Params(null, principal, id), transaction);
            if (invitation == default)
                return SecurityExtensions.NotAllowed("Zaproszenie nie istnieje lub zostało wycofane.");

            var target = new { invitation.LeagueId, invitation.TeamId, invitation.Team, uid = principal.Uid() };
            if (await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM teams WHERE league_id = @LeagueId AND name = @Team", target, transaction) > 0)
                return Results.Conflict(new { message = $"W lidze jest już drużyna o nazwie „{invitation.Team}”. Zmień nazwę swojej drużyny i spróbuj ponownie." });
            var busy = (await connection.QueryAsync<string>("""
                SELECT u.display_name FROM independent_team_members m
                JOIN team_members lm ON lm.user_id = m.user_id AND lm.league_id = @LeagueId
                JOIN users u ON u.id = m.user_id
                WHERE m.team_id = @TeamId ORDER BY u.display_name
                """, target, transaction)).ToList();
            if (busy.Count > 0)
                return Results.Conflict(new { message = $"Ci zawodnicy grają już w innej drużynie tej ligi: {string.Join(", ", busy)}." });

            await connection.ExecuteAsync("INSERT INTO teams (league_id, name, independent_team_id) VALUES (@LeagueId, @Team, @TeamId)", target, transaction);
            var leagueTeamId = await connection.ExecuteScalarAsync<long>("SELECT LAST_INSERT_ID()", transaction: transaction);
            await connection.ExecuteAsync("""
                INSERT INTO team_members (team_id, league_id, user_id, is_captain)
                SELECT @leagueTeamId, @LeagueId, m.user_id, m.user_id = @uid
                FROM independent_team_members m WHERE m.team_id = @TeamId
                """, new { leagueTeamId, invitation.LeagueId, invitation.TeamId, uid = principal.Uid() }, transaction);
            await connection.ExecuteAsync("DELETE FROM league_invitations WHERE id = @id", new { id }, transaction);
            await Notifications.Send(connection, transaction, "SELECT @organizer", new { organizer = invitation.OrganizerId },
                $"Drużyna {invitation.Team} przyjęła zaproszenie do ligi {invitation.League}.");
            await Notifications.Send(connection, transaction,
                "SELECT user_id FROM independent_team_members WHERE team_id = @TeamId AND user_id <> @uid", target,
                $"Twoja drużyna {invitation.Team} dołączyła do ligi {invitation.League}.");
            await transaction.CommitAsync();
            return Results.Ok(new { leagueId = invitation.LeagueId, teamId = leagueTeamId });
        });

        user.MapPost("/league-invitations/{id:long}/reject", async (long id, ClaimsPrincipal principal, DbExecutor db) =>
        {
            await using var connection = db.CreateConnection();
            await connection.OpenAsync();
            await using var transaction = await connection.BeginTransactionAsync();
            var invitation = await connection.QueryFirstOrDefaultAsync<(string Team, string League, long OrganizerId)>("""
                SELECT t.name, l.name, l.organizer_id
                FROM league_invitations i
                JOIN independent_teams t ON t.id = i.independent_team_id
                JOIN leagues l ON l.id = i.league_id
                WHERE i.id = @id AND t.owner_id = @uid
                """, DbExecutor.Params(null, principal, id), transaction);
            if (invitation == default)
                return SecurityExtensions.NotAllowed("Zaproszenie nie istnieje lub zostało wycofane.");
            await connection.ExecuteAsync("DELETE FROM league_invitations WHERE id = @id", new { id }, transaction);
            await Notifications.Send(connection, transaction, "SELECT @organizer", new { organizer = invitation.OrganizerId },
                $"Drużyna {invitation.Team} odrzuciła zaproszenie do ligi {invitation.League}.");
            await transaction.CommitAsync();
            return Results.NoContent();
        });

        // Usunięcie drużyny z ligi (organizator). Rozegrane mecze to historia tabeli, więc drużyna, która je ma, zostaje.
        // Zaplanowane mecze drużyny są usuwane razem z nią, a każdy jej zawodnik dostaje powiadomienie.
        user.MapDelete("/teams/{id:long}", async (long id, ClaimsPrincipal principal, DbExecutor db) =>
        {
            await using var connection = db.CreateConnection();
            await connection.OpenAsync();
            await using var transaction = await connection.BeginTransactionAsync();
            var team = await connection.QueryFirstOrDefaultAsync<(string Team, string League)>("""
                SELECT t.name, l.name FROM teams t JOIN leagues l ON l.id = t.league_id
                WHERE t.id = @id AND l.organizer_id = @uid FOR UPDATE
                """, DbExecutor.Params(null, principal, id), transaction);
            if (team == default) return SecurityExtensions.NotAllowed();
            const string teamGames = "(home_team_id = @id OR away_team_id = @id)";
            if (await connection.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM games WHERE {teamGames} AND home_score IS NOT NULL", new { id }, transaction) > 0)
                return Results.Conflict(new { message = "Drużyna ma rozegrane mecze — usunięcie zmieniłoby historię tabeli, więc nie można jej usunąć z ligi." });
            await Notifications.Send(connection, transaction, "SELECT user_id FROM team_members WHERE team_id = @id", new { id },
                $"Drużyna {team.Team} została usunięta z ligi {team.League}.");
            await connection.ExecuteAsync($"DELETE FROM games WHERE {teamGames}", new { id }, transaction);
            await connection.ExecuteAsync("DELETE FROM teams WHERE id = @id", new { id }, transaction);
            await transaction.CommitAsync();
            return Results.NoContent();
        });

        // ---------- Powiadomienia: wszystko, co czeka na zalogowanego użytkownika ----------
        user.MapGet("/notifications", async (ClaimsPrincipal principal, DbExecutor db) =>
        {
            var uid = new { uid = principal.Uid() };
            await using var connection = db.CreateConnection();
            var invitations = await connection.QueryAsync("""
                SELECT i.id, t.id AS teamId, t.name AS team, u.display_name AS invitedBy, i.created_at AS createdAt
                FROM team_invitations i
                JOIN independent_teams t ON t.id = i.team_id
                JOIN users u ON u.id = i.invited_by
                WHERE i.user_id = @uid ORDER BY i.created_at DESC
                """, uid);
            var leagueInvitations = await connection.QueryAsync("""
                SELECT i.id, l.id AS leagueId, l.name AS league, l.sport, t.name AS team, u.display_name AS invitedBy, i.created_at AS createdAt
                FROM league_invitations i
                JOIN independent_teams t ON t.id = i.independent_team_id
                JOIN leagues l ON l.id = i.league_id
                JOIN users u ON u.id = i.invited_by
                WHERE t.owner_id = @uid ORDER BY i.created_at DESC
                """, uid);
            var teamInvitations = await connection.QueryAsync("""
                SELECT i.id, t.name AS team, l.name AS league, l.id AS leagueId, u.display_name AS invitedBy, i.created_at AS createdAt
                FROM league_team_invitations i
                JOIN teams t ON t.id = i.team_id
                JOIN leagues l ON l.id = i.league_id
                JOIN users u ON u.id = i.invited_by
                WHERE i.user_id = @uid ORDER BY i.created_at DESC
                """, uid);
            var messages = await connection.QueryAsync(
                "SELECT id, message, created_at AS createdAt FROM notifications WHERE user_id = @uid ORDER BY created_at DESC, id DESC LIMIT 50", uid);
            return Results.Ok(new { invitations, leagueInvitations, teamInvitations, messages });
        });

        user.MapDelete("/notifications/{id:long}", (long id, ClaimsPrincipal principal, DbExecutor db) => db.Exec(
            "DELETE FROM notifications WHERE id = @id AND user_id = @uid", DbExecutor.Params(null, principal, id)));

        user.MapDelete("/notifications", async (ClaimsPrincipal principal, DbExecutor db) =>
        {
            await using var connection = db.CreateConnection();
            await connection.ExecuteAsync("DELETE FROM notifications WHERE user_id = @uid", new { uid = principal.Uid() });
            return Results.NoContent();
        });
    }
}
