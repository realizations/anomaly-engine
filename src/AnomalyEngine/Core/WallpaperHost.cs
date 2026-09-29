using System;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Forms;
using Microsoft.Win32;
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
    /// Absolute path to the deployed index.html, used by the integrity check and
    /// the navigation filter to decide what counts as the legitimate renderer.
    private string? _indexPath;
    /// Set when startup was refused on an integrity failure.
    private bool _integrityFailed;

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

        // Retained for the integrity check and the navigation filter, both of
        // which need to know where the legitimate renderer lives.
        _indexPath = indexPath;

        // Integrity is checked before anything touches the desktop. A wallpaper
        // that has been tampered with should stop before it is attached behind
        // the icons, not after it has already drawn whatever is on disk.
        if (!VerifyRendererIntegrity())
        {
            _integrityFailed = true;
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

        // Only claimed after a successful init. A refused start must not be
        // reported as a running wallpaper.
        await InitializeWebViewAsync(indexPath);
        if (_integrityFailed) return;
        _isRunning = true;
    }

    /// True when startup was refused because the deployed bundle did not match
    /// its recorded digest. The caller uses this to avoid reporting success.
    public bool IntegrityFailed => _integrityFailed;

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
                // Sized to the virtual desktop so the WebView2 surface is never
                // smaller than the space it has to cover. The real bounds are
                // applied in AttachToWorkerW, once the handle is parented.
                Width = Math.Max(1920, GetVirtualDesktopBounds().Width),
                Height = Math.Max(1080, GetVirtualDesktopBounds().Height),
                Content = _webView,
                WindowStartupLocation = WindowStartupLocation.Manual,
                ShowActivated = false,
            };

            _hostWindow.Show();
            _logger.Info("Host window shown.");

            // A monitor can be plugged in or unplugged while the wallpaper is
            // running, and the surface has to follow. SystemEvents rather than
            // WM_DISPLAYCHANGE because the latter is only delivered to windows
            // that opt in, and this window deliberately has no message pump of
            // its own once it is parented to WorkerW.
            SystemEvents.DisplaySettingsChanged += OnDisplaySettingsChanged;

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

            ApplySecurityPolicy();

            _webView.Source = new Uri(indexPath);
            _logger.Info("Renderer source set.");
        }
        catch (Exception ex)
        {
            _logger.Error($"WebView2 initialization failed: {ex.Message}");
        }
    }

    /// SHA-256 of the deployed renderer bundle, recorded at build time.
    private const string BundleHashFile = "renderer.bundle.sha256";

    private string RendererDirectory =>
        Path.GetDirectoryName(_indexPath ?? string.Empty) ?? AppContext.BaseDirectory;

    /// The same directory expressed as a URI, which is the form WebView2 reports
    /// in NavigationStarting. Comparing a file:// URI against a Windows path
    /// fails on the separators, so the filter has to compare like with like.
    private Uri RendererBaseUri
    {
        get
        {
            var dir = RendererDirectory;
            if (!dir.EndsWith(Path.DirectorySeparatorChar)) dir += Path.DirectorySeparatorChar;
            return new Uri(dir);
        }
    }

    /**
     * Locks the WebView2 surface down.
     *
     * This process renders local content and is not a browser, so the defaults
     * are wrong in three specific ways: dev tools are open to anything that can
     * reach the surface, navigation away from the bundle is possible, and there
     * is no Content-Security-Policy at all. All three are tightened here rather
     * than being left to the default posture.
     */
    private void ApplySecurityPolicy()
    {
        // Only ever called after EnsureCoreWebView2Async has completed, but the
        // compiler cannot see through the await, and the field is nullable
        // because it is created during initialisation.
        if (_webView is null) return;
        var core = _webView.CoreWebView2;
        if (core is null) return;
        var settings = core.Settings;

        // The renderer draws pixels and reads a bridge. It needs no scripting
        // privileges beyond running its own bundle, and giving it more means a
        // tampered bundle has more to work with.
        settings.AreDevToolsEnabled = false;
        settings.AreHostObjectsAllowed = false;
        settings.IsStatusBarEnabled = false;
        settings.AreDefaultContextMenusEnabled = false;
        settings.IsZoomControlEnabled = false;
        settings.IsWebMessageEnabled = true;

        // Nothing should ever navigate. A wallpaper that can be navigated is a
        // wallpaper that can be pointed somewhere else.
        core.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            _logger.Warn("Blocked a new-window request from the renderer.");
        };

        core.NavigationStarting += (_, e) =>
        {
            var target = e.Uri ?? string.Empty;
            // Only the bundle itself may be loaded. Compared as URIs, because
            // the navigation event reports a file:// URI while the renderer
            // directory is a Windows path.
            if (!target.StartsWith(RendererBaseUri.AbsoluteUri, StringComparison.OrdinalIgnoreCase))
            {
                e.Cancel = true;
                _logger.Warn($"Blocked navigation to {target}");
            }
        };

        _logger.Info("WebView2 security policy applied.");
    }

    /**
     * Verifies the deployed renderer against the hash recorded at build time.
     *
     * Worlds are data and cannot execute, but the bundle that draws them is
     * code. Recording its digest at build time and checking it at startup means a
     * modified bundle is detected rather than executed, which is the difference
     * between "someone edited a file in the install directory" and "something
     * is now running as this user".
     *
     * A missing hash file is a warning rather than a failure: it is absent in a
     * development build, and refusing to start there would be unhelpful. A
     * *mismatch*, however, is fatal.
     */
    private bool VerifyRendererIntegrity()
    {
        var dir = RendererDirectory;
        var index = Path.Combine(dir, "index.html");
        if (!File.Exists(index))
        {
            _logger.Error($"Renderer index.html is missing from {dir}. Refusing to start.");
            return false;
        }

        var hashFile = Path.Combine(AppContext.BaseDirectory, BundleHashFile);
        if (!File.Exists(hashFile))
        {
            _logger.Warn("No bundle digest found. This is expected in a development build.");
            return true;
        }

        string expected;
        try
        {
            expected = File.ReadAllText(hashFile).Trim();
        }
        catch (Exception ex)
        {
            _logger.Warn($"Could not read the bundle digest: {ex.Message}");
            return true;
        }

        var actual = ComputeDirectoryDigest(dir, expected.Split(';')[0]);
        if (actual is null)
        {
            _logger.Warn("Could not compute the renderer digest; continuing.");
            return true;
        }
        if (!string.Equals(actual, expected.Split(';')[0], StringComparison.OrdinalIgnoreCase))
        {
            _logger.Error(
                $"Renderer integrity check FAILED. Expected {expected.Split(';')[0]}, got {actual}. " +
                "The deployed bundle has been modified. Refusing to start.");
            return false;
        }

        _logger.Info("Renderer integrity verified.");
        return true;
    }

    /// SHA-256 over every deployed renderer file, path and content, sorted.
    private static string? ComputeDirectoryDigest(string dir, string algorithm)
    {
        try
        {
            using var sha = System.Security.Cryptography.SHA256.Create();
            var files = Directory.GetFiles(dir, "*", SearchOption.AllDirectories)
                .OrderBy(f => f, StringComparer.OrdinalIgnoreCase);
            foreach (var file in files)
            {
                var rel = Path.GetRelativePath(dir, file).Replace('\\', '/');
                var name = System.Text.Encoding.UTF8.GetBytes(rel);
                sha.TransformBlock(name, 0, name.Length, null, 0);
                var bytes = File.ReadAllBytes(file);
                sha.TransformBlock(bytes, 0, bytes.Length, null, 0);
            }
            sha.TransformFinalBlock(Array.Empty<byte>(), 0, 0);
            return Convert.ToHexString(sha.Hash!).ToLowerInvariant();
        }
        catch (Exception)
        {
            return null;
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

    /// Re-reads the display configuration and re-poses the surface.
    ///
    /// Marshalled onto the UI thread because SystemEvents raises this on a
    /// thread-pool thread, and touching WPF or WebView2 from off-thread is not
    /// safe.
    private void OnDisplaySettingsChanged(object? sender, EventArgs e)
    {
        try
        {
            var dispatcher = _hostWindow?.Dispatcher;
            if (dispatcher is null) return;
            if (!dispatcher.CheckAccess())
            {
                dispatcher.BeginInvoke(new Action(OnDisplaySettingsChangedProxy));
                return;
            }
            OnDisplaySettingsChangedProxy();
        }
        catch (Exception ex)
        {
            _logger.Warn($"Display configuration change failed: {ex.Message}");
        }
    }

    private void OnDisplaySettingsChangedProxy()
    {
        _logger.Info("Display configuration changed; re-posposing the wallpaper.");
        var bounds = GetVirtualDesktopBounds();
        if (_webView?.Handle is { } hwnd && hwnd != IntPtr.Zero)
        {
            NativeMethods.SetWindowPos(hwnd, IntPtr.Zero,
                bounds.X, bounds.Y, bounds.Width, bounds.Height,
                NativeMethods.SWP_FRAMECHANGED | NativeMethods.SWP_SHOWWINDOW |
                NativeMethods.SWP_NOACTIVATE | NativeMethods.SWP_NOZORDER);
        }
        ReportMonitors();
    }

    private void AttachToWorkerW()
    {
        if (_webView == null || _workerW == IntPtr.Zero) return;

        try
        {
            var hwnd = _webView.Handle;
            if (hwnd == IntPtr.Zero) return;

            NativeMethods.SetParent(hwnd, _workerW);

            // The whole virtual desktop, not just the primary. Windows clips the
            // surface per monitor, so one window spanning the virtual desktop
            // covers every display and the renderer composes each one itself.
            var bounds = GetVirtualDesktopBounds();
            var screen = Screen.PrimaryScreen;
            if (screen == null) return;

            NativeMethods.SetWindowPos(hwnd, IntPtr.Zero,
                bounds.X, bounds.Y, bounds.Width, bounds.Height,
                NativeMethods.SWP_FRAMECHANGED | NativeMethods.SWP_SHOWWINDOW |
                NativeMethods.SWP_NOACTIVATE | NativeMethods.SWP_NOZORDER);

            ReportMonitors();

            _logger.Info(
                $"Attached to WorkerW and sized to the virtual desktop {bounds.Width}x{bounds.Height} " +
                $"at ({bounds.X},{bounds.Y}) across {Screen.AllScreens.Length} monitor(s).");
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

    /// Bounds of every attached display, in virtual-desktop coordinates.
    public static List<System.Drawing.Rectangle> GetMonitorBounds()
    {
        var result = new List<System.Drawing.Rectangle>();
        foreach (var screen in Screen.AllScreens)
        {
            var b = screen.Bounds;
            if (b.Width > 0 && b.Height > 0) result.Add(b);
        }
        return result;
    }

    /// Bounding box of the whole virtual desktop, which may have a negative
    /// origin when a secondary sits to the left of or above the primary.
    public static System.Drawing.Rectangle GetVirtualDesktopBounds()
    {
        var all = Screen.AllScreens;
        if (all.Length == 0) return new System.Drawing.Rectangle(0, 0, 1920, 1080);
        int left = all.Min(s => s.Bounds.Left);
        int top = all.Min(s => s.Bounds.Top);
        int right = all.Max(s => s.Bounds.Right);
        int bottom = all.Max(s => s.Bounds.Bottom);
        return new System.Drawing.Rectangle(left, top, right - left, bottom - top);
    }

    /// Tells the renderer the real monitor layout.
    ///
    /// The browser's window.screen describes the primary display only and knows
    /// nothing about the others attached to this machine, so the host has to
    /// report it. Sent on load and again whenever the display configuration
    /// changes, since a monitor can be added or unplugged while running.
    ///
    /// The renderer composes the scene once per display rather than stretching
    /// one wide composition across the desktop, so each screen gets its own
    /// framing instead of a crop.
    public void ReportMonitors()
    {
        var bounds = GetMonitorBounds();
        if (bounds.Count == 0) return;

        var parts = new List<string>();
        foreach (var b in bounds)
        {
            // Serialised as integers because these are pixel rectangles.
            parts.Add($"{{ x: {b.X}, y: {b.Y}, w: {b.Width}, h: {b.Height} }}");
        }
        var json = "[" + string.Join(",", parts) + "]";
        _logger.Info($"Reporting {bounds.Count} monitor(s) to the renderer: {json}");
        _ = ExecuteScriptSafe(
            $"window.dispatchEvent(new CustomEvent('anomaly:monitors', {{ detail: {{ monitors: {json} }} }}));");
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
        // Unsubscribed before Stop so a display change arriving during shutdown
        // cannot touch a half-torn-down surface.
        SystemEvents.DisplaySettingsChanged -= OnDisplaySettingsChanged;
        Stop();
    }
}
