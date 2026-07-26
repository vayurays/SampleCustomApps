# PointsView - VayuRays Custom Plugin Application

`PointsView` is a standalone Niagara-style extensibility plugin built for the **VayuRays** platform. It provides a real-time, tabular view of all network points with live WebSocket value updates, filtering, sorting, and status monitoring.

---

## 📁 Repository Structure

```
C:\TT\CustomAppSample\
├── PointsView.Backend/       # .NET 10 Class Library (Backend API)
│   ├── PointsViewController.cs
│   ├── PointsViewModule.cs
│   └── PointsView.Backend.csproj
│
├── PointsView.Frontend/      # React + Vite + TypeScript (Web App)
│   ├── src/
│   │   ├── App.tsx          # Main PointsView Tabular Component
│   │   ├── App.css          # Glassmorphism & live update styles
│   │   ├── index.css        # Design system & theme tokens
│   │   └── main.tsx
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
│
├── manifest.json            # Plugin metadata (Name, Icon)
├── build.bat                # One-click build & package script
└── README.md                # Documentation & Deployment Guide
```

---

## 🚀 Key Features

1. **Tabular Data View**:
   - Columns: **Point Name**, **Point Identifier**, **Unit**, **Present Value**, **Device Name**, **Network Name**, **Status**.
   - Live search filtering across all columns.
   - Column sorting (ascending / descending).

2. **Real-time Live Value Updates**:
   - Establishes a WebSocket connection to `/ws/live?access_token=<JWT>` on startup.
   - Listens to native `PointPersistUpdate` events streamed by the host service.
   - Dynamically updates **Present Value** and **Status** cells with flash animations without reloading the page or re-fetching REST APIs.

3. **Smart Value Formatting**:
   - **Binary / Boolean**: Displays custom state text (e.g. `True` / `False`, `Active` / `Inactive`, `Open` / `Closed`) without decimals.
   - **Multi-State**: Resolves state string names from `stateTextJson` (e.g. `State 1`, `Off`, `Low`, `High`) without decimals.
   - **Analog**: Displays formatted double precision values with BACnet engineering unit lookup (e.g., `volts`, `kW`, `°C`, `%`).

---

## 🛠️ Building the Custom App

Run the `build.bat` script in a command prompt:
```cmd
C:\TT\CustomAppSample\build.bat
```

This compiles both backend DLL and frontend Vite assets into a deployable bundle at:
`C:\TT\CustomAppSample\dist_package\PointsView\`

---

## 📦 Manual Deployment to VayuRays Service

To test or deploy `PointsView` into the VayuRays Service:

1. Copy the `PointsView` bundle folder into the host service's `customApps` directory:
   ```cmd
   xcopy "C:\TT\CustomAppSample\dist_package\PointsView" "C:\TT\VayuRays\VayuRays.Service\customApps\PointsView\" /E /I /Y
   ```

2. The host service structure will look like:
   ```
   VayuRays.Service/
   └── customApps/
       └── PointsView/
           ├── PointsView.dll
           ├── manifest.json
           └── dist/
               ├── index.html
               └── assets/
   ```

3. Restart the VayuRays Service. The host will:
   - Dynamically load `PointsView.dll` into `AssemblyLoadContext`.
   - Register `/api/points-view/data` routes into ASP.NET Core MVC.
   - Serve static assets under `/apps/PointsView/index.html`.
   - Discover the app and display **PointsView** in the sidebar navigation tree!
