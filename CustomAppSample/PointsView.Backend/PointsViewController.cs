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
            var points = await _db.VPoints
                .AsNoTracking()
                .Include(p => p.Source)
                    .ThenInclude(s => s!.SavedDevice)
                .Include(p => p.Network)
                .Include(p => p.Unit)
                .Where(p => !p.IsDeleted)
                .ToListAsync();

            var result = points.Select(p =>
            {
                var pointName = !string.IsNullOrWhiteSpace(p.UserFriendlyName)
                    ? p.UserFriendlyName
                    : (!string.IsNullOrWhiteSpace(p.Name) ? p.Name : p.PointIdentifier);

                var deviceName = p.Source?.SavedDevice?.Name
                    ?? (!string.IsNullOrWhiteSpace(p.DeviceName) ? p.DeviceName : "—");

                var networkName = p.Network?.Name ?? "Default Network";

                var category = GetCategory(p);
                var pointType = GetPointType(p);
                var protocol = GetProtocol(p);

                return new
                {
                    id = p.Id,
                    pointName,
                    pointIdentifier = p.PointIdentifier,
                    unit = p.Unit?.Symbol ?? "",
                    presentValue = p.OutValue,
                    deviceName,
                    networkName,
                    hasCommunicationError = p.Source?.HasCommunicationError ?? false,
                    objectCategory = category,
                    pointType,
                    protocol,

                    // Type-specific fields
                    stateTextJson = (p is EnumPoint ep) ? ep.StateTextJson : null,
                    trueText = (p is BooleanPoint bp) ? bp.TrueText : null,
                    falseText = (p is BooleanPoint bp2) ? bp2.FalseText : null,
                    decimalPrecision = (p is NumericPoint np) ? np.DecimalPrecision : (int?)null,

                    // Manual / Math / Logic fields
                    isWritable = p.IsWritable,
                    isManual = p.IsManual,
                    isMathBlock = p is MathLogicPoint,
                    mathExpression = (p is MathLogicPoint mp2) ? mp2.MathExpression : null,
                    operation = (p is MathLogicPoint mp3) ? mp3.Operation.ToString() : null,

                    errorMessage = p.ErrorMessage,
                    lastUpdated = p.Source?.LastUpdated
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

    private static string GetCategory(VPoint p)
    {
        if (p is BooleanPoint) return "Binary";
        if (p is EnumPoint) return "MultiState";
        if (p is MathLogicPoint) return "Math";
        if (p is StringPoint) return "String";

        // For NumericPoint or fallback, try to infer from BACnet source metadata
        if (p.Source is BacnetPointSrc bps)
        {
            var ot = (bps.BacnetObjectType ?? string.Empty).ToUpperInvariant();
            if (ot.Contains("BINARY")) return "Binary";
            if (ot.Contains("MULTI_STATE") || ot.Contains("MULTISTATE")) return "MultiState";
        }

        if (p.Source is ModbusPointSrc mps)
        {
            var dt = (mps.ModbusDataType ?? string.Empty).ToUpperInvariant();
            if (dt == "BOOL") return "Binary";
        }

        return "Analog";
    }

    private static string GetPointType(VPoint p) => p switch
    {
        MathLogicPoint => "Math",
        BooleanPoint => "Boolean",
        EnumPoint => "Enum",
        StringPoint => "String",
        NumericPoint => "Numeric",
        _ => "Unknown"
    };

    private static string GetProtocol(VPoint p)
    {
        if (p.IsManual) return "Manual";
        if (p is MathLogicPoint) return "Logic";
        return p.Source switch
        {
            BacnetPointSrc => "BACnet",
            ModbusPointSrc => "Modbus",
            MqttPointSrc => "MQTT",
            LogicPointSrc => "Logic",
            _ => p.Network?.Protocol.Key ?? "Unknown"
        };
    }
}
