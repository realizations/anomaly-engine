using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using Screen = System.Windows.Forms.Screen;
using AnomalyEngine.Core;

namespace AnomalyEngine.SettingsWindow;

/// <summary>
/// Settings window.
///
/// Every control here drives something real. Where a capability is not built,
/// the window says so in plain language rather than offering a checkbox that
/// does nothing, because a dead control is worse than a missing one.
/// </summary>
public partial class SettingsWindow : Window
{
    private readonly IEngineBridge? _host;
    private readonly Logger? _logger;
    private readonly DispatcherTimer _poll = new() { Interval = TimeSpan.FromSeconds(1) };

    // Guards the SelectionChanged handlers while we are writing values into
    // them programmatically, which would otherwise fire them as user actions.
    private bool _loading = true;

    /// <summary>
    /// Set once the window is closing. Checked after every await, because a poll
    /// that started while the window was open will otherwise resume against a
    /// closed window and a WebView that may already have been torn down.
    /// </summary>
    private bool _closing;

    /// <summary>
    /// True while a poll is in flight. The one-second timer can fire again while
    /// a slow poll is still awaiting the engine, which would stack overlapping
    /// round trips and pile more work onto a UI thread that is already busy.
    /// </summary>
    private bool _pollInFlight;

    /// <summary>
    /// Identifies the state the display pickers were last built for, so they are
    /// rebuilt on change rather than every tick.
    /// </summary>
    private string? _displayRowFingerprint;

    /// <summary>
    /// Mirror of the engine's per-display world assignments, keyed by display
    /// device name. Read once per refresh and written as picks change, so the
    /// pickers do not have to call into the engine for every row.
    /// </summary>
    private Dictionary<string, string> _displayWorlds = new();

  /// True while the motion slider's thumb is down, so the value is treated as a
  /// preview and only sent to the engine when the drag ends.
  private bool _motionDragging;

  /// Mirrors DEFAULT_MOTION_INTENSITY on the renderer, as a percentage for the slider.
  private const double DefaultMotionPercent = 35;
    private bool _paused;

    public SettingsWindow(IEngineBridge? host = null, Logger? logger = null)
    {
        InitializeComponent();

        // Default set here rather than in XAML: a Value attribute fires ValueChanged
        // during parse, before the label beside the slider exists.
        MotionSlider.Value = DefaultMotionPercent;
        UpdateMotionLabels();
        _host = host;
        _logger = logger;

        Loaded += async (_, _) =>
        {
            // Each of these is guarded separately, and the reason is a crash rather than
            // a style preference: this handler is `async void` in effect, so an exception
            // from any `await` here is rethrown on the dispatcher, reaches
            // `EngineApp.OnDispatcherException`, and takes the process down. Opening the
            // settings window must not be able to end the application, whatever the
            // renderer does or does not answer.
            await Guarded("the initial selection", ApplyInitialSelection);
            await Guarded("the locale list", LoadLocalesAsync);
            await Guarded("the audio track state", LoadMediaAsync);

            // Started even if the reads above failed. A window showing stale controls and
            // live readouts is a working window; a window that never starts polling is a
            // window that looks frozen and cannot be diagnosed.
            _poll.Tick += (_, _) => _ = Guarded("the settings poll", RefreshAsync);
            _poll.Start();
        };
        Closed += (_, _) =>
        {
            _closing = true;
            _poll.Stop();
        };
    }

    /// <summary>
    /// Runs a read against the renderer and swallows anything it throws.
    ///
    /// The status text is set to the reason, because a settings window that silently
    /// shows defaults for a control the user is about to change is how somebody spends
    /// an afternoon wondering why their setting did not stick.
    /// </summary>
    private async System.Threading.Tasks.Task Guarded(string what, System.Func<System.Threading.Tasks.Task> action)
    {
        try
        {
            await action();
        }
        catch (Exception ex)
        {
            _logger?.Warn($"Could not load {what}: {ex.Message}");
            if (!_closing) StatusText.Text = $"Could not read {what} from the engine: {ex.Message}";
        }
    }

    private async System.Threading.Tasks.Task ApplyInitialSelection()
    {
        // Push the current renderer state into the controls without echoing it
        // back as a change.
        _loading = true;
        try
        {
            var status = await GetStatusAsync();
            if (status is null) return;

            StyleCombo.SelectedIndex = status.Value.Style switch
            {
                "flat" => 1,
                "riso" => 2,
                _ => 0,
            };
            FpsCombo.SelectedIndex = status.Value.FpsLimit switch
            {
                30 => 0,
                120 => 2,
                0 => 3,
                _ => 1,
            };
            ReducedMotion.IsChecked = status.Value.ReducedMotion;
            _paused = status.Value.Paused;
            ApplyAccessibility(status.Value.Accessibility, status.Value.UiScale, status.Value.Muted);
            UpdateQuickControls();
        }
        catch (Exception ex)
        {
            _logger?.Warn($"Could not read initial engine state: {ex.Message}");
        }
        finally
        {
            _loading = false;
        }
    }

    /// One entry per section: the panel to show, the nav button to light, the
    /// title, and a line saying what the section is for. The blurb matters —
    /// a heading on its own makes the user guess, and a settings window that
    /// makes the user guess is a settings window people stop opening.
    private static readonly (string Key, FrameworkElement Panel, Button Nav, string Title, string Blurb)[] Sections =
    {
        ("Home", null!, null!, "Home",
            "Where the world is right now, and the things worth changing without opening anything else."),
        ("Worlds", null!, null!, "Worlds",
            "The places this engine can put behind your desktop. Each one is a different biome with its own palette, terrain and structures."),
        ("Appearance", null!, null!, "Appearance",
            "How the world is drawn, and how much it moves."),
        ("Performance", null!, null!, "Performance",
            "How hard the engine is allowed to work. Everything here has a safe default, so this section is optional."),
        ("Events", null!, null!, "Events",
            "The rare things that happen while you are not looking. Each is scoped to the place it occurs in."),
        ("Accessibility", null!, null!, "Accessibility",
            "Contrast, sound, keyboard control and text size. Each one is read from the engine when this window opens rather than remembered here, so what you see is what is running."),
        ("Notes", null!, null!, "Field Notes",
            "What has been noticed, and what it might have been instead."),
        ("Monitors", null!, null!, "Displays",
            "Which screens the engine knows about."),
        ("Integrations", null!, null!, "Integrations",
            "Optional outside inputs. Nothing is enabled by default."),
        ("About", null!, null!, "About",
            "What this is, what it ships, and what it does with your data."),
    };

