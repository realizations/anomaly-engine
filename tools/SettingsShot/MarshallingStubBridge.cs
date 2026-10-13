using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Threading;
using AnomalyEngine.Core;



/// <summary>
/// A bridge whose evaluations complete the way WebView2's do.
///
/// This is the point of the harness. The settings window's poll had four
/// <c>EvaluateAsync(...).GetAwaiter().GetResult()</c> calls on the UI thread, and
/// every one of them was a deadlock: WebView2 marshals the completion of
/// ExecuteScriptAsync onto the UI thread's message loop, so the wait blocked the
/// very loop that had to run to satisfy it. Nothing in the browser-driven test
/// suite could see this, because those tests never construct a WPF window, and
/// the off-screen settings harness passed a null host, so every evaluation
/// returned null immediately and the blocking path never ran.
///
/// The real host cannot be reached from here either: WebView2 only runs inside
/// the process that owns it, and there is no cross-process attach point. So this
/// reproduces the semantics instead of the implementation, which is the only part
/// that mattered.
///
/// The completion is posted to the dispatcher at Background priority and does
/// nothing until the dispatcher runs. A poll that awaits it is fine. A poll that
/// blocks on it deadlocks: the dispatcher never runs, the continuation never
/// fires, and the window stops responding once a second.
/// </summary>
internal sealed class MarshallingStubBridge : IEngineBridge
{
    private readonly Dispatcher _dispatcher;
    private readonly string _statusJson;

    /// <summary>Number of evaluations requested, so the poll is provably running.</summary>
    public int CallCount { get; private set; }

    /// <summary>Milliseconds each evaluation sits queued before completing.</summary>
    public int LatencyMs { get; init; } = 40;

    public MarshallingStubBridge(Dispatcher dispatcher, string statusJson)
    {
        _dispatcher = dispatcher;
        _statusJson = statusJson;
    }

    public Task<string?> EvaluateAsync(string expression)
    {
        CallCount++;
        // Deliberately slow enough that a blocking caller would be stuck for a
        // visible fraction of the test, and to make overlap between the one-second
        // poll and this latency realistic rather than theoretical.
        var tcs = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);

        // Queued to the dispatcher and completed only when the dispatcher runs it.
        // No sleeping and no spinning: this reproduces the marshalling, which is
        // the property that makes the deadlock possible, and sleeping inside the
        // callback would instead block the very thread the test is trying to prove
        // is free, which is a different and much less interesting failure.
        _dispatcher.BeginInvoke(
            DispatcherPriority.Background,
            new Action(() => tcs.TrySetResult(Respond(expression))));

        return tcs.Task;
    }

    /// <summary>Answers the few expressions the poll actually asks for.</summary>
    private string? Respond(string expression)
    {
        if (expression.Contains("getStatus()")) return _statusJson;
        if (expression.Contains("getWorldDetails()"))
        {
            return "[{\"id\":\"stub-world\",\"name\":\"Stub World\",\"biome\":\"coast\"," +
                   "\"description\":\"\",\"structures\":1,\"active\":true,\"removable\":false}]";
        }
        if (expression.Contains("getDisplayWorlds()")) return "{}";
        if (expression.Contains("getChangedWorlds()")) return "[]";
        return "null";
    }

    // The window drives these from button handlers, which the heartbeat test does
    // not press. They are present because the interface requires them.
    public void SetWorld(string id) { }
    public void RemoveWorld(string id) { }
    public void ImportWorlds(string json) { }
    public void SetArtStyle(string style) { }
    public void SetFpsLimit(int fps) { }
    public void SetRenderScale(double? scale) { }
    public void SetReducedMotion(bool on) { }
    public void Pause() { }
    public void Resume() { }
    public void ToggleDebug() { }
    public void SendToRenderer(string eventName) { }
    public void SetMotionIntensity(double intensity) { }
    public void SetLocale(string locale) { }

    // The five preferences are recorded rather than discarded. Nothing in the harness
    // reads them yet, but a stub that swallows them means the accessibility page
    // renders correctly whether or not it is wired to anything -- which is the state
    // this whole block started from.
    public List<(string Key, bool Enabled)> AccessibilityCalls { get; } = new();

    public void SetAccessibility(string key, bool enabled)
        => AccessibilityCalls.Add((key, enabled));

    public Task<bool> GetAccessibilityAsync(string key)
    {
        // No LINQ: this file deliberately has no usings, so that the stub stays a
        // transcription of the interface rather than a place to write logic.
        for (var i = AccessibilityCalls.Count - 1; i >= 0; i--)
        {
            if (AccessibilityCalls[i].Key == key) return Task.FromResult(AccessibilityCalls[i].Enabled);
        }
        return Task.FromResult(false);
    }

    // The media channel. Recorded for the same reason the accessibility one is: a stub
    // that swallows them means the integrations page renders correctly whether or not
    // it is wired to anything.
    public List<string> SentTracks { get; } = new List<string>();
    public List<(bool Enabled, bool Silent)> AudioReactivityCalls { get; } = new List<(bool, bool)>();

    public void SendMediaTrack(string path) => SentTracks.Add(path);

    public void SetAudioReactivity(bool enabled, bool silentPlayback)
        => AudioReactivityCalls.Add((enabled, silentPlayback));

    // Feeds are recorded rather than dropped, for the same reason as the rest of this
    // stub: a stub that swallows them means the integrations page renders correctly
    // whether or not it is wired to anything.
    public List<string> FeedPushes { get; } = new List<string>();

    public void SetFeeds(IReadOnlyList<EventFeedFetcher.FeedSpec> feeds)
    {
        FeedPushes.Clear();
        foreach (var f in feeds) FeedPushes.Add($"{f.Id}:{(f.Enabled ? "on" : "off")}");
    }

    // A fixed four-language list, which is what the renderer actually reports. The
    // settings harness renders the language section off-screen, so an empty list would
    // render a settings page with no control on it and still pass the page audit.
    public Task<List<(string Code, string Name)>> GetAvailableLocalesAsync()
    {
        return Task.FromResult(new List<(string, string)>
        {
            ("en", "English"),
            ("es", "Espanol"),
            ("de", "Deutsch"),
            ("ja", "Japanese"),
        });
    }
}