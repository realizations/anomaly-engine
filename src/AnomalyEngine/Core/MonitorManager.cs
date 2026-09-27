using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace AnomalyEngine.Core;

public class MonitorInfo
{
    public IntPtr Handle { get; set; }
    public string Name { get; set; } = "";
    public int X { get; set; }
    public int Y { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public bool IsPrimary { get; set; }
    public Rectangle Bounds => new(X, Y, Width, Height);
}

public class MonitorManager : IDisposable
{
    private readonly Logger _logger;
    private readonly List<MonitorInfo> _monitors = new();
    private readonly object _lock = new();

    public event EventHandler? MonitorsChanged;

    public IReadOnlyList<MonitorInfo> Monitors
    {
        get { lock (_lock) return _monitors.ToList(); }
    }

    public MonitorManager(Logger logger)
    {
        _logger = logger;
        RefreshMonitors();
    }

    public void RefreshMonitors()
    {
        var newMonitors = new List<MonitorInfo>();
        NativeMethods.EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero,
            (IntPtr hMonitor, IntPtr hdcMonitor, ref NativeMethods.RECT lprcMonitor, IntPtr dwData) =>
        {
            var info = new NativeMethods.MONITORINFO { cbSize = Marshal.SizeOf<NativeMethods.MONITORINFO>() };
            if (NativeMethods.GetMonitorInfo(hMonitor, ref info))
            {
                newMonitors.Add(new MonitorInfo
                {
                    Handle = hMonitor,
                    Name = $"Display {newMonitors.Count + 1}",
                    X = info.rcMonitor.Left,
                    Y = info.rcMonitor.Top,
                    Width = info.rcMonitor.Width,
                    Height = info.rcMonitor.Height,
                    IsPrimary = (info.dwFlags & 1) != 0
                });
            }
            return true;
        }, IntPtr.Zero);

        lock (_lock)
        {
            _monitors.Clear();
            _monitors.AddRange(newMonitors);
        }

        _logger.Info($"Detected {_monitors.Count} monitor(s).");
        MonitorsChanged?.Invoke(this, EventArgs.Empty);
    }

    public void Dispose() { }
}
