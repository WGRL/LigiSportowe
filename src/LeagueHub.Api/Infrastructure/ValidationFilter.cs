using LeagueHub.Api.Contracts;

namespace LeagueHub.Api.Infrastructure;

public sealed class ValidationFilter : IEndpointFilter
{
    public ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var error = context.Arguments.OfType<IValid>().Select(request => request.Error())
            .FirstOrDefault(message => message is not null);
        return error is null
            ? next(context)
            : ValueTask.FromResult<object?>(SecurityExtensions.Bad(error));
    }
}