using System.Threading.Tasks;

namespace AnomalyEngine.Core;

/// <summary>
/// Everything the settings window needs from the native host.
///
/// Extracted so the window does not depend on the concrete host. Two reasons, and
/// the second is the important one.
///
/// First, it keeps the boundary honest: the window's job is to show state and
/// drive it, and the host's job is to own the WebView2 and the Win32 bits. A
/// window holding a reference to the whole host can reach anything on it, and
/// will eventually reach something that is not its business.
///
/// Second, it makes the blocking bug testable. WebView2 marshals the completion
/// of ExecuteScriptAsync back onto the UI thread's message loop, so a poll that
/// waits for one synchronously from that thread deadlocks: the loop is blocked
/// by the wait and is the very thing that has to run to satisfy it. That
/// behaviour is impossible to reproduce against the real host from another
/// process, because WebView2 only runs inside the process that owns it. With the
/// dependency inverted, a stub can reproduce the exact marshalling semantics --
/// complete only when the dispatcher runs -- and then the deadlock is real and
/// observable rather than something to be taken on trust.
/// </summary>
public interface IEngineBridge
{
    /// <summary>
    /// Evaluates an expression in the renderer and returns its value as JSON, or
    /// null when the renderer cannot be reached.
    ///
    /// Implementations must complete asynchronously on the UI thread. Callers must
    /// await it: waiting on it from the UI thread deadlocks.
    /// </summary>
    Task<string?> EvaluateAsync(string expression);

    void SetWorld(string id);
    void RemoveWorld(string id);
    void ImportWorlds(string json);
    void SetArtStyle(string style);
    void SetFpsLimit(int fps);
    void SetRenderScale(double? scale);
    void SetReducedMotion(bool on);

    /// <summary>
    /// Sets one accessibility preference, by the renderer's own key name.
    ///
    /// A name and a value rather than a whole config, and the name is the renderer's
    /// vocabulary rather than this window's: <c>AccessibilitySystem.KEYS</c> is the
    /// list, and an unrecognised name is logged and dropped by the renderer instead of
    /// being stored as a preference nobody reads.
    ///
    /// This is the channel that makes the five preferences that existed only as
    /// fields reachable at all. There is one rather than five methods because they
    /// differ only in the string, and five methods would be five chances for the
    /// window and the renderer to disagree about which one a key belongs to.
    /// </summary>
    void SetAccessibility(string key, bool enabled);

    /// <summary>
    /// Hands the renderer the bytes of an audio track the user chose.
    ///
    /// Base64 rather than raw bytes because the channel is a JSON web message. The
    /// host reads the file and the renderer decodes it, because the renderer cannot:
    /// the page is served from <c>file://</c>, where Chromium blocks local
    /// <c>fetch</c>, and the content security policy sets <c>connect-src 'none'</c> on
    /// top of that.
    /// </summary>
    void SendMediaTrack(string path);

    /// <summary>Turns audio reactivity on or off, and whether the track is audible.</summary>
    void SetAudioReactivity(bool enabled, bool silentPlayback);

    /// <summary>
    /// Whether the renderer currently holds this accessibility preference.
    ///
    /// Read back from the engine rather than tracked by this window: a preference can
    /// also be restored from the state file on launch or changed from the tray, and a
    /// checkbox that kept its own copy would show the wrong answer in both cases.
    /// </summary>
    Task<bool> GetAccessibilityAsync(string key);
    void Pause();
    void Resume();
    void ToggleDebug();

    /// <summary>
    /// Dispatches a renderer event by its short name, e.g. "notes" for
    /// <c>anomaly:notes</c>. The prefix is the host's business, not the caller's.
    /// </summary>
    void SendToRenderer(string eventName);

    /// <summary>Sets the interface language by locale code. Not an event: a payload.</summary>
    void SetLocale(string locale);

    /// <summary>The interface languages the renderer reports, as (code, name).</summary>
    Task<List<(string Code, string Name)>> GetAvailableLocalesAsync();

    /// <summary>Sets scene motion, 0 to 1. Not an event: this evaluates a call.</summary>
    void SetMotionIntensity(double intensity);
}