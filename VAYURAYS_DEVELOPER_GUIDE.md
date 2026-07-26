# VayuRays Developer Guide: Extensibility & Custom App Development

Welcome to the **VayuRays Developer Guide**. This document is designed for third-party developers, integrators, and system architects who want to build custom web applications, specialized control interfaces, custom API controllers, and protocol extensions for the **VayuRays Building Automation & Data Acquisition Platform**.

---

## 1. Architectural Overview

VayuRays follows a modular, Niagara-style extensibility framework. The core system consists of the following components:

```
                  ┌─────────────────────────────────────────┐
                  │          VayuRays.WebClient             │
                  │      (Host Management Dashboard)        │
                  └────────────────────┬────────────────────┘
                                       │ embeds in iframe
                                       ▼
                  ┌─────────────────────────────────────────┐
                  │    Custom Apps (e.g. PointsView)        │
                  │  /apps/{PluginName}/dist/index.html     │
                  └────────────────────┬────────────────────┘
                                       │ REST / WebSocket
                                       ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │                            VayuRays.Service                             │
 │  ┌───────────────────────┐   ┌───────────────────────────────────────┐  │
 │  │ ASP.NET Core Kestrel  │   │     Worker Background Acquisition     │  │
 │  │ (JWT, REST, WebSocket)│   │       (1s Base Acquisition Loop)      │  │
 │  └───────────┬───────────┘   └───────────────────┬───────────────────┘  │
 │              │ Loads Plugin DLLs                 │ Stream Live Updates  │
 │              ▼                                   ▼                      │
 │  ┌───────────────────────┐   ┌───────────────────────────────────────┐  │
 │  │ customApps/{Plugin}/  │   │          LiveValuePublisher           │  │
 │  │   {PluginName}.dll    │   │         (ILiveValuePublisher)         │  │
 │  └───────────────────────┘   └───────────────────────────────────────┘  │
 └─────────────────────────────────────┬───────────────────────────────────┘
                                       │
                                       ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │                             VayuRays.Core                               │
 │         (VayuDbContext / EF Core / Shared Models / Extensibility)       │
 └─────────────────────────────────────────────────────────────────────────┘
```

### Core Extensibility Concepts
* **Host Service**: `VayuRays.Service` hosts Kestrel web server (default HTTP port 5000) and the background acquisition worker.
* **Plugin Drop-in Location**: Custom plugins reside in `customApps/{PluginName}/` relative to the service execution folder.
* **Backend Extension**: Drop a `{PluginName}.dll` into `customApps/{PluginName}/`. The service dynamically loads it into ASP.NET Core at startup, registering its API routes and `IVayuModule` services.
* **Frontend Extension**: Place built static web assets in `customApps/{PluginName}/dist/`. The host serves these under `/apps/{PluginName}/index.html`.
* **UI Integration**: The `VayuRays.WebClient` automatically discovers all installed custom apps via `/api/customapps` and renders them in the sidebar tree. Clicking an app embeds it in an `iframe` with the user's JWT token passed via URL query parameters.

---

## 2. Plugin Directory Structure

Every custom app must follow this directory layout inside `customApps/`:

```
customApps/
└── {PluginName}/
    ├── {PluginName}.dll        # Backend controller & module implementation
    ├── manifest.json           # Application display metadata
    └── dist/                   # Built frontend web application
        ├── index.html          # Main HTML entrypoint
        └── assets/             # JS, CSS, and static assets
            ├── index-xxx.js
            └── index-xxx.css
```

### Manifest Schema (`manifest.json`)
The `manifest.json` file configures how the custom app appears in the VayuRays navigation tree:

```json
{
  "name": "PointsView",
  "icon": "Table"
}
```

* `name` (string, required): Display name shown in the sidebar navigation.
* `icon` (string, optional): Lucide icon identifier (e.g. `"Table"`, `"Activity"`, `"Server"`, `"Zap"`). Defaults to `"Package"`.

---

## 3. Backend Plugin Development (.NET)

