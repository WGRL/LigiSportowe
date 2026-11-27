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

    public static void Map(IEndpointRouteBuilder api, RouteGroupBuilder auth, RouteGroupBuilder user)
    {
        api.MapGet("/auth/me", async (ClaimsPrincipal principal, DbExecutor db) =>
        {
            if (principal.Identity?.IsAuthenticated != true)
                return Results.Ok(new { authenticated = false });
            await using var connection = db.CreateConnection();
            var profile = await connection.QueryFirstAsync<(string Username, string DisplayName)>(
                "SELECT username, display_name FROM users WHERE id = @id", new { id = principal.Uid() });
            return Results.Ok(new { authenticated = true, id = principal.Uid(), username = profile.Username, displayName = profile.DisplayName });
        });

        auth.MapPost("/register", async (Credentials credentials, DbExecutor db) =>
        {
            var name = credentials.Username?.Trim() ?? "";
            var displayName = credentials.DisplayName?.Trim() ?? name;
            if (!Regex.IsMatch(name, "^[A-Za-z0-9_.-]{3,32}$"))
                return SecurityExtensions.Bad("Nazwa użytkownika: 3–32 znaki (litery, cyfry, . _ -).");
            if (!Check.Len(displayName, 1, 100))
                return SecurityExtensions.Bad("Nazwa wyświetlana: 1–100 znaków.");
            if (!SecurityExtensions.IsStrongPassword(credentials.Password))
                return SecurityExtensions.Bad("Hasło: co najmniej 8 znaków, w tym 1 wielka litera i 1 cyfra.");
            await using var connection = db.CreateConnection();
            await connection.ExecuteAsync("INSERT INTO users (username, display_name, password_hash) VALUES (@name, @displayName, @hash)",
                new { name, displayName, hash = BCrypt.Net.BCrypt.HashPassword(credentials.Password, 12) });
            return Results.Created();
        });

        user.MapPut("/auth/profile", (DisplayNameReq request, ClaimsPrincipal principal, DbExecutor db) => db.Exec(
            "UPDATE users SET display_name = TRIM(@DisplayName) WHERE id = @uid",
            DbExecutor.Params(request, principal), "Nie udało się zaktualizować nazwy wyświetlanej."));

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