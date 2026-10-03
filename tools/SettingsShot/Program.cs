/// <summary>
/// Renders the settings window to PNG, and proves its poll does not block the UI
/// thread.
/// </summary>
///
/// <remarks>
/// Two jobs, both because the settings window is the one surface the
/// browser-driven tooling cannot reach.
///
/// The first is visual. Everything else in the product is a canvas the renderer
/// owns and can be screenshotted directly; this is a native WPF window whose
/// layout bugs are invisible to an end-to-end test. It has had real ones:
/// navigation labels clipped to a few characters, and two dropdowns rendering as
/// default grey Windows controls because a ComboBox paints itself from a
/// ControlTemplate. Both were found by looking at the rendered window.
///
/// The second is the freeze. The poll had four
/// <c>EvaluateAsync(...).GetAwaiter().GetResult()</c> calls on the UI thread.
/// WebView2 marshals the completion of ExecuteScriptAsync back onto the UI
/// thread's message loop, so waiting for one synchronously from that thread
/// blocks the loop that has to satisfy the wait: a deadlock, re-armed every
/// second by the one-second poll. It froze the window once a second and read as
/// "the whole app is unresponsive".
///
/// Neither could be caught by the existing suite. The browser checks never
/// construct a WPF window, and the off-screen page capture passed a null host, so
/// every evaluation returned null immediately and the blocking path never ran.
/// That is why the window now takes an interface, so a stub can reproduce the
/// marshalling that causes the deadlock and make it observable.
///
///   dotnet run --project tools/SettingsShot -c Release -- <outdir> [with-host]
/// </remarks>
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using AnomalyEngine.Core;

internal static class SettingsShot
{
    [STAThread]
    private static int Main(string[] args)
    {
        var outDir = args.Length > 0 ? args[0] : Path.Combine("..", "..", "build", "review");

        // Two modes, deliberately separate.
        //
        // Capturing nine pages means driving the dispatcher by hand with nested
        // DispatcherFrames, and doing that first left the dispatcher in a state
        // where Dispatcher.Run() no longer pumped timers, so the heartbeat phase
        // hung for reasons that had nothing to do with the thing it was testing.
        // Running them in one process also meant a pass in one could hide a fail in
        // the other. They are independent checks and now run independently.
var mode = args.FirstOrDefault(a => a.StartsWith("--", StringComparison.Ordinal))
                    ?? "--capture";
        return mode switch
        {
            "--heartbeat" => RunHeartbeatMode(),
            _ => RunCaptureMode(outDir),
        };
    }

    /// <summary>
    /// The UI-thread heartbeat.
    ///
    /// Runs alone, in its own process, with no page capture before it. Capturing
    /// nine pages means driving the dispatcher by hand with nested
    /// DispatcherFrames, and doing that first left the dispatcher in a state where
    /// Dispatcher.Run() no longer pumped timers — so the heartbeat hung for reasons
    /// that had nothing to do with the thing it was testing. Separate processes,
    /// separate dispatchers, no cross-contamination.
    /// </summary>
    private static int RunHeartbeatMode()
    {
        _ = new Application();

        // The stub completes only when the dispatcher runs, which is the whole
        // point: it reproduces the marshalling that makes the deadlock possible.
        // A stub that returned synchronously would let a blocking caller finish,
        // and the test would pass against the exact bug it exists to catch.
        var stub = new MarshallingStubBridge(Dispatcher.CurrentDispatcher, StubStatusJson());
        var window = LoadSettingsWindow(stub);
        if (window is null)
        {
            Console.Error.WriteLine("Could not construct SettingsWindow.");
            return 1;
        }

        return RunHeartbeat(window, stub) ? 0 : 1;
    }

    private static int RunCaptureMode(string outDir)
    {
        Directory.CreateDirectory(outDir);
        // A dispatcher is required for a WPF window to measure, arrange and render
        // at all, even when it is never shown.
        _ = new Application();

        var window = LoadSettingsWindow(null);
        if (window is null)
        {
            Console.Error.WriteLine("Could not construct SettingsWindow.");
            return 1;
        }
        if (!CapturePages(window, outDir, out var captured))
        {
            return 1;
        }
        Console.WriteLine($"{captured} settings page(s) captured.");
        return 0;
    }

