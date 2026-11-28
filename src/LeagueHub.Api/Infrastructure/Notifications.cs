using System.Data;
using Dapper;

namespace LeagueHub.Api.Infrastructure;

/// <summary>Powiadomienia informacyjne (tabela notifications), wysyłane w transakcji operacji, której dotyczą.</summary>
public static class Notifications
{
    /// <summary>Wysyła powiadomienie każdemu użytkownikowi zwróconemu przez <paramref name="recipients"/> (zapytanie z jedną kolumną).</summary>
    public static Task Send(IDbConnection connection, IDbTransaction transaction, string recipients, object parameters, string message)
    {
        var all = new DynamicParameters(parameters);
        all.Add("message", message.Length > 300 ? message[..300] : message);
        return connection.ExecuteAsync($"INSERT INTO notifications (user_id, message) SELECT r.*, @message FROM ({recipients}) r", all, transaction);
    }
}
