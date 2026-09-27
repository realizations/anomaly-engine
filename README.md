# Anomaly Engine

<p align="center">
  <strong>A live wallpaper engine where the desktop behaves like a living world.</strong>
</p>

<p align="center">
  <a href="https://github.com/realizations/anomaly-engine/actions"><img src="https://img.shields.io/github/actions/workflow/status/realizations/anomaly-engine/ci.yml" alt="CI"></a>
  <a href="https://github.com/realizations/anomaly-engine/releases"><img src="https://img.shields.io/github/v/release/realizations/anomaly-engine" alt="Release"></a>
  <a href="https://github.com/realizations/anomaly-engine/blob/main/LICENSE"><img src="https://img.shields.io/github/license/realizations/anomaly-engine" alt="License"></a>
  <a href="https://github.com/realizations/anomaly-engine/stargazers"><img src="https://img.shields.io/github/stars/realizations/anomaly-engine" alt="Stars"></a>
</p>

<p align="center">
  <em>This isn't a wallpaper. It's a world.</em><br>
  <em>It changes when the sun goes down. It reacts to the weather. It notices events.</em><br>
  <em>Sometimes something happens that you weren't expecting.</em><br>
  <em>You might miss it. That's the point.</em>
</p>

---

## Features

| Feature | Description |
|---------|-------------|
| **Event-Driven World** | Everything is an event: time, weather, astronomy, system state |
| **Day/Night Cycle** | The world changes with real local time |
| **Anomaly System** | Rare, strange events that feel intentional, not random |
| **Journal & Secrets** | Discoveries persist across sessions |
| **Multi-Monitor** | Independent or synchronized worlds per display |
| **Performance-First** | FPS caps, quality presets, dynamic scaling |
| **Offline-First** | Works without internet, degrades gracefully |
| **Privacy-First** | No telemetry, no accounts, no tracking by default |

## Quick Start

```bash
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

**The Town That Wasn't There** — a cozy mysterious town with pine forest, distant mountains, an old radio tower, a small cabin, and an abandoned observatory. Strange lights. Handwritten notes. A mysterious moon.

## Architecture

```
src/
  AnomalyEngine/    C# native host (WebView2, WorkerW injection, tray)
  Engine/           TypeScript core (EventBus, SceneRenderer, WorldSystem)
worlds/             World packages (manifest + scenes + assets + events)
docs/               Documentation
tests/              Test suites
tools/              CLI and utilities
website/            Companion website
```

## Worlds

Worlds are installable packages containing a manifest, scenes, assets, event definitions, and lore. The engine loads them at runtime.

See [`docs/world-format.md`](docs/world-format.md) for the specification.

## Creating a World

See [`docs/creating-a-world.md`](docs/creating-a-world.md) for a tutorial.

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

## Roadmap

- [x] Phase 1 — Basic Wallpaper
- [x] Phase 2 — Living World
- [x] Phase 3 — Real World
- [x] Phase 4 — Mystery
- [x] Phase 5 — Community
- [ ] Phase 6 — Polish

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for guidelines.

## License

MIT — see [`LICENSE`](LICENSE).

---

<p align="center">
  <sub>Built by <a href="https://github.com/realizations">Ali S. (@realizations)</a></sub>
</p>
