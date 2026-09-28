using System;
using System.Text;
using System.Runtime.InteropServices;

namespace AnomalyEngine.Tools;

public static class WindowDiagnostic
{
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpWindowText, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetParent(IntPtr hWnd);

    public static void Run()
    {
        Console.WriteLine("=== Anomaly Engine Window Diagnostic ===");
        Console.WriteLine();

        var shellPid = GetShellProcessId();
        Console.WriteLine($"Explorer shell PID: {shellPid}");
        Console.WriteLine();

        Console.WriteLine("--- Top-level windows (shell-related) ---");
        EnumWindows((hWnd, lParam) =>
        {
            var pid = GetPid(hWnd);
            var className = GetClass(hWnd);
            var text = GetText(hWnd);
            var visible = IsWindowVisible(hWnd);

            if (className.Contains("Progman") || className.Contains("WorkerW") ||
                className.Contains("SHELLDLL") || pid == shellPid)
            {
                Console.WriteLine($"  hwnd=0x{hWnd.ToInt64():X} pid={pid} visible={visible} class='{className}' text='{text}'");
            }
            return true;
        }, IntPtr.Zero);

        Console.WriteLine();
        Console.WriteLine("--- All WorkerW/Progman/SHELLDLL_DefView windows ---");
        EnumWindows((hWnd, lParam) =>
        {
            var className = GetClass(hWnd);
            if (className == "WorkerW" || className == "Progman" || className == "SHELLDLL_DefView")
            {
                var pid = GetPid(hWnd);
                var parent = GetParent(hWnd);
                var rect = new RECT();
                GetWindowRect(hWnd, out rect);
                Console.WriteLine($"  class='{className}' hwnd=0x{hWnd.ToInt64():X} pid={pid} parent=0x{parent.ToInt64():X} rect=({rect.Left},{rect.Top},{rect.Right},{rect.Bottom}) visible={IsWindowVisible(hWnd)}");
            }
            return true;
        }, IntPtr.Zero);

        Console.WriteLine();
        Console.WriteLine("--- Children of Progman ---");
        var progman = FindWindow("Progman", null);
        if (progman != IntPtr.Zero)
        {
            Console.WriteLine($"  Progman hwnd=0x{progman.ToInt64():X}");
            EnumChildWindows(progman, (hWnd, lParam) =>
            {
                var className = GetClass(hWnd);
                Console.WriteLine($"    child hwnd=0x{hWnd.ToInt64():X} class='{className}'");
                return true;
            }, IntPtr.Zero);
        }
        else
        {
            Console.WriteLine("  Progman NOT FOUND");
        }

        Console.WriteLine();
        Console.WriteLine("--- Windows 11 alternate: Progman child search for WorkerW ---");
        var progman2 = FindWindow("Progman", null);
        if (progman2 != IntPtr.Zero)
        {
            EnumChildWindows(progman2, (hWnd, lParam) =>
            {
                var className = GetClass(hWnd);
                if (className == "WorkerW")
                {
                    Console.WriteLine($"    FOUND WorkerW: 0x{hWnd.ToInt64():X}");
                }
                return true;
            }, IntPtr.Zero);
        }
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left, Top, Right, Bottom;
    }

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    private static string GetClass(IntPtr hWnd)
    {
        var sb = new StringBuilder(256);
        GetClassName(hWnd, sb, sb.Capacity);
        return sb.ToString();
    }

    private static string GetText(IntPtr hWnd)
    {
        var sb = new StringBuilder(256);
        GetWindowText(hWnd, sb, sb.Capacity);
        return sb.ToString();
    }

    private static uint GetPid(IntPtr hWnd)
    {
        GetWindowThreadProcessId(hWnd, out var pid);
        return pid;
    }

    private static uint GetShellProcessId()
    {
        foreach (var proc in System.Diagnostics.Process.GetProcessesByName("explorer"))
        {
            return (uint)proc.Id;
        }
        return 0;
    }
}