    private void ShowSection(string sectionName)
    {
        var panels = new FrameworkElement[]
        {
            HomeSection, WorldsSection, AppearanceSection, PerformanceSection,
            EventsSection, AccessibilitySection, NotesSection, MonitorsSection,
            IntegrationsSection, AboutSection,
        };
        var navs = new Button?[]
        {
            NavHome, NavWorlds, NavLook, NavPerf, NavEvents, NavA11y,
            NavNotes, NavMon, Net, NavAbout,
        };

        foreach (var panel in panels) panel.Visibility = Visibility.Collapsed;
        foreach (var nav in navs)
        {
            if (nav is null) continue;
            // Active state is a style swap rather than a colour set inline, so
            // hover and focus behaviour stay correct in both states.
            nav.Style = (Style)FindResource("NavButton");
        }

        var entry = Sections.FirstOrDefault(s => s.Key == sectionName);
        if (entry.Key is null) entry = Sections[0];

        FrameworkElement target = entry.Key switch
        {
            "Worlds" => WorldsSection,
            "Appearance" => AppearanceSection,
            "Performance" => PerformanceSection,
            "Events" => EventsSection,
            "Accessibility" => AccessibilitySection,
            "Notes" => NotesSection,
            "Monitors" => MonitorsSection,
            "Integrations" => IntegrationsSection,
            "About" => AboutSection,
            _ => HomeSection,
        };
        target.Visibility = Visibility.Visible;

        SectionTitle.Text = entry.Title;
        SectionBlurb.Text = entry.Blurb;

        var idx = Array.FindIndex(Sections, s => s.Key == entry.Key);
        if (idx >= 0 && idx < navs.Length && navs[idx] is { } active)
        {
            active.Style = (Style)FindResource("NavButtonActive");
        }
    }

    /* ------------------------------ language ------------------------------ */

    /// <summary>
    /// Fills the language box from the renderer's own list.
    ///
    /// The renderer is asked rather than a list being written here, because the set of
    /// shipped languages is the renderer's business and a copy in this file is one that
    /// goes stale silently: a fourth language would appear in the interface with no way
    /// to select it, and removing one would leave a control that selects a code the
    /// renderer refuses.
    ///
    /// Populated under `_loading` so filling the box does not read as the user choosing
    /// a language and push one to the renderer on open.
    /// </summary>
    private async System.Threading.Tasks.Task LoadLocalesAsync()
    {
        if (_host is null || _closing) return;
        var locales = await _host.GetAvailableLocalesAsync();
        if (_closing || locales.Count == 0) return;

        _loading = true;
        try
        {
            LanguageBox.ItemsSource = locales.Select(l => new LocaleItem(l.Code, l.Name)).ToList();
            var current = locales.FirstOrDefault(l => l.Code == _activeLocale);
            LanguageBox.SelectedItem = LanguageBox.ItemsSource
                .OfType<LocaleItem>()
                .FirstOrDefault(i => i.Code == current.Code)
                ?? LanguageBox.ItemsSource.OfType<LocaleItem>().FirstOrDefault();
        }
        finally
        {
            _loading = false;
        }
    }

    private string _activeLocale = "en";

    private sealed record LocaleItem(string Code, string Name)
    {
        // The display name is the language's own name of itself, so a German reader sees
        // "Deutsch" rather than "German". That is the convention that makes a list
        // readable to someone who cannot read the other entries.
        public override string ToString() => Name;
    }

    private void LanguageBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        // Fires while the box is being filled and again on close; `_loading` is what
        // makes filling it not look like a user action.
        if (_loading || _host is null) return;
        if (LanguageBox.SelectedItem is not LocaleItem item) return;

