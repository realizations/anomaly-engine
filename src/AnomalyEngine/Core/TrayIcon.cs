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
    private SettingsWindow.SettingsWindow? _settingsWindow;
    private ItemCollection? _styleItems;
    private string _activeStyleId = "painterly";

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

        try
        {
            _trayIcon = new TaskbarIcon
            {
                Icon = new Icon(iconStream),
                ToolTipText = "Anomaly Engine",
                Visibility = Visibility.Visible
            };
        }
        catch (Exception ex)
        {
            _logger.Warn($"Tray icon could not be created: {ex.Message}");
            return;
        }

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
        nextWorldItem.Click += (s, e) => _wallpaperHost.SendToRenderer("anomaly:world-next");
        menu.Items.Add(nextWorldItem);

        var prevWorldItem = new MenuItem { Header = "Previous World" };
        prevWorldItem.Click += (s, e) => _wallpaperHost.SendToRenderer("anomaly:world-prev");
        menu.Items.Add(prevWorldItem);

        var triggerEventItem = new MenuItem { Header = "Trigger Event" };
        triggerEventItem.Click += (s, e) => _wallpaperHost.SendToRenderer("anomaly:trigger");
        menu.Items.Add(triggerEventItem);

        menu.Items.Add(new Separator());

        var styleMenu = new MenuItem { Header = "Art Style" };
        var styles = new (string Id, string Label)[]
        {
            ("painterly", "Painterly (Recommended)"),
            ("flat", "Flat Vector"),
            ("riso", "Riso Print"),
        };

        _activeStyleId = "painterly";
        foreach (var (id, label) in styles)
        {
            var item = new MenuItem { Header = label, Tag = id, IsCheckable = true };
            item.Click += (s, e) => SelectStyle(id);
            styleMenu.Items.Add(item);
        }
        _styleItems = styleMenu.Items;
        MarkActiveStyle("painterly");
        menu.Items.Add(styleMenu);

        var reducedItem = new MenuItem { Header = "Reduced Motion", IsCheckable = true, IsChecked = false };
        reducedItem.Click += (s, e) =>
        {
            var nowOn = !reducedItem.IsChecked;
            reducedItem.IsChecked = nowOn;
            _wallpaperHost.SetReducedMotion(nowOn);
        };
        menu.Items.Add(reducedItem);

        var debugItem = new MenuItem { Header = "Debug Overlay" };
        debugItem.Click += (s, e) => _wallpaperHost.ToggleDebug();
        menu.Items.Add(debugItem);

        var creatorItem = new MenuItem { Header = "Creator Mode" };
        creatorItem.Click += (s, e) => _wallpaperHost.OpenCreatorMode();
        menu.Items.Add(creatorItem);

        var notesItem = new MenuItem { Header = "Field Notes" };
        notesItem.Click += (s, e) => _wallpaperHost.SendToRenderer("anomaly:notes");
        menu.Items.Add(notesItem);

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

    private void SelectStyle(string id)
    {
        _wallpaperHost.SetStyle(id);
        _activeStyleId = id;
        MarkActiveStyle(id);
        _logger.Info($"Art style changed to {id}.");
    }

    // Without a visible marker there is no feedback confirming which style is
    // live, so a click looks like it did nothing.
    private void MarkActiveStyle(string id)
    {
        if (_styleItems == null) return;
        foreach (MenuItem item in _styleItems)
        {
            if (item.Tag is string tag) item.IsChecked = tag == id;
        }
    }

    public void OpenSettings()
    {
        _logger.Info("Opening settings...");
        if (_settingsWindow == null || !_settingsWindow.IsLoaded)
        {
            _settingsWindow = new SettingsWindow.SettingsWindow(_wallpaperHost, _logger);
            _settingsWindow.Closed += (s, e) => _settingsWindow = null;
        }
        _settingsWindow.Show();
        _settingsWindow.Activate();
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
            var path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "anomaly.ico");
            if (File.Exists(path))
            {
                return File.OpenRead(path);
            }

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
