using System;
using System.Linq;
using System.Threading;
using System.Windows;
using AnomalyEngine.Tools;

namespace AnomalyEngine;

public static class Program
{
    private const string MutexName = "AnomalyEngine_SingleInstance";
    private static Mutex? _mutex;

    [STAThread]
    public static void Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "--diagnose")
        {
            WindowDiagnostic.Run();
            return;
        }

        if (args.Length > 1 && args[0] == "--capture")
        {
            DesktopShower.ShowDesktop();
            System.Threading.Thread.Sleep(800);
            ScreenCapture.Capture(args[1]);
            return;
        }

        // `--debug` and `--trigger <id>` exist because `livingwall debug` and
        // `livingwall event trigger` used to print "Debug mode enabled." and
        // "Triggering event: x" and exit zero without doing either. There was no flag
        // for them to pass because there was nothing for them to pass to; now that the
        // engine accepts both, the commands start a session that does what they say.

        _mutex = new Mutex(true, MutexName, out bool createdNew);
        if (!createdNew)
        {
            // Another instance owns the tray. Say so plainly rather than pretending
            // this process did anything.
            System.Windows.MessageBox.Show(
                "Anomaly Engine is already running.\n\nUse the tray icon to open settings.",
                "Anomaly Engine",
                System.Windows.MessageBoxButton.OK,
                System.Windows.MessageBoxImage.Information);
            return;
        }

        var trigger = args.Length > 1 && args[0] == "--trigger" ? args[1] : null;

        var engine = new EngineApp
        {
            ShowSettingsOnStart = args.Contains("--settings"),
            ShowDebugOnStart = args.Contains("--debug"),
            TriggerOnStart = trigger,
        };
        engine.Run();
    }
}
