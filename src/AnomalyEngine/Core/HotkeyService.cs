using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Windows.Interop;
using System.Windows.Media;

namespace AnomalyEngine.Core;

/// <summary>
/// System-wide hotkeys.
///
/// The wallpaper never holds keyboard focus, so the renderer's own key handlers
/// never fire in the real host. Anything user-triggered has to be registered with
/// Windows, which is what this does.
///
/// Registration failures are logged and skipped rather than thrown: a hotkey
/// already owned by another application must not stop the engine from starting.
/// </summary>
public sealed class HotkeyService : IDisposable
{
    private const int WM_HOTKEY = 0x0312;
    private const int MOD_ALT = 0x0001;
    private const int MOD_CONTROL = 0x0002;
    private const int MOD_SHIFT = 0x0004;
    private const int MOD_NOREPEAT = 0x4000;

    private const int ID_CYCLE_WORLD = 1;
    private const int ID_CYCLE_STYLE = 2;
    private const int ID_TOGGLE_PAUSE = 3;
    private const int ID_FIELD_NOTES = 4;
    private const int ID_DEBUG = 5;

    private readonly Logger _logger;
    private readonly HwndSource? _source;
    private readonly Dictionary<int, Action> _actions = new();
    private bool _paused;

    public HotkeyService(Logger logger)
    {
        _logger = logger;

        // A hidden message-only window is the standard way to receive WM_HOTKEY.
        var parameters = new HwndSourceParameters("AnomalyEngineHotkeys")
        {
            Width = 0,
            Height = 0,
            WindowStyle = 0,
        };
        _source = new HwndSource(parameters);
        _source.AddHook(WndProc);

        Register(ID_CYCLE_WORLD, MOD_CONTROL | MOD_ALT, 0x57, () => RendererEvent?.Invoke("world-next"));   // Ctrl+Alt+W
        Register(ID_CYCLE_STYLE, MOD_CONTROL | MOD_ALT, 0x53, () => RendererEvent?.Invoke("style-next"));   // Ctrl+Alt+S
        Register(ID_TOGGLE_PAUSE, MOD_CONTROL | MOD_ALT, 0x50, TogglePause);                              // Ctrl+Alt+P
        Register(ID_FIELD_NOTES, MOD_CONTROL | MOD_ALT, 0x46, () => RendererEvent?.Invoke("notes"));        // Ctrl+Alt+F
        Register(ID_DEBUG, MOD_CONTROL | MOD_ALT, 0x44, () => RendererEvent?.Invoke("debug"));              // Ctrl+Alt+D
    }

    /// <summary>Raised with a renderer event name, e.g. "world-next".</summary>
    public event Action<string>? RendererEvent;

    /// <summary>Raised when the pause state toggles, with the new state.</summary>
    public event Action<bool>? PauseToggled;

    public bool IsPaused => _paused;

    private void Register(int id, uint modifiers, uint key, Action action)
    {
        _actions[id] = action;
        var ok = RegisterHotKey(_source!.Handle, id, modifiers | MOD_NOREPEAT, key);
        if (!ok)
        {
            var err = Marshal.GetLastWin32Error();
            // ERROR_HOTKEY_ALREADY_REGISTERED is 1409.
            _logger.Warn($"Hotkey {id} (key {key}) unavailable, error {err}. Another app likely owns it.");
        }
    }

    private void TogglePause()
    {
        _paused = !_paused;
        PauseToggled?.Invoke(_paused);
    }

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == WM_HOTKEY && _actions.TryGetValue(wParam.ToInt32(), out var action))
        {
            try
            {
                action();
            }
            catch (Exception ex)
            {
                _logger.Warn($"Hotkey handler failed: {ex.Message}");
            }
            handled = true;
        }
        return IntPtr.Zero;
    }

    public void Dispose()
    {
        try
        {
            foreach (var id in _actions.Keys)
            {
                UnregisterHotKey(_source!.Handle, id);
            }
        }
        catch (Exception ex)
        {
            _logger.Debug($"Hotkey unregister failed: {ex.Message}");
        }
        _source?.RemoveHook(WndProc);
        _source?.Dispose();
        _actions.Clear();
        RendererEvent = null;
        PauseToggled = null;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);
}
