using LeagueHub.Api.Endpoints;
using LeagueHub.Api.Infrastructure;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.Cookies;
using MySqlConnector;

var builder = WebApplication.CreateBuilder(args);
var connectionString = builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException("Ustaw ConnectionStrings__Default (zob. run.sh).");

builder.Services.AddSingleton(new DbExecutor(connectionString));
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(o =>
{
    o.Cookie.Name = "leaguehub.auth";
    o.Cookie.HttpOnly = true;
    o.Cookie.SameSite = SameSiteMode.Strict;
    o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
    o.ExpireTimeSpan = TimeSpan.FromHours(8);
    o.SlidingExpiration = true;
    o.Events.OnRedirectToLogin = c => { c.Response.StatusCode = 401; return Task.CompletedTask; };
    o.Events.OnRedirectToAccessDenied = c => { c.Response.StatusCode = 403; return Task.CompletedTask; };
});
builder.Services.AddAuthorization();
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("auth", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1) }));
});

var app = builder.Build();

app.Use(async (ctx, next) =>
{
    var h = ctx.Response.Headers;
    h.XContentTypeOptions = "nosniff";
    h.XFrameOptions = "DENY";
    h["Referrer-Policy"] = "no-referrer";
    h.ContentSecurityPolicy = "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
    try { await next(); }
    catch (MySqlException e) when (e.Number is 1062 or 1452 or 3819 or 4025)
    {
        var duplicate = e.Number == 1062;
        ctx.Response.StatusCode = duplicate ? 409 : 400;
        await ctx.Response.WriteAsJsonAsync(new
        {
            message = duplicate
                ? "Taki wpis już istnieje (zajęta nazwa lub zawodnik ma już drużynę w tej lidze)."
                : "Niespójne dane (np. ta sama drużyna dwa razy lub drużyna spoza ligi)."
        });
    }
});
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

var api = app.MapGroup("/api");
var user = api.MapGroup("").RequireAuthorization().AddEndpointFilter<ValidationFilter>();
var auth = api.MapGroup("/auth").RequireRateLimiting("auth");

AuthEndpoints.Map(api, auth, user);
LeagueEndpoints.Map(api, user);
SeasonEndpoints.Map(api, user);
TeamEndpoints.Map(user);
GameEndpoints.Map(api, user);

app.Run();
