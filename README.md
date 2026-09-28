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

## The World

Everything below is drawn procedurally at runtime. No sprite sheets, no video loops.

| Night | Golden Hour |
|---|---|
| ![Night](docs/images/01-night.png) | ![Golden](docs/images/06-golden.png) |

| Storm | Second Moon (anomaly) |
|---|---|
| ![Storm](docs/images/10-storm.png) | ![Second moon](docs/images/13-anomaly-second-moon.png) |

---

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [How to Use](#how-to-use)
- [Creating a World](#creating-a-world)
- [Architecture](#architecture)
- [CLI](#cli)
- [Contributing](#contributing)
- [Roadmap](#roadmap)
- [License](#license)

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

### Prerequisites

- Windows 10/11
- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
- [Node.js 20+](https://nodejs.org/)
- [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (pre-installed on Windows 11)

### Build

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
```

### Run

```bash
cd src/AnomalyEngine
dotnet run
```

The engine will attach to your desktop and render the default world.

## How to Use

### First Run

On first launch, the engine will:

1. Detect your monitors
2. Load the default world ("The Town That Wasn't There")
3. Attach the renderer behind your desktop icons
4. Show a tray icon in the system tray

### Tray Icon

Right-click the tray icon for options:

- **Open Settings** — Configure the engine
- **Pause / Resume** — Temporarily stop the wallpaper
- **Next World** — Cycle through installed worlds
- **Trigger Event** — Manually fire an event
- **Performance Mode** — Quick quality adjustment
- **About** — Version and credits
- **Exit** — Close the engine

### Settings

The settings window has sections for:

- **Home** — Current world, status, quick controls
- **Worlds** — Install, activate, preview, delete worlds
- **Performance** — FPS limit, quality preset, pause conditions
- **Events** — Enable/disable event sources, rarity settings
- **Integrations** — Weather, GitHub, RSS, remote event feed
- **Secrets** — Discovered anomalies, journal, progress
- **About** — Version, credits, license

### Hotkeys

| Hotkey | Action |
|--------|--------|
| `Ctrl+Alt+W` | Take a screenshot |
| `Ctrl+Alt+P` | Pause wallpaper |
| `Ctrl+Alt+R` | Resume wallpaper |
| `Ctrl+Alt+T` | Trigger event |
| `Ctrl+Alt+D` | Toggle debug overlay |
| `Ctrl+Alt+C` | Toggle creator mode |

### Interactions

The world has interactive elements:

- **Hover** over the forest — leaves rustle
- **Click** the observatory — signal begins
- **Triple-click** the forest — watcher appears
- **Hover** the moon at midnight — it pulses
- **Konami code** — all lights turn on

### Anomalies

Anomalies are rare, strange events. Some examples:

- A second moon appears for 8 seconds
- Something moves in the forest
- The observatory sends a signal
- The moon turns red
- A shadow walks behind the trees

When you observe an anomaly, it's recorded in your journal. The journal persists across sessions.

### Secrets

The world contains secrets that are not documented. Some are hidden in plain sight. Others require patience, observation, and curiosity.

Discovering secrets unlocks new anomalies, new interactions, and new lore.

## Creating a World

Worlds are installable packages containing a manifest, scenes, assets, event definitions, and lore.

### World Structure

```
my-world/
  manifest.json          # Required: world metadata
  scenes/
    main.html            # Required: entry scene
  assets/
    sprites/             # Images (PNG, WebP, SVG)
    audio/               # Sounds (WAV, OGG)
    textures/            # Textures
  events/
    definitions.json     # Event definitions
  lore/
    journal.md           # Lore pages
  README.md              # World documentation
```

### Manifest

```json
{
  "id": "my-world",
  "name": "My World",
  "author": "Your Name",
  "version": "1.0.0",
  "engine": ">=0.1.0",
  "entryScene": "main",
  "description": "A short description",
  "features": {
    "weather": true,
    "astronomy": true,
    "systemEvents": true,
    "audioReactive": false
  },
  "scenes": [
    {
      "id": "main",
      "file": "scenes/main.html"
    }
  ]
}
```

### Tutorial

See [`docs/creating-a-world.md`](docs/creating-a-world.md) for a step-by-step tutorial.

### API

Worlds interact with the engine through a small API:

```typescript
world.on('event', (event) => { ... });
world.emit(event);
world.spawn(entity);
world.scene(name);
world.random(seed?);
world.time();
world.weather();
world.audio.play(soundId);
world.storage.get(key);
world.secrets.unlock(id);
```

See [`docs/world-api.md`](docs/world-api.md) for the full API reference.

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

### Event Flow

```
Event Source → EventBus → Event Handlers → Scene Renderer
     ↑                                      ↓
     └────────── User Input ←───────────────┘
```

## CLI

```bash
# List installed worlds
livingwall list

# Install a world
livingwall world install path/to/world.world

# Remove a world
livingwall world remove my-world

# Validate a world package
livingwall world validate path/to/world.world

# Trigger an event manually
livingwall event trigger meteor-shower

# Take a screenshot
livingwall screenshot

# Enable debug mode
livingwall debug
```

## Contributing

We welcome contributions of all kinds. Here's how to get involved:

### Contribution Levels

| Level | Contribution |
|-------|-------------|
| 1 | Documentation fixes and improvements |
| 2 | World assets (sprites, audio, textures) |
| 3 | Event and anomaly definitions |
| 4 | Integrations (weather, GitHub, RSS, etc.) |
| 5 | Engine development (core architecture) |

### Getting Started

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes
4. Run tests: `dotnet test` and `npm test`
5. Submit a pull request

### Guidelines

- Follow the existing code style
- Write tests for new functionality
- Update documentation if needed
- No secrets or API keys
- Be respectful and constructive

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for detailed guidelines.

### Need Help?

- Open an [issue](https://github.com/realizations/anomaly-engine/issues) for bugs or feature requests
- Check the [discussions](https://github.com/realizations/anomaly-engine/discussions) for general questions
- Read the [documentation](docs/) for technical details

## Roadmap

- [x] Phase 1 — Basic Wallpaper
- [x] Phase 2 — Living World
- [x] Phase 3 — Real World
- [x] Phase 4 — Mystery
- [x] Phase 5 — Community
- [ ] Phase 6 — Polish

See [issues](https://github.com/realizations/anomaly-engine/issues) for planned features and improvements.

## License

MIT — see [`LICENSE`](LICENSE).

---

<p align="center">
  <sub>Built by <a href="https://github.com/realizations">Ali S. (@realizations)</a></sub>
</p>