        _host.SetLocale(item.Code);
        _activeLocale = item.Code;
        StatusText.Text = $"Language set to {item.Name}.";
    }

    /* ----------------------------- navigation ----------------------------- */

    private void BtnHome_Click(object sender, RoutedEventArgs e) => ShowSection("Home");
    private void BtnWorlds_Click(object sender, RoutedEventArgs e) => ShowSection("Worlds");
    private void BtnAppearance_Click(object sender, RoutedEventArgs e) => ShowSection("Appearance");
    private void BtnPerformance_Click(object sender, RoutedEventArgs e) => ShowSection("Performance");
    private void BtnEvents_Click(object sender, RoutedEventArgs e) => ShowSection("Events");
    private void BtnAccessibility_Click(object sender, RoutedEventArgs e) => ShowSection("Accessibility");
    private void BtnNotes_Click(object sender, RoutedEventArgs e) => ShowSection("Notes");
    /// Opens the field-notes overlay on the desktop itself, which is a
    /// different action from navigating to the section that describes it.
    private void BtnOpenNotes_Click(object sender, RoutedEventArgs e) => _host?.SendToRenderer("notes");
    private void BtnMonitors_Click(object sender, RoutedEventArgs e) => ShowSection("Monitors");
    private void BtnIntegrations_Click(object sender, RoutedEventArgs e) => ShowSection("Integrations");
    private void BtnAbout_Click(object sender, RoutedEventArgs e) => ShowSection("About");

    /* --------------------------- quick controls --------------------------- */

    private void BtnPause_Click(object sender, RoutedEventArgs e)
    {
        _host?.Pause();
        _paused = true;
        UpdateQuickControls();
        StatusText.Text = "Paused.";
    }

    private void BtnResume_Click(object sender, RoutedEventArgs e)
    {
        _host?.Resume();
        _paused = false;
        UpdateQuickControls();
        StatusText.Text = "Running.";
    }

    private void BtnNextWorld_Click(object sender, RoutedEventArgs e)
    {
        _host?.SendToRenderer("world-next");
        StatusText.Text = "Switched world.";
    }

    private void BtnTriggerEvent_Click(object sender, RoutedEventArgs e)
    {
        _host?.SendToRenderer("trigger");
        StatusText.Text = "Anomaly triggered and written to the journal.";
    }

    private void BtnDebug_Click(object sender, RoutedEventArgs e) => _host?.ToggleDebug();

    private void UpdateQuickControls()
    {
        PauseButton.IsEnabled = !_paused;
        ResumeButton.IsEnabled = _paused;
    }

    /* ------------------------------- worlds ------------------------------- */

    private async Task RefreshAsync()
    {
        if (_host is null || _closing) return;

        // The timer can fire again while a slow poll is still awaiting the
        // engine. Overlapping polls stack round trips and, because the awaits
        // resume on the UI thread, they also queue up UI work back to back.
        if (_pollInFlight) return;
        _pollInFlight = true;
        try
        {
            var status = await GetStatusAsync();
            if (_closing) return;
            if (status is not null) ApplyStatus(status.Value);

            if (WorldsSection.Visibility == Visibility.Visible)
            {
                await RefreshWorldsAsync();
                if (_closing) return;
            }

            await ApplyDisplaysAsync();
        }
        catch (Exception ex)
        {
            _logger?.Debug($"Settings poll failed: {ex.Message}");
        }
        finally
        {
            _pollInFlight = false;
        }
    }

    private async Task RefreshWorldsAsync()
    {
        var json = await _host!.EvaluateAsync("JSON.stringify(window.__engine.getWorldDetails())");
        if (string.IsNullOrWhiteSpace(json)) return;
        var parsed = JsonNode.Parse(json)?.ToString();
        if (parsed is null) return;
        var worlds = JsonSerializer.Deserialize<List<WorldRow>>(parsed);
        if (worlds is null) return;

        WorldList.Items.Clear();
        foreach (var w in worlds) WorldList.Items.Add(BuildWorldRow(w));
        WorldCountText.Text = $"{worlds.Count} world{(worlds.Count == 1 ? "" : "s")} · all are data, not art";

        await RefreshWorldIntegrityAsync();
    }

    /// <summary>
    /// Surfaces imported worlds whose contents no longer match the checksum
    /// recorded when they were first imported.
    ///
    /// Reported, not blocked. A world is a file the user owns and may well have
    /// edited deliberately, and a checksum is only a statement that something
    /// changed, not that something is wrong. The point is that the change is never
    /// silent.
    /// </summary>
    private async Task RefreshWorldIntegrityAsync()
    {
        WorldChangedPanel.Visibility = Visibility.Collapsed;
        if (_host is null) return;
        try
        {
            // Awaited, never waited on synchronously. See ReadDisplayWorldsAsync
            // for why blocking here deadlocks the UI thread.
            var json = await _host.EvaluateAsync("JSON.stringify(window.__engine.getChangedWorlds())");
            if (_closing || string.IsNullOrWhiteSpace(json)) return;
            var changed = JsonSerializer.Deserialize<List<string>>(JsonNode.Parse(json)?.ToString() ?? "[]");
            if (changed is null || changed.Count == 0) return;

            var names = changed
                .Select(id => WorldList.Items.OfType<Border>()
                    .Select(b => b.Tag as WorldRow)
                    .FirstOrDefault(w => w?.Id == id)?.Name ?? id)
                .ToList();
            WorldChangedText.Text =
                $"These imported worlds have been edited since they were first imported: " +
                $"{string.Join(", ", names)}. If that was you, accept the changes so this stops being reported. " +
                $"If it was not, the file was modified outside the app.";
            WorldChangedPanel.Visibility = Visibility.Visible;
        }
        catch
        {
            // The engine is not answering; the world list is still correct.
        }
    }

    private async void BtnAcceptWorldChanges_Click(object sender, RoutedEventArgs e)
    {
        if (_host is null) return;
        await _host.EvaluateAsync("window.__engine.acceptWorldChanges()");
        await RefreshWorldIntegrityAsync();
    }

    private Border BuildWorldRow(WorldRow w)
    {
        // The active world is marked by an accent bar and a label, not by
        // colour alone: a row that is only distinguished by hue is invisible
        // to a colour-blind user and invisible to a screen reader.
        var title = new TextBlock
        {
            Text = w.Active ? $"{w.Name}   (active)" : w.Name,
            FontSize = 15,
            FontWeight = FontWeights.SemiBold,
            Foreground = w.Active
                ? (Brush)FindResource("AccentBrush")
                : (Brush)FindResource("TextBrush"),
            TextWrapping = TextWrapping.Wrap,
        };

        var meta = new TextBlock
        {
            Text = $"{w.Biome.Replace('-', ' ')}" +
                   (w.Structures > 0
                       ? $"  ·  {w.Structures} landmark{(w.Structures == 1 ? "" : "s")}"
                       : "  ·  interior geometry"),
            Foreground = (Brush)FindResource("DimBrush"),
            FontSize = 11,
            Margin = new Thickness(0, 3, 0, 0),
        };
        var desc = new TextBlock
        {
            Text = w.Description,
            Foreground = (Brush)FindResource("FaintBrush"),
            FontSize = 12,
            TextWrapping = TextWrapping.Wrap,
            LineHeight = 17,
            Margin = new Thickness(0, 7, 0, 0),
        };

        var buttons = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            VerticalAlignment = VerticalAlignment.Center,
        };
        if (!w.Active)
        {
            var id = w.Id;
            var name = w.Name;
            var activate = new Button { Content = "Activate" };
            activate.Click += async (_, _) =>
            {
                _host?.SetWorld(id);
                StatusText.Text = $"Switched to {name}.";
                await RefreshWorldsAsync();
            };
            buttons.Children.Add(activate);
        }
        if (w.Removable)
        {
            var id = w.Id;
            var name = w.Name;
            var remove = new Button { Content = "Remove" };
            remove.Click += async (_, _) =>
            {
                _host?.RemoveWorld(id);
                StatusText.Text = $"Removed {name}.";
                await RefreshWorldsAsync();
            };
            buttons.Children.Add(remove);
        }

        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        // Accent rail down the active row.
        var rail = new Border
        {
            Width = 3,
            Background = w.Active ? (Brush)FindResource("AccentBrush") : Brushes.Transparent,
            CornerRadius = new CornerRadius(2),
            Margin = new Thickness(0, 2, 14, 2),
        };
        var body = new Grid();
        body.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        body.Children.Add(rail);
        var text = new StackPanel();
        text.Children.Add(title);
        text.Children.Add(meta);
        text.Children.Add(desc);
        Grid.SetColumn(text, 1);
        body.Children.Add(text);

        grid.Children.Add(body);
        if (buttons.Children.Count > 0)
        {
            Grid.SetColumn(buttons, 1);
            buttons.Margin = new Thickness(16, 0, 0, 0);
            grid.Children.Add(buttons);
        }

        return new Border
        {
            Background = w.Active
                ? (Brush)FindResource("CardHoverBrush")
                : (Brush)FindResource("CardBrush"),
            BorderBrush = (Brush)FindResource("LineBrush"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(6),
            Padding = new Thickness(16),
            Margin = new Thickness(0, 0, 0, 10),
            Child = grid,
            // Carried on the row so the integrity notice can name a changed world
            // without keeping a parallel id-to-name map that could drift.
            Tag = w,
        };
    }

    private void BtnRefresh_Click(object sender, RoutedEventArgs e) => _ = RefreshWorldsAsync();

    private void BtnImportWorld_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new Microsoft.Win32.OpenFileDialog
        {
            Title = "Import a world",
            Filter = "World definition (*.json)|*.json|All files (*.*)|*.*",
        };
        if (dialog.ShowDialog(this) != true) return;

        try
        {
            var node = JsonNode.Parse(File.ReadAllText(dialog.FileName));
            var count = node switch
            {
                JsonArray arr => arr.Count,
                JsonObject obj => 1,
                _ => 0,
            };
            if (count == 0)
            {
                StatusText.Text = "That file is not a world definition.";
                return;
            }
            _host?.ImportWorlds(node is JsonArray a ? a.ToJsonString() : new JsonArray(node as JsonObject).ToJsonString());
            StatusText.Text = $"Imported {count} world(s). Validation errors appear in the log.";
            _ = RefreshWorldsAsync();
        }
        catch (Exception ex)
        {
            _logger?.Warn($"World import failed: {ex.Message}");
            StatusText.Text = $"Could not read that file: {ex.Message}";
        }
    }

    private void BtnOpenFolder_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "AnomalyEngine");
            Directory.CreateDirectory(dir);
            Process.Start(new ProcessStartInfo(dir) { UseShellExecute = true });
            StatusText.Text = $"Opened {dir}";
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Could not open that folder: {ex.Message}";
        }
    }

    /* ----------------------------- preferences ----------------------------- */

    private void FpsCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_loading) return;
        var limits = new[] { 30, 60, 120, 0 };
        var i = FpsCombo.SelectedIndex;
        if (i < 0 || i >= limits.Length) return;
        _host?.SetFpsLimit(limits[i]);
        StatusText.Text = limits[i] == 0 ? "Frame rate: unlimited" : $"Frame rate: {limits[i]} fps";
    }

    private void QualityCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_loading) return;
        // The three presets pin the render scale. The fourth releases the pin so
        // the controller adapts. It is passed as null rather than a sentinel
        // number, because zero is a number and the renderer would have clamped
        // it to the minimum and locked quality there.
        double? scale = QualityCombo.SelectedIndex switch
        {
            0 => 0.6,
            1 => 0.8,
            2 => 1.0,
            _ => null,
        };
        _host?.SetRenderScale(scale);
        StatusText.Text = scale is null
            ? "Quality: automatic, adapting to hold a frame budget"
            : $"Quality pinned to {(int)(scale.Value * 100)}% render scale";
    }

    private void StyleCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_loading) return;
        var styles = new[] { "painterly", "flat", "riso" };
        var i = StyleCombo.SelectedIndex;
        if (i < 0 || i >= styles.Length) return;
        _host?.SetArtStyle(styles[i]);
        StatusText.Text = $"Art style: {styles[i]}";
    }

