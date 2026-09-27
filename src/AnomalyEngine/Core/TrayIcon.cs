using System;
using System.Drawing;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Forms;
using Hardcodet.Wpf.TaskbarNotification;

namespace AnomalyEngine.Core;

public class TrayIcon : IDisposable
{
    private readonly Logger _logger;
    private readonly WallpaperHost _wallpaperHost;
    private TaskbarIcon? _trayIcon;

    public TrayIcon(Logger logger, WallpaperHost wallpaperHost)
    {
        _logger = logger;
        _wallpaperHost = wallpaperHost;
    }

    public void Show()
    {
        var iconStream = GetIconStream();
        if (iconStream == null)
        {
            _logger.Warn("Tray icon resource not found, tray icon disabled.");
            return;
        }

        _trayIcon = new TaskbarIcon
        {
            Icon = new Icon(iconStream),
            ToolTipText = "Anomaly Engine",
            Visibility = Visibility.Visible
        };

        var menu = new ContextMenu();

        var openItem = new MenuItem { Header = "Open Settings" };
        openItem.Click += (s, e) => OpenSettings();
        menu.Items.Add(openItem);

        menu.Items.Add(new Separator());

        var pauseItem = new MenuItem { Header = "Pause" };
        pauseItem.Click += (s, e) =>
        {
            _wallpaperHost.Pause();
            pauseItem.Header = "Resume";
        };
        menu.Items.Add(pauseItem);

        var resumeItem = new MenuItem { Header = "Resume" };
        resumeItem.Click += (s, e) =>
        {
            _wallpaperHost.Resume();
            pauseItem.Header = "Pause";
        };
        menu.Items.Add(resumeItem);

        menu.Items.Add(new Separator());

        var nextWorldItem = new MenuItem { Header = "Next World" };
        nextWorldItem.Click += (s, e) => { };
        menu.Items.Add(nextWorldItem);

        var triggerEventItem = new MenuItem { Header = "Trigger Event" };
        triggerEventItem.Click += (s, e) => { };
        menu.Items.Add(triggerEventItem);

        menu.Items.Add(new Separator());

        var aboutItem = new MenuItem { Header = "About" };
        aboutItem.Click += (s, e) => ShowAbout();
        menu.Items.Add(aboutItem);

        var exitItem = new MenuItem { Header = "Exit" };
        exitItem.Click += (s, e) => System.Windows.Application.Current.Shutdown();
        menu.Items.Add(exitItem);

        _trayIcon.ContextMenu = menu;
        _trayIcon.TrayLeftMouseDown += (s, e) => OpenSettings();

        _logger.Info("Tray icon shown.");
    }

    public void Hide()
    {
        _trayIcon?.Dispose();
        _trayIcon = null;
    }

    private void OpenSettings()
    {
        _logger.Info("Opening settings...");
        // Settings window implementation comes in Phase 2
    }

    private void ShowAbout()
    {
        System.Windows.MessageBox.Show(
            "Anomaly Engine v0.1.0\n\nA live wallpaper engine where the desktop behaves like a living world.\n\nBy Ali S. (@realizations)",
            "About Anomaly Engine",
            System.Windows.MessageBoxButton.OK,
            System.Windows.MessageBoxImage.Information);
    }

    private static Stream? GetIconStream()
    {
        try
        {
            var assembly = System.Reflection.Assembly.GetExecutingAssembly();
            return assembly.GetManifestResourceStream("AnomalyEngine.icon.ico");
        }
        catch
        {
            return null;
        }
    }

    public void Dispose()
    {
        Hide();
    }
}
