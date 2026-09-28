using System;
using System.Windows;
using AnomalyEngine.Core;
using AnomalyEngine.SettingsWindow;

namespace AnomalyEngine;

public class EngineApp : Application
{
    private WallpaperHost? _wallpaperHost;
    private TrayIcon? _trayIcon;
    private MonitorManager? _monitorManager;
    private PowerManager? _powerManager;
    private FullscreenDetector? _fullscreenDetector;
    private Logger? _logger;
    private SettingsWindow.SettingsWindow? _settingsWindow;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        _logger = new Logger();
        _logger.Info("Anomaly Engine starting...");

        _monitorManager = new MonitorManager(_logger);
        _powerManager = new PowerManager(_logger);
        _fullscreenDetector = new FullscreenDetector(_logger);

        _wallpaperHost = new WallpaperHost(_logger, _monitorManager);
        _wallpaperHost.Start();

        _trayIcon = new TrayIcon(_logger, _wallpaperHost);
        _trayIcon.Show();

        _powerManager.PowerStateChanged += OnPowerStateChanged;
        _fullscreenDetector.FullscreenStateChanged += OnFullscreenStateChanged;

        _logger.Info("Anomaly Engine started successfully.");
    }

    private void OnPowerStateChanged(object? sender, PowerStateChangedEventArgs e)
    {
        _logger?.Info($"Power state changed: {e.State}");
        _wallpaperHost?.HandlePowerStateChange(e.State);
    }

    private void OnFullscreenStateChanged(object? sender, FullscreenStateChangedEventArgs e)
    {
        _logger?.Info($"Fullscreen state changed: {e.IsFullscreen}");
        _wallpaperHost?.HandleFullscreenChange(e.IsFullscreen);
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _logger?.Info("Anomaly Engine shutting down...");

        _wallpaperHost?.Stop();
        _trayIcon?.Hide();
        _powerManager?.Dispose();
        _fullscreenDetector?.Dispose();
        _monitorManager?.Dispose();
        _logger?.Dispose();

        base.OnExit(e);
    }
}