private void ReducedMotion_Checked(object sender, RoutedEventArgs e)
    {
        if (_loading) return;
        _host?.SetReducedMotion(true);
        StatusText.Text = "Following the Windows reduce-motion setting: the scene stays alive but stops pulsing.";
    }

    /* ------------------------------- motion ------------------------------- */

    /// <summary>
    /// Motion level slider.
    ///
    /// Sent on release rather than on every tick of the drag, so dragging the slider
    /// does not push a hundred WebView2 calls at the renderer while the user is still
    /// deciding where to put it.
    /// </summary>
    private void MotionSlider_DragStarted(object sender, System.Windows.Controls.Primitives.DragStartedEventArgs e)
    {
        _motionDragging = true;
    }

    private void MotionSlider_DragCompleted(object sender, System.Windows.Controls.Primitives.DragCompletedEventArgs e)
    {
        _motionDragging = false;
        if (_loading) return;
        PushMotionLevel();
    }

    private void MotionSlider_ValueChanged(object sender, RoutedEventArgs e)
    {
        // The handler can fire while the XAML tree is still being parsed, before the
        // label beside the slider exists, so it cannot assume it is there.
        if (MotionValueText is null) return;
        UpdateMotionLabels();
        if (_loading) return;
        // While the thumb is down the value is a preview, not a decision. Pushing it
        // on every tick would send a hundred calls at the renderer while the user is
        // still choosing, which is both wasteful and visibly laggy on the desktop.
        if (_motionDragging) return;
        PushMotionLevel();
    }

    private void PushMotionLevel()
    {
        var value = MotionSlider.Value / 100.0;
        _host?.SetMotionIntensity(value);
        StatusText.Text = $"Motion level set to {MotionSlider.Value:0}%.";
    }

    /// <summary>
    /// Reflects the motion level in the window.
    ///
    /// Reads nothing from the engine. The motion level and the reduce-motion flag
    /// both arrive in the status document the one-second poll already fetches, so
    /// this costs no additional round trips -- and, more importantly, cannot block
    /// the UI thread waiting on one.
    /// </summary>
    private void RefreshMotionControls(EngineStatus? status)
    {
        if (status is not null) MotionSlider.Value = Math.Round(status.Value.MotionIntensity * 100);
        MotionReducedNote.Visibility = status?.ReducedMotion == true ? Visibility.Visible : Visibility.Collapsed;
        UpdateMotionLabels();
    }

    private void UpdateMotionLabels()
    {
        var v = MotionSlider.Value;
        MotionValueText.Text = v switch
        {
            < 12 => "still",
            < 40 => "calm",
            < 70 => "alive",
            _ => "lively",
        };
    }

    private void ReducedMotion_Unchecked(object sender, RoutedEventArgs e)
    {
        if (_loading) return;
        _host?.SetReducedMotion(false);
        StatusText.Text = "Reduced motion off.";
    }

    /* ---------------------------- accessibility ---------------------------- */

    /// <summary>
    /// Mirrors the engine's five preferences into the five checkboxes.
    ///
    /// Only ever called once, under <c>_loading</c>. Applying them on every poll --
    /// which is what the frame-rate readouts do -- would undo a tick the moment the
    /// user made it: the box would flip back within a poll interval and the control
    /// would look like it had thrown the click away.
    /// </summary>
    private void ApplyAccessibility(AccessibilityState a, double uiScale = 1.0, bool muted = false)
    {
        HighContrastBox.IsChecked = a.HighContrast;
        MuteAllBox.IsChecked = a.MuteAll;
        KeyboardNavBox.IsChecked = a.KeyboardNavigation;
        FocusVisibleBox.IsChecked = a.FocusVisible;
        ScalableUiBox.IsChecked = a.ScalableUI;

        // Read from the engine rather than computed here, so the number on screen is
        // the multiplier actually in force even when it was restored from the state
        // file or changed from somewhere other than this window.
        UiScaleText.Text = $"Currently {uiScale:0.00}x. Mute is {(muted ? "on" : "off")}.";
    }

    // Five pairs of handlers rather than five shared ones.

    // The alternative is a single handler that reads the sender's name and looks the
    // key up in a table, which is the same shape as a dictionary in a language with
    // real dictionaries: more indirection, and a compile error for a typo is replaced
    // by a silent no-op. Each pair is four lines, and the log line names the
    // preference in English rather than in the renderer's camelCase.
    private void HighContrast_Checked(object sender, RoutedEventArgs e) => SetAccessibility("highContrast", true);
    private void HighContrast_Unchecked(object sender, RoutedEventArgs e) => SetAccessibility("highContrast", false);
    private void MuteAll_Checked(object sender, RoutedEventArgs e) => SetAccessibility("muteAll", true);
    private void MuteAll_Unchecked(object sender, RoutedEventArgs e) => SetAccessibility("muteAll", false);
    private void KeyboardNav_Checked(object sender, RoutedEventArgs e) => SetAccessibility("keyboardNavigation", true);
    private void KeyboardNav_Unchecked(object sender, RoutedEventArgs e) => SetAccessibility("keyboardNavigation", false);
    private void FocusVisible_Checked(object sender, RoutedEventArgs e) => SetAccessibility("focusVisible", true);
    private void FocusVisible_Unchecked(object sender, RoutedEventArgs e) => SetAccessibility("focusVisible", false);
    private void ScalableUi_Checked(object sender, RoutedEventArgs e) => SetAccessibility("scalableUI", true);
    private void ScalableUi_Unchecked(object sender, RoutedEventArgs e) => SetAccessibility("scalableUI", false);

    private static string DescribePreference(string key) => key switch
    {
        "highContrast" => "Higher contrast",
        "muteAll" => "Mute everything",
        "keyboardNavigation" => "Keyboard control",
        "focusVisible" => "Focus outlines",
        "scalableUI" => "Enlarged interface text",
        _ => key,
    };

    private void SetAccessibility(string key, bool enabled)
    {
        if (_loading || _host is null) return;
        _host.SetAccessibility(key, enabled);
        StatusText.Text = $"{DescribePreference(key)} {(enabled ? "on" : "off")}.";
    }

    /* --------------------------- audio reactivity --------------------------- */

    private async Task LoadMediaAsync()
    {
        if (_host is null || _closing) return;
        // Read from the status document rather than evaluating the media system
        // directly: it already carries everything the panel shows, and a second
        // evaluate is a second thing that can disagree.
        var json = await _host.EvaluateAsync("JSON.stringify(window.__engine.getStatus().media)");
        if (_closing || string.IsNullOrWhiteSpace(json) || json == "null") return;

        JsonElement state;
        try
        {
            state = JsonDocument.Parse(RendererRead.Unwrap(json) ?? "null").RootElement.Clone();
        }
        catch (JsonException)
        {
            return;
        }

        _loading = true;
        try
        {
            if (state.ValueKind != JsonValueKind.Object) return;

            var title = state.TryGetProperty("title", out var t) ? t.GetString() ?? "" : "";
            TrackPathText.Text = title.Length > 0 ? title : "No track chosen.";

            var beats = state.TryGetProperty("beatCount", out var b) && b.TryGetInt32(out var n) ? n : 0;
            MediaBeatText.Text = beats > 0
                ? $"{beats} transients found."
                : beats == 0 && title.Length > 0
                    ? "No transients found. Ambient music often has none; that is not an error."
                    : "";

            // Reflected from the engine rather than remembered by the window: the
            // preference can also be restored from the state file on launch, and a
            // checkbox that keeps its own copy would show the wrong answer.
            AudioReactiveBox.IsChecked =
                state.TryGetProperty("playing", out var p) && p.ValueKind == JsonValueKind.True;

            // The times themselves, read from the status document rather than through a
            // second evaluate: the document already carries them, and a panel that
            // special-cases one field is a panel that will forget to update it.
            var media = state.TryGetProperty("media", out var m) ? m : default;
            if (media.ValueKind == JsonValueKind.Object &&
                media.TryGetProperty("firstBeats", out var fb) &&
                fb.ValueKind == JsonValueKind.Array && fb.GetArrayLength() > 0)
            {
                var times = fb.EnumerateArray()
                    .Where(e => e.TryGetDouble(out _))
                    .Select(e => $"{e.GetDouble():0.00}s");
                TrackPathText.Text = $"{TrackPathText.Text}  ·  first transients at {string.Join(", ", times)}";
            }
        }
        finally
        {
            _loading = false;
        }
    }

    private async void PickTrack_Click(object sender, RoutedEventArgs e)
    {
        if (_host is null) return;

        var dialog = new Microsoft.Win32.OpenFileDialog
        {
            Title = "Choose an audio track",
            // Anything Chromium can decode. The renderer does the decoding and reports
            // a failure through the log, so filtering here is a convenience rather than
            // a contract -- a format that fails is reported, not silently ignored.
            Filter = "Audio files|*.mp3;*.wav;*.ogg;*.m4a;*.flac;*.aac|All files|*.*",
        };

        if (dialog.ShowDialog() != true) return;

        TrackPathText.Text = System.IO.Path.GetFileName(dialog.FileName);
        StatusText.Text = "Reading the track...";

        _host.SendMediaTrack(dialog.FileName);
        await _host.EvaluateAsync(
            $"window.__engine._persistence.update({{ audioTrackPath: {System.Text.Json.JsonSerializer.Serialize(dialog.FileName)} }})")
            .ConfigureAwait(true);

        // The beat count is filled in by the decoder a moment later, so this reads the
        // state once, briefly, rather than showing zero and never correcting it.
        await Task.Delay(1200);
        await LoadMediaAsync();
    }

    private void AudioReactive_Checked(object sender, RoutedEventArgs e) => PushAudioReactivity();
    private void AudioReactive_Unchecked(object sender, RoutedEventArgs e) => PushAudioReactivity();
    private void AudioSilent_Checked(object sender, RoutedEventArgs e) => PushAudioReactivity();
    private void AudioSilent_Unchecked(object sender, RoutedEventArgs e) => PushAudioReactivity();

    /// <summary>
    /// Sends both audio options together.
    ///
    /// They are always changed as a pair -- the child box is meaningless without the
    /// parent -- and sending them separately would leave a moment where the engine
    /// believes the other thing.
    /// </summary>
    private void PushAudioReactivity()
    {
        if (_loading || _host is null) return;
        var enabled = AudioReactiveBox.IsChecked == true;
        _host.SetAudioReactivity(enabled, AudioSilentBox.IsChecked == true);
        StatusText.Text = enabled
            ? AudioSilentBox.IsChecked == true
                ? "Audio reactivity on, analysed silently."
                : "Audio reactivity on."
            : "Audio reactivity off.";
    }

    /* ------------------------------- readouts ------------------------------- */

    private struct EngineStatus
    {
        public int Fps;
        public double FrameMs;
        public double MemoryMB;
        public double RenderScale;
        public string Style;
        public string WorldId;
        public string WorldName;
        public int FpsLimit;
        public bool ReducedMotion;
  /// Motion level the renderer is actually using, 0..1.
  public double MotionIntensity;
        public bool Paused;
        public int JournalCount;
        public int SecretsFound;
        public int SecretsTotal;
        public int AnomalyKinds;
        public double UiScale;
        public bool Muted;

        /// <summary>
        /// The five preferences from the accessibility page, as the engine holds them.
        /// </summary>
        public AccessibilityState Accessibility;
    }

    /// <summary>
    /// The renderer's accessibility preferences, mirrored.
    ///
    /// A struct rather than a dictionary so a missing key reads as false rather than
    /// throwing, and so the five names exist in exactly one place on this side.
    /// </summary>
    private struct AccessibilityState
    {
        public bool HighContrast;
        public bool MuteAll;
        public bool KeyboardNavigation;
        public bool ScalableUI;
        public bool FocusVisible;
    }

    private async System.Threading.Tasks.Task<EngineStatus?> GetStatusAsync()
    {
        var json = await _host!.EvaluateAsync("JSON.stringify(window.__engine.getStatus())");
        if (string.IsNullOrWhiteSpace(json)) return null;
        var parsed = JsonNode.Parse(json)?.ToString();
        if (parsed is null) return null;
        var d = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(parsed);
        if (d is null) return null;

        int I(string k) => d.TryGetValue(k, out var v) && v.TryGetInt32(out var n) ? n : 0;
        double Db(string k) => d.TryGetValue(k, out var v) && v.TryGetDouble(out var n) ? n : 0;
        string S(string k) => d.TryGetValue(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
        bool B(string k) => d.TryGetValue(k, out var v) && v.ValueKind == JsonValueKind.True;
        // Nested read for the accessibility block. A flat `B("highContrast")` would
        // always be false, because the renderer groups the five under one object, and
        // five boxes that are all unticked on open look exactly like a working page
        // showing five false preferences.
        bool NB(string outer, string inner) =>
            d.TryGetValue(outer, out var o)
            && o.ValueKind == JsonValueKind.Object
            && o.TryGetProperty(inner, out var iv)
            && iv.ValueKind == JsonValueKind.True;

        return new EngineStatus
        {
            Fps = I("fps"),
            FrameMs = Db("frameMs"),
            MemoryMB = Db("memoryMB"),
            RenderScale = Db("renderScale"),
            Style = S("style"),
            WorldId = S("worldId"),
            WorldName = S("worldName"),
            FpsLimit = I("fpsLimit"),
            ReducedMotion = B("reducedMotion"),
            MotionIntensity = Math.Clamp(Db("motionIntensity"), 0, 1),
            Paused = B("paused"),
            JournalCount = I("journalCount"),
            SecretsFound = I("secretsFound"),
            SecretsTotal = I("secretsTotal"),
            AnomalyKinds = I("anomalyKinds"),
            UiScale = Db("uiScale") <= 0 ? 1.0 : Db("uiScale"),
            Muted = B("muted"),
            Accessibility = new AccessibilityState
            {
                HighContrast = NB("accessibility", "highContrast"),
                MuteAll = NB("accessibility", "muteAll"),
                KeyboardNavigation = NB("accessibility", "keyboardNavigation"),
                ScalableUI = NB("accessibility", "scalableUI"),
                FocusVisible = NB("accessibility", "focusVisible"),
            },
        };
    }

private void ApplyStatus(EngineStatus s)
    {
        if (!_paused) _paused = s.Paused;
        UpdateQuickControls();

        var state = s.Paused ? "Paused" : "Running";
        StatusWorldText.Text = s.WorldName.Length > 0 ? $"{s.WorldName}" : "No world loaded";
        StatusPerfText.Text = $"{s.Fps} fps · {s.FrameMs} ms/frame" +
                              (s.MemoryMB > 0 ? $" · {s.MemoryMB} MB" : "");
        StatusQualityText.Text = $"Art style {s.Style} · render scale {(int)(s.RenderScale * 100)}%" +
                                 (s.FpsLimit == 0 ? " · unlimited fps" : $" · capped at {s.FpsLimit} fps") +
                                 (s.ReducedMotion ? " · reduced motion" : "");

        PerfFpsText.Text = $"{s.Fps} fps";
        PerfRenderScaleText.Text = $"Render scale {(int)(s.RenderScale * 100)}%";
        PerfFrameTimeText.Text = $"Frame time {s.FrameMs} ms" +
                                 (s.MemoryMB > 0 ? $" · {s.MemoryMB} MB heap" : "");

        AnomalyCountText.Text = $"{s.AnomalyKinds} anomalies registered";
        AnomalyListText.Text = $"{s.JournalCount} observation{(s.JournalCount == 1 ? "" : "s")} recorded" +
                               $" · {s.SecretsFound} of {s.SecretsTotal} notes found";

        // Field notes gets its own panel because it is the one section whose
        // contents the user actually reads rather than configures.
        NotesCountText.Text = s.JournalCount == 0
            ? "Nothing recorded yet"
            : $"{s.JournalCount} observation{(s.JournalCount == 1 ? "" : "s")} · " +
              $"{s.SecretsFound} of {s.SecretsTotal} notes recovered";
        NotesListText.Text = s.JournalCount == 0
            ? "The engine is not looking for anything yet. Anomalies are rare by design and are " +
              "scoped to the world you are in, so some places stay quiet for days. That is the " +
              "intended behaviour, not a fault."
            : $"Most recent: {s.WorldName}. Every observation is stored with at least one plausible " +
              "explanation alongside it, so anything you think you saw stays something you could " +
              "reasonably decide you imagined.";

        RefreshMotionControls(s);

        MonitorCountText.Text = $"{Screen.AllScreens.Length} display{(Screen.AllScreens.Length == 1 ? "" : "s")} detected";
        MonitorListText.Text = string.Join(Environment.NewLine, Screen.AllScreens.Select(sc =>
            $"{sc.DeviceName} · {sc.Bounds.Width}x{sc.Bounds.Height}" +
            (sc.Primary ? " · primary (wallpaper attaches here)" : "")));
    }

    /// <summary>
    /// Refreshes the per-display section: the assignment mirror, then the pickers.
    ///
    /// Separate from <see cref="ApplyStatus"/> because it has to cross into the
    /// engine, and therefore has to be awaited. ApplyStatus runs from a path that
    /// cannot wait without blocking the thread the completion needs.
    /// </summary>
    private async Task ApplyDisplaysAsync()
    {
        if (_closing) return;

        // Refreshed before the pickers are built, so they are populated from the
        // engine's real state rather than from whatever was last picked here.
        _displayWorlds = await ReadDisplayWorldsAsync();
        if (_closing) return;
        await BuildDisplayWorldRowsAsync();
    }

    /// <summary>
    /// Reads the engine's per-display assignments.
    ///
    /// Asynchronous, and deliberately so. WebView2 marshals the completion of
    /// ExecuteScriptAsync back onto the UI thread's message loop, so waiting for
    /// one synchronously from the UI thread blocks the very loop that has to
    /// deliver it. That is a deadlock, and because this ran from the one-second
    /// poll it froze the window once a second.
    /// </summary>
    private async Task<Dictionary<string, string>> ReadDisplayWorldsAsync()
    {
        if (_host is null) return new();
        try
        {
            var json = await _host.EvaluateAsync("JSON.stringify(window.__engine.getDisplayWorlds())");
            if (_closing || string.IsNullOrWhiteSpace(json)) return new();
            return JsonSerializer.Deserialize<Dictionary<string, string>>(
                       JsonNode.Parse(json)?.ToString() ?? "{}")
                   ?? new();
        }
        catch
        {
            // The engine is not answering. The window is still usable; the pickers
            // just show no assignments until the next tick.
            return new();
        }
    }

    /// <summary>
    /// Rebuilds the per-display world pickers.
    ///
    /// Only runs when something it depends on has actually changed. This used to
    /// clear the panel and construct a fresh TextBlock and ComboBox per display on
    /// every one-second tick, which threw away focus, discarded any in-progress
    /// interaction and churned the visual tree sixty times a minute for no reason.
    ///
    /// The fingerprint covers the display set, the world list and the current
    /// selections, so a display appearing or disappearing rebuilds, and nothing
    /// else does.
    /// </summary>
    private async Task BuildDisplayWorldRowsAsync()
    {
        ClearDisplayWorlds.Visibility =
            _displayWorlds.Count > 0 ? Visibility.Visible : Visibility.Collapsed;

        if (_host is null) return;
        List<WorldRow>? worlds;
        try
        {
            var json = await _host.EvaluateAsync("JSON.stringify(window.__engine.getWorldDetails())");
            if (_closing || string.IsNullOrWhiteSpace(json)) return;
            worlds = JsonSerializer.Deserialize<List<WorldRow>>(JsonNode.Parse(json)?.ToString() ?? "[]");
        }
        catch
        {
            // The engine is not answering yet. The display list below still renders
            // from Screen.AllScreens, so this is a partial page, not a broken one.
            return;
        }
        if (worlds is null || worlds.Count == 0) return;

        var fingerprint = BuildWorldRowFingerprint(worlds);
        if (fingerprint == _displayRowFingerprint) return;
        _displayRowFingerprint = fingerprint;

        var wasLoading = _loading;
        _loading = true;
        try
        {
            DisplayWorldPanel.Children.Clear();

            foreach (var screen in Screen.AllScreens)
            {
                var deviceName = screen.DeviceName ?? string.Empty;
                var assigned = _displayWorlds.TryGetValue(deviceName, out var w) ? w : null;

                var label = new TextBlock
                {
                    Text = screen.Primary
                        ? $"{deviceName} · primary · {screen.Bounds.Width}x{screen.Bounds.Height}"
                        : $"{deviceName} · {screen.Bounds.Width}x{screen.Bounds.Height}",
                    Style = (Style)FindResource("Note"),
                    Margin = new Thickness(0, 10, 0, 4),
                };

                var combo = new ComboBox { MinWidth = 320, Margin = new Thickness(0, 0, 0, 4) };
                combo.Items.Add("Follow the active world");
                foreach (var world in worlds) combo.Items.Add(world.Name);
                // Index 0 is "follow", so a stored world sits one past it.
                combo.SelectedIndex = 0;
                if (assigned is not null)
                {
                    var at = worlds.FindIndex(x => x.Id == assigned);
                    if (at >= 0) combo.SelectedIndex = at + 1;
                }

                var worldIds = worlds.Select(x => x.Id).ToList();
                combo.SelectionChanged += (_, _) =>
                {
                    if (_loading || _closing) return;
                    var pick = combo.SelectedIndex <= 0 ? null : worldIds[combo.SelectedIndex - 1];
                    _ = SetDisplayWorldAsync(deviceName, pick);
                };

                DisplayWorldPanel.Children.Add(label);
                DisplayWorldPanel.Children.Add(combo);
            }
        }
        finally
        {
            _loading = wasLoading;
        }
    }

    /// <summary>
    /// Identifies the current display-picker state, so the rows are only rebuilt
    /// when something they display has changed.
    /// </summary>
    private string BuildWorldRowFingerprint(List<WorldRow> worlds)
    {
        var sb = new System.Text.StringBuilder();
        foreach (var screen in Screen.AllScreens)
        {
            var id = screen.DeviceName ?? string.Empty;
            sb.Append(id).Append('=').Append(screen.Bounds.Width).Append('x').Append(screen.Bounds.Height)
              .Append(screen.Primary ? '!' : '.').Append(';');
            if (_displayWorlds.TryGetValue(id, out var w)) sb.Append('>').Append(w);
            sb.Append('|');
        }
        sb.Append('#');
        foreach (var w in worlds) sb.Append(w.Id).Append(',');
        return sb.ToString();
    }

    /// <summary>
    /// Applies a per-display world choice, updating the local mirror only when
    /// the engine accepted it so the pickers cannot drift from the real state.
    /// </summary>
    private async Task SetDisplayWorldAsync(string deviceId, string? worldId)
    {
        // Held in a local because _host is a field, and the compiler does not
        // carry a null check on a field across an await that could reassign it.
        var host = _host;
        if (host is null) return;
        try
        {
            // Returns null when the engine cannot be reached, which is a normal
            // state before the renderer has loaded rather than an error.
            var reply = await host.EvaluateAsync(
                $"window.__engine.setDisplayWorld({JsonSerializer.Serialize(deviceId)}, " +
                $"{(worldId is null ? "null" : JsonSerializer.Serialize(worldId))})");
            if (_closing || reply?.Trim() != "true") return;
        }
        catch
        {
            return;
        }

        if (worldId is null) _displayWorlds.Remove(deviceId);
        else _displayWorlds[deviceId] = worldId;
        ClearDisplayWorlds.Visibility = _displayWorlds.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private async void BtnClearDisplayWorlds_Click(object sender, RoutedEventArgs e)
    {
        foreach (var id in _displayWorlds.Keys.ToList()) await SetDisplayWorldAsync(id, null);
        _displayRowFingerprint = null;
        await BuildDisplayWorldRowsAsync();
    }

    private class WorldRow
    {
        public string Id { get; set; } = "";
        public string Name { get; set; } = "";
        public string Biome { get; set; } = "";
        public string Description { get; set; } = "";
        public int Structures { get; set; }
        public bool Active { get; set; }
        public bool Removable { get; set; }
    }
}
