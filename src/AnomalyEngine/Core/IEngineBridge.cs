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
    void Pause();
    void Resume();
    void ToggleDebug();
    void SendToRenderer(string eventName);
}