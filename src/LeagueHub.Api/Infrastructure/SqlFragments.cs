namespace LeagueHub.Api.Infrastructure;

public static class SqlFragments
{
    public const string TeamAccess = """
        JOIN leagues l ON l.id = t.league_id
        LEFT JOIN team_members cap ON cap.team_id = t.id AND cap.user_id = @uid AND cap.is_captain
        """;

    public const string CanManageTeam = "(l.organizer_id = @uid OR cap.user_id IS NOT NULL)";
    public const string GameAccess = "JOIN seasons s ON s.id = g.season_id JOIN leagues l ON l.id = s.league_id";
}