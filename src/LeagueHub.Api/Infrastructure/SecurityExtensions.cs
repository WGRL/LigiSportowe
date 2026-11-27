using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Mvc;

namespace LeagueHub.Api.Infrastructure;

public static class SecurityExtensions
{
    public static long Uid(this ClaimsPrincipal user) =>
        long.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)!);

    public static IResult Bad(string message) => Results.BadRequest(new { message });

    public static IResult NotAllowed(string? message = null) =>
        Results.NotFound(new { message = message ?? "Nie znaleziono lub brak uprawnień do tej operacji." });

    public static bool IsStrongPassword(string? password) =>
        password is { Length: >= 8 } && Encoding.UTF8.GetByteCount(password) <= 72
        && password.Any(char.IsUpper) && password.Any(char.IsDigit);
}