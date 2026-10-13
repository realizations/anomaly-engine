using System;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Windows;
using System.Windows.Threading;
using AnomalyEngine.Core;
using AnomalyEngine.Tools;

namespace AnomalyEngine;

public class EngineApp : Application
{
    private WallpaperHost? _wallpaperHost;
    private TrayIcon? _trayIcon;
    private MonitorManager? _monitorManager;
    private PowerManager? _powerManager;
    private FullscreenDetector? _fullscreenDetector;
    private HotkeyService? _hotkeys;
    private Logger? _logger;
    private Core.StateStore? _stateStore;

    /// <summary>Set from `--settings` so a desktop shortcut can open the window.</summary>
    public bool ShowSettingsOnStart { get; init; }

    /// <summary>
    /// Set from `--debug`, which `livingwall debug` passes.
    ///
    /// The overlay was reachable only from the tray, so a headless "open the overlay"
    /// needed a mouse. This is the flag that makes `livingwall debug` do something.
    /// </summary>
    public bool ShowDebugOnStart { get; init; }

    /// <summary>
    /// The anomaly kind to fire at start-up, from `--trigger &lt;id&gt;`.
    ///
    /// Null when nothing was asked for. The id is logged rather than used to select a
    /// specific kind: the renderer picks a random one from the registry, because a
    /// named id the renderer does not recognise is dropped without a reply and the
    /// command would look broken.
    /// </summary>
    public string? TriggerOnStart { get; init; }

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        DispatcherUnhandledException += OnDispatcherException;
        AppDomain.CurrentDomain.UnhandledException += OnDomainException;
        TaskScheduler.UnobservedTaskException += OnTaskException;

        ShutdownMode = ShutdownMode.OnExplicitShutdown;

            _logger = new Logger();
            _logger.Info("Anomaly Engine starting...");
            _stateStore = new Core.StateStore(_logger);

            _monitorManager = new MonitorManager(_logger);
        _powerManager = new PowerManager(_logger);
        _fullscreenDetector = new FullscreenDetector(_logger);

        _wallpaperHost = new WallpaperHost(_logger, _monitorManager, _stateStore);
        await _wallpaperHost.Start();

        try
        {
            _trayIcon = new TrayIcon(_logger, _wallpaperHost);

    // Global hotkeys. The wallpaper has no keyboard focus, so these are the only
    // way to drive the engine without reaching for the tray.
    _hotkeys = new HotkeyService(_logger);
    _hotkeys.RendererEvent += (name) =>
    {
        if (name == "style-next") _wallpaperHost.CycleStyle();
        else _wallpaperHost.SendToRenderer(name);
    };
    _hotkeys.PauseToggled += (paused) =>
    {
        _logger.Info($"Hotkey: {(paused ? "paused" : "resumed")}");
        if (paused) _wallpaperHost.Pause();
        else _wallpaperHost.Resume();
    };
    _logger.Info("Global hotkeys: Ctrl+Alt+W/S/P/F/D");
    _trayIcon.Show();

    if (ShowSettingsOnStart)
    {
        // Dispatched rather than opened directly so the window appears after the
        // tray icon has settled. Explicitly fire-and-forget: the result is a
        // DispatcherOperation this code has no reason to await.
        _ = Dispatcher.BeginInvoke(new Action(() => _trayIcon.OpenSettings()));
    }
    }
        catch (Exception ex)
        {
            _logger.Warn($"Tray icon failed to start: {ex.Message}");
            _trayIcon = null;
        }

        _powerManager.PowerStateChanged += OnPowerStateChanged;
        _fullscreenDetector.FullscreenStateChanged += OnFullscreenStateChanged;

        // A refused start must not be reported as a running wallpaper. The host
        // still shows a tray icon so the failure is discoverable and the user can
        // read the log, but the log must not claim success.
        if (_wallpaperHost.IntegrityFailed)
        {
            _logger.Error(
                "Startup refused: the deployed renderer does not match its recorded digest. " +
                "The install directory has been modified since it was built. See the log for the " +
                "expected and actual hashes.");
            return;
        }

        _logger.Info("Anomaly Engine started successfully.");

        if (ShowDebugOnStart)
        {
            // Dispatched for the same reason as the settings window: the renderer has
            // to exist before the overlay can be shown, which is later than this point.
            _ = Dispatcher.BeginInvoke(new Action(() => _wallpaperHost.ToggleDebug()));
            _logger.Info("Debug overlay requested at start-up (--debug).");
        }

        if (TriggerOnStart is { } eventId)
        {
            // Dispatched with a delay rather than immediately, because the trigger is
            // an event into the page and the page is not there yet at this point. The
            // renderer queues events fired before it has a world, so this would be
            // dropped silently -- which is what a `--trigger` that appears to do
            // nothing looks like from a terminal.
            var id = eventId;
            _ = Dispatcher.BeginInvoke(
                new Action(async () =>
                {
                    await Task.Delay(2500);
                    _wallpaperHost.SendToRenderer("trigger");
                    _logger.Info($"Requested a random anomaly at start-up (--trigger {id}).");
                }),
                DispatcherPriority.Background);
        }
    }

    private void OnDispatcherException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        _logger?.Fatal($"Dispatcher exception: {e.Exception}");
        File.AppendAllText(GetCrashLogPath(),
            $"[{DateTime.Now:O}] DISPATCHER: {e.Exception}\r\n\r\n");
    }

    private void OnDomainException(object sender, UnhandledExceptionEventArgs e)
    {
        var ex = e.ExceptionObject as Exception;
        _logger?.Fatal($"Domain exception: {ex?.Message}");
        File.AppendAllText(GetCrashLogPath(),
            $"[{DateTime.Now:O}] DOMAIN: {ex}\r\n\r\n");
    }

    private void OnTaskException(object? sender, UnobservedTaskExceptionEventArgs e)
    {
        _logger?.Error($"Unobserved task exception: {e.Exception.Message}");
    }

    private static string GetCrashLogPath()
    {
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "AnomalyEngine", "logs");
        Directory.CreateDirectory(dir);
        return Path.Combine(dir, "crash.log");
    }

    private void OnPowerStateChanged(object? sender, PowerStateChangedEventArgs e)
    {
        _logger?.Info($"Power state changed: {e.State}");
        _wallpaperHost?.HandlePowerStateChange(e.State);
    }

    private void OnFullscreenStateChanged(object? sender, FullscreenStateChangedEventArgs e)
    {
        // Not Pause()/Resume(). Those set the *user* pause flag, so this handler was
        // clearing a pause the user had asked for: pause the wallpaper from the tray,
        // open a fullscreen app, close it, and the wallpaper came back. The host keeps
        // the two reasons apart and ors them, which is the whole point of
        // HandleFullscreenChange existing -- and it had no callers at all until now.
        _logger?.Info(e.IsFullscreen
            ? "Fullscreen app detected, pausing."
            : "Fullscreen app closed, restoring previous state.");
        _wallpaperHost?.HandleFullscreenChange(e.IsFullscreen);
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _logger?.Info("Anomaly Engine shutting down...");

        try
        {
            _wallpaperHost?.Stop();
            _trayIcon?.Hide();
            _powerManager?.Dispose();
      _fullscreenDetector?.Dispose();
      _hotkeys?.Dispose();
      _stateStore?.Dispose();
      _monitorManager?.Dispose();
        }
        catch (Exception ex)
        {
            _logger?.Error($"Shutdown error: {ex.Message}");
        }

        _logger?.Info("Shutdown complete.");
        _logger?.Dispose();

        base.OnExit(e);
    }
}