### Project Setup
Create a .NET Class Library project (targeting `net10.0` or `.NET 8/9` compatible).

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <AssemblyName>PointsView</AssemblyName>
  </PropertyGroup>

  <ItemGroup>
    <FrameworkReference Include="Microsoft.AspNetCore.App" />
  </ItemGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.EntityFrameworkCore" Version="10.0.10" />
  </ItemGroup>

  <ItemGroup>
    <Reference Include="VayuRays.Core">
      <HintPath>..\lib\VayuRays.Core.dll</HintPath>
    </Reference>
  </ItemGroup>
</Project>
```

### Implementing `IVayuModule`
Every backend plugin must implement the `IVayuModule` interface from `VayuRays.Core.Extensibility`:

```csharp
using Microsoft.Extensions.DependencyInjection;
using VayuRays.Core.Extensibility;

namespace PointsView.Backend;

public class PointsViewModule : IVayuModule
{
    public string Name => "PointsView";

    public void ConfigureServices(IServiceCollection services)
    {
        // Register custom dependency injection services here if needed
    }
}
```

### Writing API Controllers
Backend controllers inherit the host's DI container and authentication pipeline. Use `[ApiController]`, `[Route("api/...")]`, and `[Authorize]`:

```csharp
using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using VayuRays.Core;
using VayuRays.Core.Extensibility;

namespace PointsView.Backend;

[ApiController]
[Route("api/points-view")]
[Authorize]
public class PointsViewController : ControllerBase
{
    private readonly VayuDbContext _db;
    private readonly ILogger<PointsViewController> _logger;
    private readonly ILiveValuePublisher _publisher;

    public PointsViewController(
        VayuDbContext db, 
        ILogger<PointsViewController> logger,
        ILiveValuePublisher publisher)
    {
        _db = db;
        _logger = logger;
        _publisher = publisher;

        // Optionally subscribe to live point update events
        _publisher.OnPointUpdated += (sender, e) =>
        {
            // e.Update contains Id, PointIdentifier, Value, CommError, etc.
        };
    }

    [HttpGet("data")]
    public async Task<IActionResult> GetPointsData()
    {
        var points = await _db.PointDefinitions
            .AsNoTracking()
            .Include(p => p.SavedDevice)
            .Include(p => p.Network)
            .Where(p => !p.IsDeleted)
            .ToListAsync();

        return Ok(points.Select(p => new
        {
            id = p.Id,
            pointName = p.UserFriendlyName ?? p.PointName,
            pointIdentifier = p.PointIdentifier,
            unit = p.Unit,
            presentValue = p.PresentValue,
            deviceName = p.SavedDevice?.Name ?? p.DeviceName,
            networkName = p.Network?.Name ?? "Default Network",
            hasCommunicationError = p.HasCommunicationError
        }));
    }
}
```

---

## 4. Frontend Plugin Development (React / TS / HTML)

### Authentication & Token Passing
When the host dashboard loads your custom app inside an `iframe`, it appends the JWT access token in the query string:
`http://localhost:5000/apps/PointsView/index.html?token=eyJhbGciOi...`

Your frontend should extract the token to authorize REST API calls and WebSocket connections:

```typescript
// Extract JWT token from URL query params or fallback to localStorage
const getToken = (): string => {
  const params = new URLSearchParams(window.location.search);
  return params.get('token') || localStorage.getItem('token') || '';
};
```

### Fetching Backend Data (REST)
Include the JWT token in the `Authorization` header:

```typescript
const response = await fetch('/api/points-view/data', {
  headers: {
    'Authorization': `Bearer ${getToken()}`
  }
});
const data = await response.json();
```

### Subscribing to Live WebSocket Updates
Custom apps can connect to the VayuRays live WebSocket feed at `/ws/live?access_token=<JWT>` for real-time present value updates without polling:

