@echo off
REM Build & Packaging Script for PointsView Custom App

setlocal enabledelayedexpansion

echo ==================================================
echo Building PointsView Custom Application
echo ==================================================
echo.

set ROOT=%~dp0
set BACKEND_DIR=%ROOT%PointsView.Backend
set FRONTEND_DIR=%ROOT%PointsView.Frontend
set OUTPUT_DIR=%ROOT%dist_package\PointsView

REM 1. Build Backend
echo [1/3] Building .NET Backend DLL...
cd /d "%BACKEND_DIR%"
dotnet build -c Release
if errorlevel 1 (
    echo ERROR: Backend build failed!
    exit /b 1
)

REM 2. Build Frontend
echo.
echo [2/3] Building React Frontend (dist)...
cd /d "%FRONTEND_DIR%"
call cmd /c "npm run build"
if errorlevel 1 (
    echo ERROR: Frontend build failed!
    exit /b 1
)

REM 3. Create Package Bundle
echo.
echo [3/3] Assembling plugin package in %OUTPUT_DIR%...
if exist "%OUTPUT_DIR%" rmdir /s /q "%OUTPUT_DIR%"
mkdir "%OUTPUT_DIR%"
mkdir "%OUTPUT_DIR%\dist"

copy /y "%BACKEND_DIR%\bin\Release\net10.0\PointsView.dll" "%OUTPUT_DIR%\" >nul
copy /y "%ROOT%manifest.json" "%OUTPUT_DIR%\" >nul
xcopy "%FRONTEND_DIR%\dist" "%OUTPUT_DIR%\dist\" /E /I /Y >nul

echo.
echo ==================================================
echo Build and Packaging Completed Successfully!
echo ==================================================
echo.
echo Plugin Package Location:
echo   %OUTPUT_DIR%
echo.
echo Contents:
echo   - PointsView.dll
echo   - manifest.json
echo   - dist/ (index.html and static web assets)
echo.
echo Deployment Instructions:
echo   Copy the '%OUTPUT_DIR%' folder into your VayuRays Service directory at:
echo   C:\TT\VayuRays\VayuRays.Service\customApps\PointsView
echo.
pause
