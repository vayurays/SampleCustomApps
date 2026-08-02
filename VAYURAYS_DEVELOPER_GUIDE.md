# VayuRays Developer Guide: Extensibility & Custom App Development

Welcome to the **VayuRays Developer Guide**. This document is designed for third-party developers, integrators, and system architects who want to build custom web applications, specialized control interfaces, custom API controllers, and protocol extensions for the **VayuRays Building Automation & Data Acquisition Platform**.

---

## 1. Architectural Overview

VayuRays follows a modular extensibility framework. The core system consists of the following components:

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
* **Plugin Drop-in Location**: Custom plugins reside in `customApps/{PluginName}/` relative to the service execution folder. Custom protocol drivers reside in `customDrivers/{DriverName}/`.
* **Backend Extension**: Drop a `{PluginName}.dll` into `customApps/{PluginName}/`. The service dynamically loads it into ASP.NET Core at startup, registering its API routes and `IVayuModule` services.
* **Custom Driver Extension**: Drop a `{DriverName}.dll` into `customDrivers/{DriverName}/`. The application dynamically loads it at startup, discovering any implementations of `IVayuDriverModule` and `IProtocolDriver`.
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

### Logging Audit Events (`IVayuAuditLogger`)
Backend controllers can inject `IVayuAuditLogger` to record security or system events to the VayuRays audit log. This ensures custom apps meet IEC 62443 compliance requirements for security event tracking.

```csharp
using VayuRays.Core.Extensibility;

// Inside your controller:
private readonly IVayuAuditLogger _auditLogger;

public PointsViewController(IVayuAuditLogger auditLogger)
{
    _auditLogger = auditLogger;
}

[HttpPost("action")]
public async Task<IActionResult> PerformAction()
{
    var username = User.Identity?.Name ?? "Unknown";
    var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "Unknown";
    
    // Log the event
    await _auditLogger.LogEventAsync(
        eventType: "CUSTOM_ACTION",
        category: "CustomApp",
        username: username,
        severity: "INFO",
        details: $"User performed action from IP {ip}",
        pluginName: "PointsView"
    );

    return Ok();
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

### Inheriting the Host Theme (Light / Dark Mode)
The VayuRays WebClient passes its active theme down to Custom Apps so they can seamlessly blend with the host interface. This is passed in two ways:
1. **On Load:** The host appends `&theme=light` or `&theme=dark` to the iframe's URL query string.
2. **On Change:** When the user toggles the theme in the host, it broadcasts a `postMessage` event to all iframes so they can update dynamically without reloading.

**Vanilla HTML/JS Example:**
```html
<style>
  /* Define your CSS variables for light and dark modes */
  :root {
    --bg-color: #ffffff;
    --text-color: #333333;
  }
  
  :root[data-theme="dark"] {
    --bg-color: #1a1a1a;
    --text-color: #ffffff;
  }

  body {
    background: var(--bg-color);
    color: var(--text-color);
    transition: background 0.3s, color 0.3s;
  }
</style>

<script>
  // 1. Read the initial theme from the URL query parameters on load
  const urlParams = new URLSearchParams(window.location.search);
  const urlTheme = urlParams.get('theme');
  const initialTheme = (urlTheme === 'dark' || urlTheme === 'light') 
    ? urlTheme 
    : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', initialTheme);

  // 2. Listen for theme change messages from the parent WebClient window
  window.addEventListener('message', (event) => {
    // Security check: Make sure the message is a theme change
    if (event.data && event.data.type === 'THEME_CHANGED') {
      document.documentElement.setAttribute('data-theme', event.data.theme);
    }
  });
</script>
```

**React / TS Example (Tailwind CSS compatible):**
```typescript
import { useEffect, useState } from 'react';

