using System;
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

        _mutex = new Mutex(true, MutexName, out bool createdNew);
        if (!createdNew)
        {
            System.Windows.MessageBox.Show("Anomaly Engine is already running.", "Anomaly Engine",
                System.Windows.MessageBoxButton.OK, System.Windows.MessageBoxImage.Information);
            return;
        }

        var engine = new EngineApp();
        engine.Run();
    }
}
