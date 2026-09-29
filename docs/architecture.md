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
```

## Adding a world

Write a JSON object matching the schema in [`world-format.md`](world-format.md)
and drop it in, or import it through Settings. Roughly forty lines. No renderer
change, no art pipeline, no licence review.
