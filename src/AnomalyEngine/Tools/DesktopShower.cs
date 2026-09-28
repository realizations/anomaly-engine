using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace AnomalyEngine.Tools;

public static class DesktopShower
{
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern IntPtr GetShellWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    public static void ShowDesktop()
    {
        var shell = GetShellWindow();
        var foreground = GetForegroundWindow();
        var toRestore = new List<IntPtr>();

        EnumWindows((hWnd, lParam) =>
        {
            if (hWnd == shell) return true;
            if (!IsWindowVisible(hWnd)) return true;

            var sb = new StringBuilder(256);
            GetClassName(hWnd, sb, sb.Capacity);
            var cls = sb.ToString();

            if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd") return true;
            if (cls == "ApplicationManager_DesktopShellWindow") return true;

            if (hWnd == foreground) toRestore.Add(hWnd);
            return true;
        }, IntPtr.Zero);

        foreach (var h in toRestore)
        {
            ShowWindowAsync(h, 6);
        }
    }

    public static void RestoreForeground()
    {
        var foreground = GetForegroundWindow();
        if (foreground != IntPtr.Zero)
        {
            ShowWindowAsync(foreground, 9);
        }
    }
}
