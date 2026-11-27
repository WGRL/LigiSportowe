using System.Security.Claims;
using System.Text.RegularExpressions;
using LeagueHub.Api.Contracts;
using LeagueHub.Api.Infrastructure;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Dapper;

namespace LeagueHub.Api.Endpoints;

public static class AuthEndpoints
{
    private static readonly string DummyHash = BCrypt.Net.BCrypt.HashPassword(Guid.NewGuid().ToString(), 12);

    public static void Map(IEndpointRouteBuilder api, RouteGroupBuilder auth)
    {
        api.MapGet("/auth/me", (ClaimsPrincipal user) => user.Identity?.IsAuthenticated == true
            ? Results.Ok(new { authenticated = true, id = user.Uid(), username = user.Identity.Name })
            : Results.Ok(new { authenticated = false }));

        auth.MapPost("/register", async (Credentials credentials, DbExecutor db) =>
        {
            var name = credentials.Username?.Trim() ?? "";
            if (!Regex.IsMatch(name, "^[A-Za-z0-9_.-]{3,32}$"))
                return SecurityExtensions.Bad("Nazwa użytkownika: 3–32 znaki (litery, cyfry, . _ -).");
            if (!SecurityExtensions.IsStrongPassword(credentials.Password))
                return SecurityExtensions.Bad("Hasło: co najmniej 8 znaków, w tym 1 wielka litera i 1 cyfra.");
            await using var connection = db.CreateConnection();
            await connection.ExecuteAsync("INSERT INTO users (username, password_hash) VALUES (@name, @hash)",
                new { name, hash = BCrypt.Net.BCrypt.HashPassword(credentials.Password, 12) });
            return Results.Created();
        });

        auth.MapPost("/login", async (Credentials credentials, HttpContext context, DbExecutor db) =>
        {
            await using var connection = db.CreateConnection();
            var user = await connection.QueryFirstOrDefaultAsync<(long Id, string Name, string Hash)>(
                "SELECT id, username, password_hash FROM users WHERE username = @name",
                new { name = credentials.Username?.Trim() ?? "" });
            if (!BCrypt.Net.BCrypt.Verify(credentials.Password ?? "", user.Hash ?? DummyHash))
                return Results.Unauthorized();
            await context.SignInAsync(new ClaimsPrincipal(new ClaimsIdentity(
                [new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()), new Claim(ClaimTypes.Name, user.Name)],
                CookieAuthenticationDefaults.AuthenticationScheme)));
            return Results.NoContent();
        });

        api.MapPost("/auth/logout", async (HttpContext context) =>
        {
            await context.SignOutAsync();
            return Results.NoContent();
        });
    }
}