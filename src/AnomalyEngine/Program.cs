using System;

namespace AnomalyEngine;

public static class Program
{
    private const string MutexName = "AnomalyEngine_SingleInstance";
    private static Mutex? _mutex;

    [STAThread]
    public static void Main(string[] args)
    {
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