export function useVayuTheme() {
  const [theme, setTheme] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const urlTheme = params.get('theme');
    if (urlTheme === 'dark' || urlTheme === 'light') return urlTheme;
    // Fallback to system preference if testing standalone in debug
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'THEME_CHANGED') {
        setTheme(event.data.theme);
        // Toggle the 'dark' class on the document root (for Tailwind)
        if (event.data.theme === 'dark') document.documentElement.classList.add('dark');
        else document.documentElement.classList.remove('dark');
      }
    };
    
    // Set initial class
    if (theme === 'dark') document.documentElement.classList.add('dark');

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return theme;
}
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
4. **Deploy**: Copy the `PointsView` folder into `C:\TT\VayuRays\VayuRays.Service\customApps\PointsView\`.
5. **Restart Service**: Restart `VayuRays DATA Acquisition Service`. The host will auto-discover your custom app and present it in the navigation tree.

---

## 8. Custom Protocol Drivers (.NET)

VayuRays supports dropping in custom protocol drivers (e.g., for proprietary hardware or IoT devices) alongside the native BACnet and Modbus drivers.

### Project Setup
Create a .NET Class Library project (targeting `net10.0` or `.NET 8/9` compatible). Add a reference to `VayuRays.Core.dll`.

### Implementing `IVayuDriverModule`
Every custom driver must implement `IVayuDriverModule` to register itself:

```csharp
using System.Collections.Generic;
using VayuRays.Core.Extensibility;
using VayuRays.Core.Models;

namespace MyCustomDriver;

public class MyDriverModule : IVayuDriverModule
{
    public string Name => "MyCustomDriver";
    public string Description => "A custom protocol driver for MyDevice";

    public IEnumerable<ProtocolKey> GetSupportedProtocols()
    {
        // Must use an ID >= 100 for custom protocols to avoid conflicting with built-in ones
        yield return new ProtocolKey(100, "MyProtocol");
    }

    public IProtocolDriver CreateDriver(ProtocolKey protocolKey)
    {
        if (protocolKey.Id == 100)
        {
            return new MyProtocolDriver();
        }
        return null;
    }
}
```

### Implementing `IProtocolDriver`
The `IProtocolDriver` implementation handles discovering, connecting, and reading data from devices.

```csharp
using System.Threading;
using System.Threading.Tasks;
using System.Collections.Generic;
using Microsoft.Extensions.Logging;
using VayuRays.Core.Extensibility;
using VayuRays.Core.Models;

namespace MyCustomDriver;

public class MyProtocolDriver : IProtocolDriver
{
    public Task InitializeAsync(ILogger logger, Dictionary<string, string> appSettings, CancellationToken cancellationToken)
    {
        // Initialize connection pools, background threads, or configuration here
        return Task.CompletedTask;
    }

    public Task<List<DiscoveredDevice>> DiscoverDevicesAsync(CancellationToken cancellationToken)
    {
        // Broadcast or scan for devices on the network
        return Task.FromResult(new List<DiscoveredDevice>());
    }

    public Task<List<DiscoveredPoint>> DiscoverPointsAsync(string deviceId, string deviceAddress, CancellationToken cancellationToken)
    {
        // Interrogate a specific device for its available points
        return Task.FromResult(new List<DiscoveredPoint>());
    }

    public Task<PointReadResult> ReadPointAsync(string deviceId, string deviceAddress, string pointIdentifier, CancellationToken cancellationToken)
    {
        // Read a single point's value
        return Task.FromResult(new PointReadResult { Value = 42.0, IsSuccess = true });
    }

    public Task<Dictionary<string, PointReadResult>> ReadPointsBatchAsync(string deviceId, string deviceAddress, List<string> pointIdentifiers, CancellationToken cancellationToken)
    {
        // (Optional) Optimize reading multiple points from the same device
        var results = new Dictionary<string, PointReadResult>();
        foreach (var id in pointIdentifiers)
        {
            results[id] = new PointReadResult { Value = 42.0, IsSuccess = true };
        }
        return Task.FromResult(results);
    }
}
```

### Deployment
Compile your driver to produce `{DriverName}.dll`. Drop the DLL into:
1. `C:\Program Files\VayuRays\Service\customDrivers\{DriverName}\` (for the Service)
2. `C:\Program Files\VayuRays\ConfigApp\customDrivers\{DriverName}\` (for the Config App)

Upon restarting the applications, the new protocol will automatically appear in the Device Explorer protocol dropdown, and the Worker will be able to poll points associated with that protocol.
