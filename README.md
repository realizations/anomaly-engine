# Anomaly Engine

A live wallpaper engine where the desktop behaves like a living world.

This isn't a wallpaper. It's a world.

It changes when the sun goes down. It reacts to the weather. It notices events.
Sometimes something happens that you weren't expecting.

You might miss it. That's the point.

## Features

- **Event-driven living world** — everything is an event: time, weather, astronomy, system state
- **Day/night cycle** — the world changes with real local time
- **Anomaly system** — rare, strange events that feel intentional, not random
- **Journal** — discoveries persist across sessions
- **Multi-monitor** — independent or synchronized worlds per display
- **Performance-first** — FPS caps, quality presets, dynamic scaling
- **Offline-first** — works without internet, degrades gracefully
- **Privacy-first** — no telemetry, no accounts, no tracking by default

## Quick Start

```bash
# Clone and enter
git clone https://github.com/realizations/anomaly-engine.git
cd anomaly-engine

# Build the web renderer
cd src/Engine
npm install
npm run build

# Build the native host
cd ../AnomalyEngine
dotnet build

# Run
dotnet run
```

## First World

**The Town That Wasn't There** — a cozy mysterious town with pine forest,
distant mountains, an old radio tower, a small cabin, and an abandoned
observatory. Strange lights. Handwritten notes. A mysterious moon.

## Architecture

```
src/
  AnomalyEngine/    C# native host (WebView2, WorkerW injection, tray)
  Engine/           TypeScript core (EventBus, SceneRenderer, WorldSystem)
worlds/             World packages (manifest + scenes + assets + events)
docs/               Documentation
tests/              Test suites
```

## Worlds

Worlds are installable packages containing a manifest, scenes, assets,
event definitions, and lore. The engine loads them at runtime.

See `docs/world-format.md` for the specification.

## Creating a World

See `docs/creating-a-world.md` for a tutorial.

## CLI

```bash
livingwall list
livingwall world list
livingwall world install <path>
livingwall world remove <id>
livingwall world validate <path>
livingwall event trigger <id>
livingwall debug
livingwall screenshot
```

## Contributing

See `CONTRIBUTING.md` for guidelines.

## License

MIT — see `LICENSE`.
