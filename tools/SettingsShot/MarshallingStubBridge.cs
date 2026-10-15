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

        // A feed push. The window sends the whole feed list, rules and all, as the
        // argument to `setFeeds(...)`, so recording the expression is enough for a test
        // to see what the editor actually wrote -- there is no other channel it could
        // have left by, because the rules never go to the host.
        if (expression.Contains("window.__engine.setFeeds("))
        {
            SetFeedExpressions.Add(expression);
            return "null";
        }

        // A preview request. Answered as a plausible success so the caller's own parsing
        // runs; the test reads the recorded expression, not this answer.
        if (expression.Contains("window.__engine.previewEffect("))
        {
            PreviewExpressions.Add(expression);
            return "{\"ok\":true,\"fired\":\"second-moon\",\"needsLandscape\":null}";
        }

        // The effect registry and a sample feed, so the integrations page renders the rule
        // editor rather than the empty state. A stub that returned null here would let the
        // page audit pass while the new controls were never constructed at all, which is
        // the failure the accessibility stub was fixed for.
        //
        // The payloads are single-encoded arrays, not the double-encoded strings WebView2
        // really returns. `RendererRead.Unwrap` handles both, which is the point of
        // routing every read through it.
        if (expression.Contains("getEffects()"))
        {
            return "[{\"id\":\"second-moon\",\"name\":\"Second Moon\",\"description\":\"A second moon rises low on the horizon.\",\"family\":\"sky\",\"durationSeconds\":8}," +
                   "{\"id\":\"meteor\",\"name\":\"Meteor\",\"description\":\"Something crosses the sky quickly.\",\"family\":\"sky\",\"durationSeconds\":4}," +
                   "{\"id\":\"observatory-signal\",\"name\":\"Observatory Signal\",\"description\":\"The observatory dish turns on its own.\",\"family\":\"signal\",\"durationSeconds\":30,\"needsLandscape\":\"A world with an observatory\"}," +
                   "{\"id\":\"lights-out\",\"name\":\"Lights Out\",\"description\":\"Every light in the valley goes off at once.\",\"family\":\"behaviour\",\"durationSeconds\":10,\"needsLandscape\":\"A valley, a coast or a settlement\"}]";
        }
        if (expression.Contains("getFeeds()"))
        {
            return "[{\"id\":\"feed1\",\"url\":\"https://example.invalid/feed.xml\",\"kind\":\"rss\"," +
                   "\"intervalSeconds\":3600,\"enabled\":true,\"allowedHosts\":[\"example.invalid\"]," +
                   "\"rules\":[{\"match\":\"maintenance\",\"anomaly\":\"observatory-signal\"}]}," +
                   "{\"id\":\"feed2\",\"url\":\"https://example.invalid/events.json\",\"kind\":\"json\"," +
                   "\"intervalSeconds\":7200,\"enabled\":false,\"allowedHosts\":[\"example.invalid\"],\"rules\":[]}]";
        }
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

    /// <summary>
    /// Every `setFeeds(...)` the window sent, verbatim.
    ///
    /// The rules never reach the host -- only the renderer interprets them -- so this is
    /// the only place a test can observe what the rule editor actually wrote. That it is
    /// also how the assertion is written is the point: it checks the value that crossed
    /// the boundary, not a private field that might have crossed it.
    /// </summary>
    public List<string> SetFeedExpressions { get; } = new List<string>();

    /// <summary>
    /// Every `previewEffect(...)` the window sent.
    ///
    /// The archive's "Show in the world" button is the one control that reaches the live
    /// world, so the thing worth watching is not that it rendered but that pressing it
    /// sent the request. This is where that is observed.
    /// </summary>
    public List<string> PreviewExpressions { get; } = new List<string>();

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