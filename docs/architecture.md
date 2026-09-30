# Architecture

## Overview

Two layers, split by what only the operating system can do.

```
Windows host (C# / WPF / WebView2)
    desktop integration, tray, hotkeys, fullscreen detection,
    monitor and power state, durable state on disk
        |
        |  postMessage  (WebView2)
        v
Renderer (TypeScript, bundled to a single IIFE)
    event bus and scheduler, world model, scene rendering,
    the observatory terminal, the field-notes overlay
```

The split is not arbitrary. Everything that needs Win32 interop lives on one
side; everything that is a drawing problem lives on the other. Neither layer
reaches across for convenience.

## Why the renderer is a single file:// bundle

The host loads the renderer from disk. Chromium refuses to execute ES module
scripts over `file://` because of CORS, so a normal Vite build renders
**nothing at all**, silently. This shipped as a real bug once already.

Two consequences shape the build:

- The output format is a **classic IIFE**, not ESM, and the entry `<script>` is
  rewritten from `type="module"` to `defer`.
- Worlds are **bundled data**, not fetched JSON, for the same reason. User
  imports arrive through the native bridge instead.

`vite.config.ts` implements the rewrite as a plugin. The end-to-end suite loads
the deployed build over `file://` for exactly this reason: serving over
`http://localhost` hides the failure.

## Attaching behind desktop icons

A wallpaper is not an ordinary window. The host:

1. Creates a WPF window and never shows it as one.
2. Finds the shell's `WorkerW` behind the desktop icons.
3. Reparents the window's HWND to that `WorkerW`.
4. Sizes it to the primary monitor's bounds.

Fullscreen detection excludes the shell's own windows, otherwise every
fullscreen game reports the wallpaper as fullscreen and pauses itself.

## The render pipeline

```
draw into an offscreen buffer at renderScale × dpr
    -> style pass (riso separation, or none)
    -> blit the buffer up to the display canvas
    -> adapt quality from the measured frame time
```

The scene is drawn to a reduced-resolution buffer and blitted, so adaptive
quality can trade resolution for frame rate without the wallpaper visibly
resizing.

### Scene construction is not uniform

A world is a biome, and the biome decides the scene. Five of the six biomes are
landscapes and share one pipeline: sky, stars, sun/moon, clouds, ridges, ground,
structures, weather.

`liminal-interior` does not. An interior has no sky and no ridgeline, so it gets
its own scene constructor and the terrain pipeline never runs for it. Pretending
an interior is a landscape produces nonsense.

### What is cached, and why

Two caches exist because both were measured as too slow without them:

- **The riso print.** A halftone separation is a full-frame readback plus a
  per-pixel dot test. It ran at 181ms a frame. A screen print is a static
  object, so the print is cached and re-imposed only when the scene has actually
  shifted: a quarter-hour step, a weather change, a world or size change, and a
  long maximum-age refresh so slow drift still eventually prints.
- **The painterly finish.** The vignette and film grain are properties of the
  canvas, not of the hour, so they are baked once per resize. What remains per
  frame is a flat multiply fill.

See [`performance.md`](performance.md) for the measurements and for why
cost-per-pixel is the honest figure.

## The two systems that carry the mystery

**The observatory terminal** (`CrtTerminal.ts`) is a composited layer drawn over
the landscape, lit by the same sky. It owns its own geometry, phosphor, scanlines
and typewriter. It is fed world state by the engine through
`setTerminalTelemetry`, so it never reaches into the journal or secret systems
itself.

**The field notes overlay** (`FieldNotes.ts`) is the readable surface, opened on
demand from the tray. It reports the world's premise, what has been observed, and
how far the reader has got, with a plausible denial next to every observation.

The design intent behind both is in [`direction.md`](direction.md).

## The uncanny and surreal layer

`UncannyLayer.ts` draws the near-miss details: a row whose count is slightly off,
marks that are almost legible, pareidolia positioned so a face is available but
never present, and a light rhythm with one interval stretched.

It also fires **one** surreal event at a time, because two violations read as a
joke and one reads as a dream.

Its state is rebuilt per world, because those details are a property of the
place. Carrying them across would make two locations feel like the same location
with different wallpaper.

## Events and anomalies

```
EventSource -> EventBus -> EventScheduler -> handler -> renderer
```

Sources: clock, random, network, and a weather simulation seeded by latitude and
longitude. The simulation is local on purpose, so the desktop behaves the same
offline and no request discloses the user's location.

Anomalies are registered in `AnomalyRegistry` and carry rarity, cooldown and
duration. They are **scoped to biomes and structures**, and the scheduler
substitutes a fitting anomaly when the preferred one does not apply, so a sparse
world never goes silent. The same anomaly is named per world so the journal
reads as a record of a place rather than a global effect log.

## Durable state

```
renderer (localStorage)  <->  native bridge  <->  StateStore  <->  %APPDATA%/AnomalyEngine/state.json
```

A single JSON file, written through the host, coalesced on a timer so the engine
saves on meaningful changes rather than per frame. A corrupt file starts fresh
with a warning rather than refusing to start; the persistence suite proves it.

The renderer reads the same state directly when running in a plain browser, so
the engine is testable without the host.

## Layer boundaries