```typescript
const connectWebSocket = (onUpdate: (pointUpdate: any) => void) => {
  const token = getToken();
  if (!token) return;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/live?access_token=${token}`;
  const ws = new WebSocket(wsUrl);

  ws.onmessage = (event) => {
    try {
      const update = JSON.parse(event.data);
      // Payload structure:
      // {
      //   id: 12,
      //   pointIdentifier: "1234:OBJECT_ANALOG_INPUT:0",
      //   value: 23.5,
      //   hasCommunicationError: false,
      //   lastUpdated: "2026-07-26T10:00:00Z"
      // }
      if (update && update.pointIdentifier) {
        onUpdate(update);
      }
    } catch (e) {
      console.error("Failed to parse WebSocket message", e);
    }
  };

  ws.onclose = () => {
    // Implement auto-reconnection with exponential backoff
    setTimeout(() => connectWebSocket(onUpdate), 3000);
  };
};
```

---

## 5. Point Types & Formatting Guidelines

VayuRays points are categorized into three object types. Custom apps should format values according to these conventions:

| Object Category | Example BACnet / Modbus Types | Value Display Convention |
| :--- | :--- | :--- |
| **Analog** | `ANALOG_INPUT`, `ANALOG_OUTPUT`, `ANALOG_VALUE`, Float32, Int16 | Formatted to decimal places (e.g. `23.50`). |
| **Binary / Boolean** | `BINARY_INPUT`, `BINARY_OUTPUT`, `BINARY_VALUE`, Coil | State text (e.g. `True` / `False`, `Active` / `Inactive`). **Never formatted with decimals**. |
| **Multi-State** | `MULTI_STATE_INPUT`, `MULTI_STATE_OUTPUT`, `MULTI_STATE_VALUE` | State string from `stateTextJson` array or integer state number. **Never formatted with decimals**. |

### BACnet Unit Code Resolution
BACnet returns engineering unit codes as numeric strings. Translate numeric unit codes into human-readable text:

```typescript
const bacnetUnits: Record<string, string> = {
  '5': 'volts', '19': 'kilowatt-hours', '27': 'hertz', '48': 'kilowatts',
  '56': 'psi', '62': '°C', '64': '°F', '98': '%'
};

const formatUnitText = (rawUnit: string): string => {
  if (!rawUnit || rawUnit === 'Unknown') return 'N/A';
  if (/^\d+$/.test(rawUnit)) {
    return bacnetUnits[rawUnit] || `Unit #${rawUnit}`;
  }
  return rawUnit;
};
```

---

## 6. Host REST API Reference

Custom backend controllers or frontend code can consume the core host APIs:

### 1. Authentication
* **`POST /api/auth/login`**: Authenticates user and returns JWT token.
  * Request: `{ "username": "admin", "password": "..." }`
  * Response: `{ "token": "...", "username": "admin", "role": "Administrator" }`

### 2. Network & Tree Discovery
* **`GET /api/network-explorer/tree`**: Returns full network/device/point hierarchy tree.

### 3. Point Properties
* **`PUT /api/points/{id}/properties`**: Updates point text, units, and multistate JSON.
  * Request: `{ "unit": "°C", "trueText": "On", "falseText": "Off", "stateTextJson": "[\"Off\",\"Low\",\"High\"]" }`

### 4. Point Commanding / Write
* **`POST /api/command/point/{id}`**: Writes a priority value to a BACnet/Modbus point.
  * Request: `{ "value": "25.0" }`

### 5. Custom App Discovery
* **`GET /api/customapps`**: Returns array of all discovered custom apps.

---

## 7. Packaging & Deployment Checklist

To package and release your custom app:

1. **Compile Backend**: Build your .NET project in `Release` mode to produce `{PluginName}.dll`.
2. **Build Frontend**: Run `npm run build` to generate static assets inside `dist/`.
3. **Assemble Bundle**:
   ```
   PointsView/
   ├── PointsView.dll
   ├── manifest.json
   └── dist/
       ├── index.html
       └── assets/
   ```
4. **Deploy**: Copy the `PointsView` folder into `C:\Program Files\VayuRays\VayuRays.Service\customApps\PointsView\`.
5. **Restart Service**: Restart `VayuRays DATA Acquisition Service`. The host will auto-discover your custom app and present it in the navigation tree.
