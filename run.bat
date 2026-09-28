@echo off
echo Building renderer...
cd /d "%~dp0src\Engine"
call npm run build

echo Building native host...
cd /d "%~dp0src\AnomalyEngine"
call dotnet build

echo.
echo Starting Anomaly Engine...
echo Press Ctrl+C to stop.
echo.
call dotnet run

pause
