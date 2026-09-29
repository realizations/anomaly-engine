using System;
using System.IO;
using System.Text.Json;
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
    private StateStore? _stateStore;
    private WebView2? _webView;
    private Window? _hostWindow;
    private IntPtr _workerW;
    private bool _userPaused;
    private bool _fullscreenPaused;
    private bool _scriptPaused;
    private bool _isRunning;
    private readonly string _rendererPath;

    public WallpaperHost(Logger logger, MonitorManager monitorManager, StateStore? stateStore = null)
    {
        _logger = logger;
        _monitorManager = monitorManager;
        _stateStore = stateStore;
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

        // Hand the renderer its saved state as soon as the page exists, so a
        // restored world and style apply on the very first frame.
        if (_stateStore != null)
        {
            var json = _stateStore.StateJson;
            if (json.Length > 2) PushState(json);
        }
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            // postMessage(object) is delivered as JSON, not as a string.
            // TryGetWebMessageAsString throws for object messages, which
            // silently discarded every state save.
            var json = string.IsNullOrWhiteSpace(e.WebMessageAsJson)
                ? e.TryGetWebMessageAsString()
                : e.WebMessageAsJson;
            if (string.IsNullOrWhiteSpace(json)) return;

            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return;
            var type = root.TryGetProperty("type", out var t) ? t.GetString() : null;

            switch (type)
            {
                case "state:save":
                    if (root.TryGetProperty("payload", out var p) &&
                        p.TryGetProperty("state", out var st) &&
                        st.ValueKind == JsonValueKind.Object)
                    {
                        SaveState(st.GetRawText());
                    }
                    break;
                case "ready":
                    _logger.Debug("Renderer signalled ready.");
                    break;
                default:
                    _logger.Debug($"Web message: {type}");
                    break;
            }
        }
        catch (Exception ex)
        {
            _logger.Warn($"Bad web message: {ex.Message}");
        }
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
        _userPaused = true;
        _scriptPaused = true;

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
        _userPaused = true;
        ApplyPauseState();
    }

    public void Resume()
    {
        _userPaused = false;
        ApplyPauseState();
    }

    // A manual pause and a fullscreen pause are independent: closing a
    // fullscreen app must not resume a wallpaper the user paused on purpose.
    private void ApplyPauseState()
    {
        var shouldPause = _userPaused || _fullscreenPaused;
        if (shouldPause == _scriptPaused) return;
        _scriptPaused = shouldPause;

        _ = ExecuteScriptSafe(shouldPause
            ? "window.dispatchEvent(new CustomEvent('anomaly:pause'));"
            : "window.dispatchEvent(new CustomEvent('anomaly:resume'));");

        _logger.Info(shouldPause
            ? $"Wallpaper paused (user={_userPaused}, fullscreen={_fullscreenPaused})."
            : "Wallpaper resumed.");
    }

    public void SetStyle(string style)
    {
        var safe = style switch
        {
            "flat" => "flat",
            "riso" => "riso",
            _ => "painterly"
        };
        _logger.Info($"Art style set to {safe}.");
        _ = ExecuteScriptSafe($"window.dispatchEvent(new CustomEvent('anomaly:style', {{ detail: {{ style: '{safe}' }} }}));");
    }

    /// <summary>Dispatches a renderer event by its short name, e.g. "notes".</summary>
    public void SendToRenderer(string eventName)
    {
        _ = ExecuteScriptSafe($"window.dispatchEvent(new CustomEvent('anomaly:{eventName}'));");
    }

    private static readonly string[] StyleOrder = { "painterly", "flat", "riso" };
    private int _styleIndex;

    public void CycleStyle()
    {
        _styleIndex = (_styleIndex + 1) % StyleOrder.Length;
        var style = StyleOrder[_styleIndex];
        _logger.Info($"Hotkey: art style -> {style}");
        _ = ExecuteScriptSafe(
            $"window.dispatchEvent(new CustomEvent('anomaly:style', {{ detail: {{ style: '{style}' }} }}));");
    }

    /// <summary>Evaluates an expression in the page and returns its value as JSON.</summary>
    public async Task<string?> EvaluateAsync(string expression)
    {
        try
        {
            if (_webView?.CoreWebView2 == null) return null;
            return await _webView.CoreWebView2.ExecuteScriptAsync(expression);
        }
        catch (Exception ex)
        {
            _logger.Warn($"Evaluate failed ({expression}): {ex.Message}");
            return null;
        }
    }

    /// <summary>Activates a world by id.</summary>
    public void SetWorld(string id)
    {
        var safe = id.Replace("'", "\\'");
        _ = ExecuteScriptSafe(
            $"window.dispatchEvent(new CustomEvent('anomaly:world', {{ detail: {{ world: '{safe}' }} }}));");
    }

    /// <summary>Passes user-supplied world definitions into the renderer.</summary>
    public void ImportWorlds(string json)
    {
        var safe = json.Replace("\\", "\\\\").Replace("'", "\\'");
        _ = ExecuteScriptSafe(
            $"window.dispatchEvent(new CustomEvent('anomaly:worlds', {{ detail: {{ worlds: JSON.parse('{safe}') }} }}));");
    }

    public void RemoveWorld(string id)
    {
        var safe = id.Replace("'", "\\'");
        _ = ExecuteScriptSafe(
            $"window.dispatchEvent(new CustomEvent('anomaly:world-remove', {{ detail: {{ world: '{safe}' }} }}));");
    }

    public void SetFpsLimit(int fps)
    {
        _ = ExecuteScriptSafe($"window.__engine && window.__engine.setFpsLimit({fps});");
    }

    public void SetRenderScale(double scale)
    {
        _ = ExecuteScriptSafe($"window.__engine && window.__engine.setRenderScale({scale});");
    }

    public void SetArtStyle(string style)
    {
        SetStyle(style);
    }

    public void ToggleDebug()
    {
        _ = ExecuteScriptSafe("window.dispatchEvent(new CustomEvent('anomaly:debug'));");
    }

    /// <summary>Pushes the saved state document into the page before the engine reads it.</summary>
    public void PushState(string json)
    {
        var safe = json.Replace("\\", "\\\\").Replace("'", "\\'");
        _ = ExecuteScriptSafe(
            $"window.dispatchEvent(new CustomEvent('anomaly:state', {{ detail: JSON.parse('{safe}') }}));");
    }

    /// <summary>Applies a patch pushed up from the renderer.</summary>
    public void SaveState(string json)
    {
        try
        {
            var node = System.Text.Json.Nodes.JsonNode.Parse(json) as System.Text.Json.Nodes.JsonObject;
            if (node is null)
            {
                _logger.Warn("Renderer sent a state patch that was not an object.");
                return;
            }
            _stateStore?.Save(node);
        }
        catch (Exception ex)
        {
            _logger.Warn($"Rejected state patch: {ex.Message}");
        }
    }

    public void OpenCreatorMode()
    {
        _ = ExecuteScriptSafe("window.dispatchEvent(new CustomEvent('anomaly:creator'));");
    }

    public void SetReducedMotion(bool on)
    {
        var v = on ? "true" : "false";
        _ = ExecuteScriptSafe($"window.dispatchEvent(new CustomEvent('anomaly:reduced-motion', {{ detail: {{ on: {v} }} }}));");
        _logger.Info($"Reduced motion {(on ? "enabled" : "disabled")}.");
    }

    public void HandlePowerStateChange(PowerState state)
    {
        if (state == PowerState.Sleep) Pause();
        else if (state == PowerState.Resume) Resume();
    }

    public void HandleFullscreenChange(bool isFullscreen)
    {
        _fullscreenPaused = isFullscreen;
        ApplyPauseState();
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
            _logger.Warn($"Script execution failed: {script} -> {ex.Message}");
        }
    }

    public void Dispose()
    {
        Stop();
    }
}