    /// <summary>A status document shaped like the renderer's, so the poll does real work.</summary>
    private static string StubStatusJson() =>
        "{\"fps\":60,\"frameMs\":4.2,\"memoryMB\":18,\"renderScale\":1,\"style\":\"painterly\"," +
        "\"worldId\":\"stub-world\",\"worldName\":\"Stub World\",\"fpsLimit\":60," +
        "\"reducedMotion\":false,\"paused\":false,\"journalCount\":2,\"secretsFound\":1," +
        "\"secretsTotal\":7,\"anomalyKinds\":6,\"displays\":1}";

    /// <summary>
    /// Renders every navigation section to its own PNG.
    ///
    /// All of them, not just the landing page: a layout bug in a settings window is
    /// almost always on one specific page, and the page that opens first is the
    /// least likely to contain it.
    /// </summary>
    private static bool CapturePages(Window window, string outDir, out int captured)
    {
        // A Window is not a Visual that can be rendered directly: its content is
        // hosted through a native window handle, and a window that is never shown
        // has no handle, so rendering the Window itself yields a blank white
        // bitmap with no error anywhere. The root element of its content holds the
        // layout, so that is what gets measured, arranged and rasterised.
        if (window.Content is not FrameworkElement root)
        {
            Console.Error.WriteLine("SettingsWindow has no FrameworkElement content to render.");
            captured = 0;
            return false;
        }

        // Nothing pumps a layout pass for a window that is not shown, so a
        // zero-sized render is a silent failure that looks like a white PNG.
        const double W = 980;
        const double H = 680;
        root.Width = W;
        root.Height = H;

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
            // lets anything deferred on the first land before the bitmap is taken.
            Drain();
            root.UpdateLayout();
            Drain();

            var rtb = new RenderTargetBitmap((int)W, (int)H, 96, 96, PixelFormats.Pbgra32);
            rtb.Render(root);
            var encoder = new PngBitmapEncoder();
            encoder.Frames.Add(BitmapFrame.Create(rtb));
            using var fs = File.Create(Path.GetFullPath(Path.Combine(outDir, $"settings-{slug}.png")));
            encoder.Save(fs);
            total++;
        }
        captured = total;
        return true;
    }

    /// <summary>
    /// Proves the poll leaves the UI thread responsive, with a watchdog so a
    /// regression reports itself instead of hanging.
    /// </summary>
    private static bool RunHeartbeat(Window window, MarshallingStubBridge stub)
    {
        // The deadlock does not merely stop the heartbeat, it stops the dispatcher
        // returning from its message loop at all. That was verified by
        // reintroducing the blocking call: the process hung until it was killed.
        // A test that hangs for fifteen minutes is barely better than no test,
        // because it stalls whatever runs it. So the watchdog lives on its own
        // thread, which the deadlock cannot block.
        using var finished = new ManualResetEventSlim(false);
        const int budgetMs = 40000;
        var watchdog = new Thread(() =>
        {
            if (finished.Wait(budgetMs)) return;
            Console.Out.Flush();
            Console.Error.WriteLine();
            Console.Error.WriteLine($"FAIL  the UI thread never left its message loop within {budgetMs / 1000}s.");
            Console.Error.WriteLine("      That is the settings poll deadlock: EvaluateAsync is waited on");
            Console.Error.WriteLine("      synchronously from the UI thread, and its completion can only be");
            Console.Error.WriteLine("      delivered by the thread being blocked. See ReadDisplayWorldsAsync.");
            // Hard exit: the UI thread is stuck in a loop that will never end, so
            // there is nothing left to unwind cleanly.
            Environment.Exit(3);
        })
        { IsBackground = true, Name = "ui-thread-watchdog" };
        watchdog.Start();

        try
        {
            return RunHeartbeatCore(window, stub);
        }
        finally
        {
            finished.Set();
        }
    }

    private static bool RunHeartbeatCore(Window window, MarshallingStubBridge stub)
    {
        var beats = 0;
        var before = stub.CallCount;

        var heartbeat = new DispatcherTimer(DispatcherPriority.Normal)
        {
            Interval = TimeSpan.FromMilliseconds(50),
        };
        var diagPath = Environment.GetEnvironmentVariable("SETTINGS_SHOT_DIAG");
        heartbeat.Tick += (_, _) =>
        {
            beats++;
            if (diagPath is not null && beats % 20 == 0)
                File.AppendAllText(diagPath, $"beats={beats} evals={stub.CallCount} pool={Environment.CurrentManagedThreadId}`r`n");
        };

        // The run is driven from the real WPF message loop rather than by pumping
        // DispatcherFrames by hand. A hand-rolled pump can starve the very timers
        // and queued work the test is trying to observe, and did: it spun thousands
        // of empty frames a second while the heartbeat never ticked once, which
        // reads exactly like the deadlock it was meant to detect.
        //
        // The budget deliberately lives on the thread pool and not on a
        // DispatcherTimer. A budget timer on the UI thread is measuring the health
        // of the dispatcher using that dispatcher, which means it stops the instant
        // the thing it is watching goes wrong, and the run then ends by hanging
        // rather than by reporting. A pool timer cannot be stopped that way.
        const int BudgetMs = 6000;
        var dispatcher = Dispatcher.CurrentDispatcher;

        using var finished = new System.Threading.ManualResetEventSlim(false);
        using var budget = new System.Threading.Timer(_ =>
        {
            // Posted rather than called: Dispatcher.ExitAllFrames has to run on the
            // dispatcher thread, and the pool thread is not it.
            dispatcher.BeginInvoke(DispatcherPriority.Send, new Action(Dispatcher.ExitAllFrames));
        }, null, BudgetMs, Timeout.Infinite);

        heartbeat.Start();
        window.ShowInTaskbar = false;
        window.WindowState = WindowState.Minimized;
        window.Show();

        // The real WPF loop, exactly as it runs while the window is open.
        Dispatcher.Run();

        heartbeat.Stop();
        budget.Dispose();
        window.Close();

        var polled = stub.CallCount - before;
        var expected = BudgetMs / 50;
        // The point is not the exact count. A blocked UI thread produces nothing at
        // all; a live one produces roughly the expected number, give or take
        // scheduling jitter on a machine that is also running a test suite.
        var beatsOk = beats > expected * 0.5 && beats > 10;

        // The poll must also actually have run. A window that never polled would
        // keep beating while proving nothing at all.
        var polledOk = polled > 0;

        Console.WriteLine();
        Console.WriteLine($"UI-thread heartbeat over {BudgetMs / 1000.0:F1}s: {beats} beats (expected about {expected})");
        Console.WriteLine($"engine evaluations during the run: {polled}");

        var ok = beatsOk && polledOk;
        if (ok)
        {
            Console.WriteLine("PASS  the settings poll left the UI thread responsive.");
            return true;
        }

        if (!polledOk)
        {
            Console.WriteLine("FAIL  the poll never ran, so this proves nothing.");
        }
        if (!beatsOk)
        {
            Console.WriteLine("FAIL  the UI thread stalled during the settings poll.");
        }
        return false;
    }

    /// <summary>
    /// Switches the window to a section by raising the navigation button's click,
    /// the same way a person would, so whatever selection state the handler sets up
    /// still happens.
    /// </summary>
    private static void SelectPage(Window window, string buttonName)
    {
        var field = window.GetType().GetField(
            buttonName,
            System.Reflection.BindingFlags.Instance
            | System.Reflection.BindingFlags.NonPublic
            | System.Reflection.BindingFlags.Public);
        if (field?.GetValue(window) is not Button button) return;

        // ButtonBase.OnClick is protected and parameterless; it raises the Click
        // event the window's own handler is attached to.
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

    private static Window? LoadSettingsWindow(IEngineBridge? bridge)
    {
        // The window type lives in the app assembly, which has to be loaded before
        // the type can be constructed by name.
        var asm = System.Reflection.Assembly.Load("AnomalyEngine");
        var type = asm.GetType("AnomalyEngine.SettingsWindow.SettingsWindow");
        if (type is null) return null;
        return (Window?)Activator.CreateInstance(type, new object?[] { bridge, null });
    }

    /// <summary>Runs the dispatcher queue until it is empty, so deferred layout lands.</summary>
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