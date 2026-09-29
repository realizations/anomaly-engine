using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

namespace AnomalyEngine.Core;

public class FullscreenStateChangedEventArgs : EventArgs
{
    public bool IsFullscreen { get; set; }
}

public class FullscreenDetector : IDisposable
{
    private readonly Logger _logger;
    private System.Threading.Timer? _timer;
    private bool _lastState;
    private readonly uint _ownProcessId;

    public event EventHandler<FullscreenStateChangedEventArgs>? FullscreenStateChanged;

    public FullscreenDetector(Logger logger)
    {
        _logger = logger;
        _ownProcessId = (uint)Process.GetCurrentProcess().Id;
        _timer = new System.Threading.Timer(
            _ => CheckFullscreen(null), null, TimeSpan.Zero, TimeSpan.FromSeconds(2));
    }

    private static bool IsShellProcess(uint pid)
    {
        try
        {
            using var proc = Process.GetProcessById((int)pid);
            var name = proc.ProcessName;
            return name.Equals("explorer", StringComparison.OrdinalIgnoreCase)
                || name.Equals("dwm", StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    private void CheckFullscreen(object? state)
    {
        try
        {
            var hwnd = NativeMethods.GetForegroundWindow();
            if (hwnd == IntPtr.Zero) return;

            NativeMethods.GetWindowThreadProcessId(hwnd, out var pid);
            if (pid == _ownProcessId) return;

            // The shell owns the desktop, Progman and the WorkerW we are parented into.
            // Those cover the whole screen by definition and would make us pause ourselves.
            if (IsShellProcess(pid)) return;

            if (!NativeMethods.IsWindowVisible(hwnd)) return;

            var exStyle = NativeMethods.GetWindowLong(hwnd, NativeMethods.GWL_EXSTYLE);
            if ((exStyle & NativeMethods.WS_EX_TOOLWINDOW) != 0) return;

            if (!NativeMethods.GetWindowRect(hwnd, out var rect)) return;

            var screen = System.Windows.Forms.Screen.FromHandle(hwnd);
            if (screen == null) return;

            var bounds = screen.Bounds;
            var coversScreen =
                rect.Left <= bounds.Left &&
                rect.Top <= bounds.Top &&
                rect.Right >= bounds.Right &&
                rect.Bottom >= bounds.Bottom;

            if (coversScreen != _lastState)
            {
                _lastState = coversScreen;
                _logger.Info($"Fullscreen state: {coversScreen}");
                FullscreenStateChanged?.Invoke(this, new FullscreenStateChangedEventArgs
                {
                    IsFullscreen = coversScreen
                });
            }
        }
        catch (Exception ex)
        {
            _logger.Debug($"Fullscreen check error: {ex.Message}");
        }
    }

    public void Dispose()
    {
        _timer?.Dispose();
        _timer = null;
    }
}
