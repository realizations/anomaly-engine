using System;
using System.IO;
using System.Runtime.InteropServices;
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
    private IntPtr _workerW;
    private bool _isPaused;
    private bool _isRunning;
    private string _rendererPath;
    private TaskCompletionSource<bool> _initTcs = new();

    public WallpaperHost(Logger logger, MonitorManager monitorManager)
    {
        _logger = logger;
        _monitorManager = monitorManager;
        _rendererPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "renderer");
    }

    public async Task Start()
    {
        if (_isRunning) return;

        _logger.Info("Starting wallpaper host...");

        if (!Directory.Exists(_rendererPath))
        {
            _logger.Error($"Renderer directory not found: {_rendererPath}");
            return;
        }

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
        _isRunning = true;

        await InitializeWebViewAsync();

        _logger.Info("Wallpaper host started.");
    }

    public void Stop()
    {
        if (!_isRunning) return;

        _logger.Info("Stopping wallpaper host...");

        _isPaused = true;
        _webView?.Dispose();
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

    private async Task InitializeWebViewAsync()
    {
        try
        {
            _logger.Info("Initializing WebView2...");

            var userDataDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "AnomalyEngine", "WebView2Data");
            Directory.CreateDirectory(userDataDir);

            var env = await CoreWebView2Environment.CreateAsync(null, userDataDir);
            _logger.Info("WebView2 environment created.");

            _webView = new WebView2();
            _webView.NavigationCompleted += OnNavigationCompleted;
            _webView.WebMessageReceived += OnWebMessageReceived;

            await _webView.EnsureCoreWebView2Async(env);
            _logger.Info("WebView2 core initialized.");

            _webView.Source = new Uri(Path.Combine(_rendererPath, "index.html"));
            _logger.Info($"Renderer source set: {_rendererPath}");
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
        var message = e.TryGetWebMessageAsString();
        _logger.Debug($"Web message: {message}");
    }

    private void AttachToWorkerW()
    {
        if (_webView == null || _workerW == IntPtr.Zero) return;

        try
        {
            var hwnd = _webView.Handle;
            if (hwnd == IntPtr.Zero)
            {
                _logger.Error("WebView2 handle is zero.");
                return;
            }

            NativeMethods.SetParent(hwnd, _workerW);

            var screen = Screen.PrimaryScreen!;
            NativeMethods.SetWindowPos(hwnd, NativeMethods.HWND_BOTTOM,
                screen.Bounds.X, screen.Bounds.Y, screen.Bounds.Width, screen.Bounds.Height,
                NativeMethods.SWP_FRAMECHANGED | NativeMethods.SWP_SHOWWINDOW | NativeMethods.SWP_NOACTIVATE);

            _logger.Info("Attached to WorkerW.");
        }
        catch (Exception ex)
        {
            _logger.Error($"Failed to attach to WorkerW: {ex.Message}");
        }
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

    private IntPtr FindWorkerW()
    {
        var progman = NativeMethods.FindWindow("Progman", null);
        if (progman == IntPtr.Zero) return IntPtr.Zero;

        NativeMethods.SendMessage(progman, 0x052C, new IntPtr(0), new IntPtr(0));

        IntPtr workerW = IntPtr.Zero;
        var attempts = 0;
        while (workerW == IntPtr.Zero && attempts < 10)
        {
            workerW = FindWorkerWRecursive(progman);
            if (workerW == IntPtr.Zero)
            {
                Thread.Sleep(100);
                NativeMethods.SendMessage(progman, 0x052C, new IntPtr(0), new IntPtr(0));
            }
            attempts++;
        }

        if (workerW == IntPtr.Zero)
        {
            workerW = FindWorkerWAlternative();
        }

        return workerW;
    }

    private IntPtr FindWorkerWRecursive(IntPtr parent)
    {
        var shellDLLDefView = NativeMethods.FindWindowEx(parent, IntPtr.Zero, "SHELLDLL_DefView", null);
        if (shellDLLDefView != IntPtr.Zero)
        {
            var workerW = NativeMethods.FindWindowEx(shellDLLDefView, IntPtr.Zero, "WorkerW", null);
            if (workerW != IntPtr.Zero) return workerW;
        }

        var child = NativeMethods.FindWindowEx(parent, IntPtr.Zero, null, null);
        while (child != IntPtr.Zero)
        {
            var result = FindWorkerWRecursive(child);
            if (result != IntPtr.Zero) return result;
            child = NativeMethods.FindWindowEx(parent, child, null, null);
        }

        return IntPtr.Zero;
    }

    private IntPtr FindWorkerWAlternative()
    {
        var progman = NativeMethods.FindWindow("Progman", null);
        if (progman == IntPtr.Zero) return IntPtr.Zero;

        var shellDLLDefView = NativeMethods.FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
        if (shellDLLDefView != IntPtr.Zero)
        {
            var workerWChild = NativeMethods.FindWindowEx(shellDLLDefView, IntPtr.Zero, "WorkerW", null);
            if (workerWChild != IntPtr.Zero) return workerWChild;
        }

        var workerWDirect = NativeMethods.FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);
        if (workerWDirect != IntPtr.Zero) return workerWDirect;

        return IntPtr.Zero;
    }

    public void Dispose()
    {
        Stop();
        if (_webView != null)
        {
            _webView.NavigationCompleted -= OnNavigationCompleted;
            _webView.WebMessageReceived -= OnWebMessageReceived;
            _webView.Dispose();
        }
    }
}
