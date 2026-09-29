@echo off
REM Anomaly Engine - build and run.
REM Stops any running instance first: the host keeps its own .exe locked while
REM it is running, which makes the rebuild fail with MSB3027.

taskkill /IM AnomalyEngine.exe /F >nul 2>&1
timeout /t 1 /nobreak >nul

echo Building renderer...
cd /d "%~dp0src\Engine"
call npm run build
if errorlevel 1 (
  echo Renderer build failed.
  pause
  exit /b 1
)

echo Building native host...
cd /d "%~dp0src\AnomalyEngine"
call dotnet build
if errorlevel 1 (
  echo Native build failed.
  pause
  exit /b 1
)

echo.
echo Starting Anomaly Engine...
echo Tray icon: right-click for art style, reduced motion, debug and creator mode.
echo Press Ctrl+C to stop.
echo.
call dotnet run

pause
