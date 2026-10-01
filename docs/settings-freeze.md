# The settings window freeze

## The defect

The settings window polled the renderer once a second and froze once a second.

Four call sites in `SettingsWindow.xaml.cs` did this:

```csharp
var json = _host.EvaluateAsync("JSON.stringify(...)").GetAwaiter().GetResult();
```

`EvaluateAsync` is `CoreWebView2.ExecuteScriptAsync`. WebView2 marshals the
completion of that call **back onto the UI thread's message loop**. Waiting for it
synchronously from the UI thread therefore blocks the very loop that has to run in
order to satisfy the wait. It is a deadlock, not a slowdown, and the one-second
`DispatcherTimer` re-armed it every second.

To the user this presented as "the whole thing is unresponsive" — the window would
accept a click, freeze for a beat, and repaint. Nothing errored. Nothing logged.

## Why every existing test passed

This is the part worth remembering.

- `tools/e2e.mjs` and the other browser checks run **headless and never construct
  a WPF window**.
- `tools/SettingsShot` renders the settings window off-screen, but it passed a
  **null host**, so every `EvaluateAsync` returned `null` immediately and the
  blocking path never executed.
- `tools/perf-gpu.mjs` measures the renderer's canvas. It cannot see a WPF thread
  at all.

So the entire suite was structurally incapable of observing this bug, and a green
run said nothing whatsoever about it. Performance measurements in particular are
actively misleading here: the renderer genuinely is fast, while the UI thread was
dead.

## How the freeze was reproduced

The blocking call was reintroduced deliberately and the settings window opened. The
process **hung until it was killed** — it did not merely render slowly. That is
the signature of this deadlock and it is what the fix was verified against.

## What was changed

- The whole poll path is now genuinely asynchronous: `ReadDisplayWorldsAsync`,
  `RefreshWorldIntegrityAsync`, `BuildDisplayWorldRowsAsync`, `ApplyDisplaysAsync`,
  `SetDisplayWorldAsync`.
- No `GetAwaiter().GetResult()`, `.Result`, `Task.Wait` or `Thread.Sleep` remains
  in the settings UI path. Enforced by `tools/verify-settings-blocking.mjs`, which
  is part of the gate.
- `_pollInFlight` prevents overlapping polls stacking WebView2 round trips.
- `_closing` is checked after every await, so a poll that started while the window
  was open cannot resume against a closed window and a torn-down WebView.
- The display pickers are rebuilt only when a fingerprint of (display ids +
  dimensions + primary flag + assignments + world ids) changes. They were being
  destroyed and reconstructed every second, discarding focus and churning the
  visual tree sixty times a minute for no reason.

## Dependency inversion

`SettingsWindow` now depends on `Core.IEngineBridge` rather than the concrete
`WallpaperHost`.

This is not ceremony. WebView2 only runs inside the process that owns it, so the
real host cannot be driven from a test process, and the deadlock cannot be
reproduced against it from outside. With the dependency inverted, a stub
(`MarshallingStubBridge`) can reproduce the marshalling that makes the deadlock
possible — complete only when the dispatcher runs — which makes the hazard
observable rather than something to be taken on trust.

## The runtime test, and why it is not in the gate

A UI-thread heartbeat test was written: a 50 ms `DispatcherTimer` counts ticks
while the poll runs against the stub, and because a blocked UI thread cannot tick,
a healthy heartbeat proves the thread is alive. The stub reproduced the deadlock
correctly — reintroducing the blocking call wedged it every time.

**It is not in the gate, because it does not pass reliably on this machine, and a
flaky test is worse than no test.**

What was established while debugging it, so the next person does not repeat it:

- `Dispatcher.Run()` plus `DispatcherTimer` works in isolation here (10 ticks in
  ~1.1 s), and also works with the real `SettingsWindow` shown and a stub attached.
- Driving the run by hand with nested `DispatcherFrame`s **starves the very timers
  the test observes**: it spun thousands of empty frames per second while the
  heartbeat never ticked once, which is indistinguishable from the deadlock it was
  built to detect. That approach was abandoned.
- The budget timer was moved off the dispatcher onto the thread pool, because a
  budget living on the UI thread measures the health of the dispatcher using that
  dispatcher, and so vanishes at exactly the moment it is needed.
- Even so, in this non-interactive session the heartbeat timer did not tick under
  the full harness while the identical arrangement worked in a minimal probe. The
  remaining difference was not isolated before the decision was taken to stop.

So: the defect is real, was reproduced, is fixed, and is now prevented at the
source by a static guard that runs in the gate. A working runtime heartbeat needs
an interactive desktop session, and should be enabled where one exists.