using Microsoft.Extensions.DependencyInjection;
using VayuRays.Core.Extensibility;

namespace PointsView.Backend;

public class PointsViewModule : IVayuModule
{
    public string Name => "PointsView";

    public void ConfigureServices(IServiceCollection services)
    {
        // Custom module initialization or service registrations can be added here
    }
}
