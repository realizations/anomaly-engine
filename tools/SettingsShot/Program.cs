/// <summary>
/// Renders the settings window to a PNG without showing it on screen.
/// </summary>
using System;
using System.IO;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

internal static class SettingsShot
{
    [STAThread]
    private static int Main(string[] args)
    {
        var outDir = args.Length > 0
            ? args[0]
            : Path.Combine("..", "..", "build", "review");
        Directory.CreateDirectory(outDir);

        // A dispatcher is required for a WPF window to measure, arrange and
        // render at all, even when it is never shown.
        var app = new Application();
        var window = LoadSettingsWindow();
        if (window is null)
        {
            Console.Error.WriteLine("Could not construct SettingsWindow.");
            return 1;
        }

        // A Window is not a Visual that can be rendered directly: its content is
        // hosted through a native window handle, and a window that is never shown
        // has no handle, so rendering the Window itself yields a blank white
        // bitmap with no error anywhere. The root element of its content is the
        // thing that actually holds the layout, so that is what gets measured,
        // arranged and rasterised.
        if (window.Content is not FrameworkElement root)
        {
            Console.Error.WriteLine("SettingsWindow has no FrameworkElement content to render.");
            return 1;
        }

        // The window has a fixed design size, but it must be measured and arranged
        // explicitly: nothing pumps a layout pass for a window that is not shown,
        // and a zero-sized render is a silent failure that looks like a white PNG.
        const double W = 980;
        const double H = 680;
        root.Width = W;
        root.Height = H;

        // Every navigation section is captured, not just the landing page. A
        // layout bug in a settings window is almost always on one specific page,
        // and the page that opens first is the least likely to contain it.
        var pages = new (string Button, string Slug)[]
        {
            ("NavHome", "home"),
            ("NavWorlds", "worlds"),
            ("NavLook", "appearance"),
            ("NavPerf", "performance"),
            ("NavEvents", "events"),
            ("NavNotes", "field-notes"),
            ("NavMon", "displays"),
            ("Net", "integrations"),
            ("NavAbout", "about"),
        };

        var total = 0;
        foreach (var (button, slug) in pages)
        {
            SelectPage(window, button);
            root.Measure(new Size(W, H));
            root.Arrange(new Rect(0, 0, W, H));
            root.UpdateLayout();

            // Two settle passes: the first resolves the static layout, the second
            // lets anything deferred on the first (template expansion, text
            // measurement) land before the bitmap is taken.
            Drain();
            root.UpdateLayout();
            Drain();

            var rtb = new RenderTargetBitmap((int)W, (int)H, 96, 96, PixelFormats.Pbgra32);
            rtb.Render(root);
            var encoder = new PngBitmapEncoder();
            encoder.Frames.Add(BitmapFrame.Create(rtb));
            var path = Path.GetFullPath(Path.Combine(outDir, $"settings-{slug}.png"));
            using (var fs = File.Create(path))
            {
                encoder.Save(fs);
            }
            Console.WriteLine($"wrote {path}");
            total++;
        }

        Console.WriteLine($"{total} settings page(s) captured.");
        return 0;
    }

    /// <summary>
    /// Switches the window to a section by raising the navigation button's click,
    /// the same way a person would. The handler is private, so it is invoked
    /// through the button itself rather than by calling the method directly, which
    /// would skip whatever selection state the handler sets up.
    /// </summary>
    private static void SelectPage(Window window, string buttonName)
    {
        var field = window.GetType().GetField(
            buttonName,
            System.Reflection.BindingFlags.Instance
            | System.Reflection.BindingFlags.NonPublic
            | System.Reflection.BindingFlags.Public);
        if (field?.GetValue(window) is not System.Windows.Controls.Button button)
        {
            Console.Error.WriteLine($"  no navigation button named {buttonName}");
            return;
        }
        // ButtonBase.OnClick is protected and parameterless. It raises the Click
        // event, which is what the window's own Click handler is attached to.
        var raise = button.GetType().GetMethod(
            "OnClick",
            System.Reflection.BindingFlags.Instance
            | System.Reflection.BindingFlags.NonPublic
            | System.Reflection.BindingFlags.Public,
            binder: null,
            types: Type.EmptyTypes,
            modifiers: null);
        raise?.Invoke(button, Array.Empty<object>());
    }

    private static Window? LoadSettingsWindow()
    {
        // The window type lives in the app assembly, which has to be loaded before
        // the type can be constructed by name.
        var asm = System.Reflection.Assembly.Load("AnomalyEngine");
        var type = asm.GetType("AnomalyEngine.SettingsWindow.SettingsWindow");
        if (type is null) return null;
        return (Window?)Activator.CreateInstance(type, new object?[] { null, null });
    }

    /// <summary>
    /// Runs the dispatcher queue until it is empty, so pending layout and
    /// binding work completes before the frame is taken.
    /// </summary>
    private static void Drain()
    {
        for (var i = 0; i < 3; i++)
        {
            var frame = new DispatcherFrame();
            Dispatcher.CurrentDispatcher.BeginInvoke(
                DispatcherPriority.ContextIdle,
                new Action(() => frame.Continue = false));
            Dispatcher.PushFrame(frame);
        }
    }
}
