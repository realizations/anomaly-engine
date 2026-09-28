using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace AnomalyEngine.Core;

public class WallpaperHost : IDisposable
{
    private readonly Logger _logger;
    private readonly MonitorManager _monitorManager;
    private WebView2? _webView;
    private Window? _hostWindow;
    private IntPtr _workerW;
    private bool _isPaused;
    private bool _isRunning;
    private readonly string _rendererPath;

    public WallpaperHost(Logger logger, MonitorManager monitorManager)
    {
        _logger = logger;
        _monitorManager = monitorManager;
        _rendererPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "renderer");
    }

    public IntPtr WallpaperHandle => _webView?.Handle ?? IntPtr.Zero;

    public async Task Start()
    {
        if (_isRunning) return;

        _logger.Info("Starting wallpaper host...");

        var indexPath = Path.Combine(_rendererPath, "index.html");
        if (!File.Exists(indexPath))
        {
            _logger.Error($"Renderer index.html not found: {indexPath}");
            return;
        }

        var hwnd = FindWorkerW();
        if (hwnd == IntPtr.Zero)
        {
            _logger.Error("Could not find WorkerW window. Wallpaper cannot start.");
            return;
        }

        _workerW = hwnd;
        _logger.Info($"WorkerW found: 0x{hwnd.ToInt64():X}");

        _isRunning = true;
        await InitializeWebViewAsync(indexPath);
    }

    private async Task InitializeWebViewAsync(string indexPath)
    {
        try
        {
            _logger.Info("Initializing WebView2...");

            var userDataDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "AnomalyEngine", "WebView2Data");
            Directory.CreateDirectory(userDataDir);

            _webView = new WebView2();
            _webView.NavigationCompleted += OnNavigationCompleted;
            _webView.WebMessageReceived += OnWebMessageReceived;

            _hostWindow = new Window
            {
                WindowStyle = WindowStyle.None,
                ShowInTaskbar = false,
                ResizeMode = ResizeMode.NoResize,
                Left = -32000,
                Top = -32000,
                Width = 1920,
                Height = 1080,
                Content = _webView,
                WindowStartupLocation = WindowStartupLocation.Manual,
                ShowActivated = false,
            };

            _hostWindow.Show();
            _logger.Info("Host window shown.");

            var forcedHandle = _webView.Handle;
            _logger.Info($"WebView2 HWND: 0x{forcedHandle.ToInt64():X}");

            if (forcedHandle == IntPtr.Zero)
            {
                _logger.Error("WebView2 HWND is zero after host window shown.");
                return;
            }

            var envTask = CoreWebView2Environment.CreateAsync(null, userDataDir);
            var envDone = await Task.WhenAny(envTask, Task.Delay(15000));
            if (envDone != envTask)
            {
                _logger.Error("WebView2 environment creation timed out.");
                return;
            }
            var env = await envTask;
            _logger.Info("WebView2 environment created.");

            var initTask = _webView.EnsureCoreWebView2Async(env);
            var initDone = await Task.WhenAny(initTask, Task.Delay(25000));
            if (initDone != initTask)
            {
                _logger.Error("WebView2 core initialization timed out (25s).");
                return;
            }
            await initTask;
            _logger.Info("WebView2 core initialized.");

            AttachToWorkerW();

            _webView.Source = new Uri(indexPath);
            _logger.Info("Renderer source set.");
        }
        catch (Exception ex)
        {
            _logger.Error($"WebView2 initialization failed: {ex.Message}");
        }
    }

    private void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        if (!e.IsSuccess)
        {
            _logger.Error($"Navigation failed: {e.WebErrorStatus}");
            return;
        }

        _logger.Info("Renderer loaded.");
        AttachToWorkerW();
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        _logger.Debug($"Web message: {e.TryGetWebMessageAsString()}");
    }

    private void AttachToWorkerW()
    {
        if (_webView == null || _workerW == IntPtr.Zero) return;

        try
        {
            var hwnd = _webView.Handle;
            if (hwnd == IntPtr.Zero) return;

            NativeMethods.SetParent(hwnd, _workerW);

            var screen = Screen.PrimaryScreen;
            if (screen == null) return;

            var bounds = screen.Bounds;
            NativeMethods.SetWindowPos(hwnd, IntPtr.Zero,
                bounds.X, bounds.Y, bounds.Width, bounds.Height,
                NativeMethods.SWP_FRAMECHANGED | NativeMethods.SWP_SHOWWINDOW |
                NativeMethods.SWP_NOACTIVATE | NativeMethods.SWP_NOZORDER);

            _logger.Info($"Attached to WorkerW and sized to {bounds.Width}x{bounds.Height}.");
        }
        catch (Exception ex)
        {
            _logger.Error($"Failed to attach to WorkerW: {ex.Message}");
        }
    }

    private IntPtr FindWorkerW()
    {
        var progman = NativeMethods.FindWindow("Progman", null);
        if (progman == IntPtr.Zero) return IntPtr.Zero;

        NativeMethods.SendMessage(progman, 0x052C, IntPtr.Zero, IntPtr.Zero);
        Thread.Sleep(200);

        var shellView = NativeMethods.FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
        if (shellView != IntPtr.Zero)
        {
            var underIcons = NativeMethods.FindWindowEx(shellView, IntPtr.Zero, "WorkerW", null);
            if (underIcons != IntPtr.Zero) return underIcons;
        }

        return NativeMethods.FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);
    }

    public void Stop()
    {
        if (!_isRunning) return;

        _logger.Info("Stopping wallpaper host...");
        _isPaused = true;

        if (_webView != null)
        {
            _webView.NavigationCompleted -= OnNavigationCompleted;
            _webView.WebMessageReceived -= OnWebMessageReceived;
        }

        _hostWindow?.Close();
        _hostWindow = null;
        _webView = null;
        _isRunning = false;
        _logger.Info("Wallpaper host stopped.");
    }

    public void Pause()
    {
        _isPaused = true;
        _ = ExecuteScriptSafe("window.dispatchEvent(new CustomEvent('anomaly:pause'));");
        _logger.Info("Wallpaper paused.");
    }

    public void Resume()
    {
        _isPaused = false;
        _ = ExecuteScriptSafe("window.dispatchEvent(new CustomEvent('anomaly:resume'));");
        _logger.Info("Wallpaper resumed.");
    }

    public void HandlePowerStateChange(PowerState state)
    {
        if (state == PowerState.Sleep) Pause();
        else if (state == PowerState.Resume) Resume();
    }

    public void HandleFullscreenChange(bool isFullscreen)
    {
        if (isFullscreen) Pause();
        else Resume();
    }

    private async Task ExecuteScriptSafe(string script)
    {
        try
        {
            if (_webView?.CoreWebView2 != null)
            {
                await _webView.CoreWebView2.ExecuteScriptAsync(script);
            }
        }
        catch (Exception ex)
        {
            _logger.Debug($"Script execution failed: {ex.Message}");
        }
    }

    public void Dispose()
    {
        Stop();
    }
}
