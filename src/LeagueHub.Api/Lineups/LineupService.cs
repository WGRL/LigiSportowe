using System.Data;
using Dapper;

namespace LeagueHub.Api.Lineups;

public static class LineupService
{
    /// <summary>
    /// Dobiera od nowa kadrę meczu (dla obu drużyn albo tylko <paramref name="teamId"/>).
    /// Wywoływać w transakcji, po sprawdzeniu uprawnień. <paramref name="strategyOverride"/> nie jest zapisywany w meczu.
    /// </summary>
    public static async Task Draw(IDbConnection db, IDbTransaction tx, long gameId, long? teamId = null, string? strategyOverride = null)
    {
        var game = await db.QuerySingleAsync<(long SeasonId, long HomeTeamId, long AwayTeamId, string Format, string Strategy)>("""
            SELECT season_id, home_team_id, away_team_id, lineup_format, lineup_strategy FROM games WHERE id = @gameId FOR UPDATE
            """, new { gameId }, tx);

        var format = LineupTemplates.Format(game.Format) ?? LineupTemplates.Format(LineupTemplates.DefaultFormat)!;
        var strategy = LineupTemplates.Strategy(strategyOverride ?? game.Strategy) ?? LineupTemplates.Strategy(LineupTemplates.DefaultStrategy)!;

        await db.ExecuteAsync(
            "DELETE FROM game_lineups WHERE game_id = @gameId AND (@teamId IS NULL OR team_id = @teamId)",
            new { gameId, teamId }, tx);

        foreach (var team in new[] { game.HomeTeamId, game.AwayTeamId }.Where(t => teamId is null || t == teamId))
        {
            var candidates = await db.QueryAsync<SquadCandidate>("""
                SELECT m.user_id AS UserId, m.is_captain AS IsCaptain, m.joined_at AS JoinedAt,
                       CAST(COALESCE(SUM(gl.role = 'starter'), 0) AS SIGNED) AS Starts,
                       CAST(COUNT(gl.game_id) AS SIGNED) AS Appearances
                FROM team_members m
                LEFT JOIN (game_lineups gl JOIN games g ON g.id = gl.game_id AND g.season_id = @seasonId AND g.id <> @gameId)
                       ON gl.user_id = m.user_id AND gl.team_id = m.team_id
                WHERE m.team_id = @team
                GROUP BY m.user_id, m.is_captain, m.joined_at
                """, new { seasonId = game.SeasonId, gameId, team }, tx);

            var picks = LineupSelector.Select(candidates, format, strategy, Random.Shared);
            await db.ExecuteAsync(
                "INSERT INTO game_lineups (game_id, team_id, user_id, role, slot) VALUES (@gameId, @team, @UserId, @Role, @Slot)",
                picks.Select(p => new { gameId, team, p.UserId, Role = p.Starter ? "starter" : "substitute", p.Slot }), tx);
        }
    }
}
