using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using VayuRays.Core;
using VayuRays.Core.Models;
using VayuRays.Core.Extensibility;

namespace PointsView.Backend;

[ApiController]
[Route("api/points-view")]
[Authorize]
public class PointsViewController : ControllerBase
{
    private readonly VayuDbContext _db;
    private readonly ILogger<PointsViewController> _logger;

    public PointsViewController(VayuDbContext db, ILogger<PointsViewController> logger)
    {
        _db = db;
        _logger = logger;
    }

    [HttpGet("data")]
    public async Task<IActionResult> GetPointsData()
    {
        try
        {
            var points = await _db.PointDefinitions
                .AsNoTracking()
                .Include(p => p.SavedDevice)
                .Include(p => p.Network)
                .Where(p => !p.IsDeleted)
                .ToListAsync();

            var result = points.Select(p =>
            {
                var pointName = !string.IsNullOrWhiteSpace(p.UserFriendlyName) 
                    ? p.UserFriendlyName 
                    : (!string.IsNullOrWhiteSpace(p.PointName) ? p.PointName : p.PointIdentifier);

                var deviceName = p.SavedDevice?.Name 
                    ?? (!string.IsNullOrWhiteSpace(p.DeviceName) ? p.DeviceName : "Unmapped Device");

                var networkName = p.Network?.Name 
                    ?? (p.SavedDevice?.Network?.Name ?? "Default Network");

                var category = GetCategory(p);

                return new
                {
                    id = p.Id,
                    pointName = pointName,
                    pointIdentifier = p.PointIdentifier,
                    unit = p.Unit,
                    presentValue = p.PresentValue,
                    deviceName = deviceName,
                    networkName = networkName,
                    hasCommunicationError = p.HasCommunicationError,
                    objectCategory = category,
                    stateTextJson = p.StateTextJson,
                    trueText = p.TrueText,
                    falseText = p.FalseText,
                    isWritable = p.IsWritable,
                    lastUpdated = p.LastUpdated,
                    protocol = p.Protocol.ToString()
                };
            });

            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to retrieve points for PointsView plugin.");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    private static string GetCategory(PointDefinition p)
    {
        if (p is BacnetPointDefinition bp)
        {
            var ot = (bp.ConnectionDetails?.BacnetObjectType ?? string.Empty).ToUpperInvariant();
            if (ot.Contains("BINARY")) return "Binary";
            if (ot.Contains("MULTI_STATE") || ot.Contains("MULTISTATE")) return "MultiState";
            return "Analog";
        }

        if (p is ModbusPointDefinition mp)
        {
            var dt = (mp.ConnectionDetails?.ModbusDataType ?? string.Empty).ToUpperInvariant();
            if (dt == "BOOL") return "Binary";
            return "Analog";
        }

        var id = (p.PointIdentifier ?? string.Empty).ToUpperInvariant();
        if (id.Contains("BINARY") || id.Contains("DIGITAL")) return "Binary";
        if (id.Contains("MULTI_STATE") || id.Contains("MULTISTATE")) return "MultiState";

        return "Analog";
    }
}
