using System.Security.Claims;
using Dapper;
using MySqlConnector;

namespace LeagueHub.Api.Infrastructure;

public sealed class DbExecutor(string connectionString)
{
    public MySqlConnection CreateConnection() => new(connectionString);

    public async Task<IResult> Query(string sql, object? parameters = null)
    {
        await using var db = CreateConnection();
        return Results.Ok(await db.QueryAsync(sql, parameters));
    }

    public async Task<IResult> Exec(string sql, object parameters, string? notAllowed = null)
    {
        await using var db = CreateConnection();
        return await db.ExecuteAsync(sql, parameters) > 0
            ? Results.NoContent()
            : SecurityExtensions.NotAllowed(notAllowed);
    }

    public async Task<IResult> Insert(string sql, object parameters)
    {
        await using var db = CreateConnection();
        await db.OpenAsync();
        if (await db.ExecuteAsync(sql, parameters) == 0) return SecurityExtensions.NotAllowed();
        return Results.Ok(new { id = await db.ExecuteScalarAsync<long>("SELECT LAST_INSERT_ID()") });
    }

    public static DynamicParameters Params(object? body, ClaimsPrincipal user, long id = 0)
    {
        var parameters = new DynamicParameters(body);
        parameters.Add("uid", user.Uid());
        parameters.Add("id", id);
        return parameters;
    }
}