| Layer | May depend on | Must not reach for |
|---|---|---|
| Renderer | Its own state, the bridge | The journal, secrets, file system |
| Host | Win32, WebView2, disk | Anything about how a scene is drawn |
| Worlds | Pure data, no imports | The renderer or the host |
| Tools | The deployed build | Source files |

`WorldLoader` validates every world before registering it and returns all
problems, not just the first. An imported world is untrusted data and can never
carry code: worlds are data, so there is no execution surface to police.

Imported worlds are persisted as their definitions rather than as ids, because an
id cannot rebuild a world on the next launch. They are re-validated on load, by
exactly the same path a fresh import takes: the state file lives somewhere a user
can edit, so it is treated as untrusted input and not as something the app wrote
and can therefore assume is sound. Built-ins are excluded from the saved set, so a
built-in change is never shadowed by a stale copy in a user's state.

Writes are debounced, because the engine mutates state in bursts when a world
changes, and a pending write is flushed on `pagehide`, `beforeunload` and
`visibilitychange`. A hosted wallpaper is terminated as often as it is closed,
and without the flush anything changed in that window would be lost silently.

## World integrity

A world is validated against a schema when it is imported, but a schema check
only proves a definition is well-formed. It says nothing about whether the same
content is still there on the next launch, so a world edited between sessions
would be re-registered as if nothing had happened.

Each imported world therefore carries a digest, recorded when it is first
accepted and recomputed every time it is restored. A mismatch is **reported, not
rejected**: a world is the user's own file and they may have edited it on purpose,
so refusing it would be a worse failure than telling them it changed. What is not
acceptable is the change passing unnoticed, so the Worlds page in settings shows
which worlds changed and offers to accept the new contents as the baseline.

The digest is a synchronous four-lane 128-bit FNV-1a, and it is honest about not
being a cryptographic hash. `crypto.subtle.digest`, the obvious choice, is a
secure-context API that is not guaranteed over `file://` and is asynchronous,
while worlds are registered from a synchronous load path. A security check that
quietly stops running when its API is missing is worse than a checksum that
always runs, so the digest is prefixed `fnv128:` to say what produced it. It
detects "this file changed", which is the property relied on; it is not a defence
against a constructed collision and is not described as one.

`crypto.subtle` *is* present in the current WebView2 over `file://`, so this is a
deliberate choice of a check that always runs over one that is stronger when it
happens to be available.

## Per-display worlds

A display can be given its own world, so a two-screen setup does not have to show
the same place twice. The renderer holds its world as instance state and most of
the draw code reads it directly, so a viewport carrying its own world has it
swapped in for the duration of its one compose and the previous one restored
afterwards. Everything derived from the world is rebuilt on that swap, not just
the world itself: the terrain, the structures, the near-miss details and the
anomaly set are all built from the world and cached, so restoring only the world
would draw one world's sky over another's ground.

Assignments are keyed on the display's **device name**, not on its index in the
monitor list and not on its rectangle. Both of those are positions rather than
identities. Windows reorders the list when the primary display changes, and a
monitor moved to another port changes its rectangle, so either would let a
setting drift onto the wrong screen. An id that matches no attached display is
kept rather than discarded, because a monitor that is currently unplugged is a
normal state and the assignment should still be there when it comes back.

`tools/per-display-worlds.mjs` proves the assignment reaches the composition by
comparing pixel samples from the two halves of the canvas. Asserting on the
stored mapping would prove nothing: the mapping could persist perfectly while the
renderer ignored it, and the check would still pass.

## Project layout

```
src/Engine/src/
    core/          event bus, scheduler, entity manager, state manager
    events/        clock, random and network event sources
    worlds/        world schema, validation, built-in definitions, loader
    renderer/      the renderer, the terminal, the interior, the uncanny layer
    render/        noise, palette, time-of-day grading, astronomy
    systems/       weather, astronomy, anomalies, journal, secrets, particles
    platform/      bridge, persistence, field notes, debug, away summary
src/AnomalyEngine/
    Core/          wallpaper host, tray, hotkeys, state store, fullscreen
    SettingsWindow/
tools/             verification, showcase, performance, licence gate
    SettingsShot/   renders the settings window to PNG without displaying it
```

## The settings window is reviewed, not assumed

The settings window is the only surface the browser-driven tooling cannot reach.
Everything else is a canvas the renderer owns and can be measured or screenshotted
directly, but this is a native WPF window, and its bugs are invisible to an
end-to-end test. It has had real ones: navigation labels clipped to a few
characters because a `StackPanel` was left as a direct child of a `DockPanel`, and
two dropdowns rendering as default grey Windows controls against a dark phosphor
interface because a `ComboBox` paints itself from a `ControlTemplate` and setting
`Background` on the style does nothing without one.

Both were found by looking at the rendered window. `tools/SettingsShot` lays the
window out and rasterises it through `RenderTargetBitmap` **without displaying
it**, so the surface can be reviewed on a machine whose owner is using it, with no
wallpaper appearing on the desktop. `tools/settings-shot.mjs` runs all nine
sections and asserts each produced a real image, because a window that never got
a layout pass renders as a small blank PNG and reports no error at all.

## Adding a world

Write a JSON object matching the schema in [`world-format.md`](world-format.md)
and drop it in, or import it through Settings. Roughly forty lines. No renderer
change, no art pipeline, no licence review.
