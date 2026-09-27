using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

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

    public event EventHandler<FullscreenStateChangedEventArgs>? FullscreenStateChanged;

    public FullscreenDetector(Logger logger)
    {
        _logger = logger;
        _timer = new System.Threading.Timer(_ => CheckFullscreen(null), null, TimeSpan.Zero, TimeSpan.FromSeconds(2));
    }

    private void CheckFullscreen(object? state)
    {
        try
        {
            var hwnd = NativeMethods.GetForegroundWindow();
            if (hwnd == IntPtr.Zero) return;

            NativeMethods.GetWindowRect(hwnd, out var rect);
            var screen = System.Windows.Forms.Screen.FromHandle(hwnd);
            var isFullscreen = rect.Width >= screen.Bounds.Width && rect.Height >= screen.Bounds.Height;

            if (isFullscreen != _lastState)
            {
                _lastState = isFullscreen;
                _logger.Info($"Fullscreen state: {isFullscreen}");
                FullscreenStateChanged?.Invoke(this, new FullscreenStateChangedEventArgs { IsFullscreen = isFullscreen });
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
    }
}
