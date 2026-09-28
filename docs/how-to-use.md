# How to Use Anomaly Engine

## Table of Contents

- [Installation](#installation)
- [First Run](#first-run)
- [Tray Icon](#tray-icon)
- [Settings](#settings)
- [Hotkeys](#hotkeys)
- [Interactions](#interactions)
- [Anomalies](#anomalies)
- [Journal](#journal)
- [Secrets](#secrets)
- [CLI](#cli)
- [Troubleshooting](#troubleshooting)

## Installation

### Prerequisites

- Windows 10/11
- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
- [Node.js 20+](https://nodejs.org/)
- [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (pre-installed on Windows 11)

### Build from Source

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

## First Run

On first launch, the engine will:

1. Detect your monitors
2. Load the default world ("The Town That Wasn't There")
3. Attach the renderer behind your desktop icons
4. Show a tray icon in the system tray

The world will start rendering immediately. You should see:

- A sky that changes with time of day
- Stars at night
- A forest silhouette
- A cabin with glowing windows
- An observatory
- A radio tower with a blinking light

## Tray Icon

The engine lives in the system tray. Right-click the tray icon for options:

| Option | Description |
|--------|-------------|
| **Open Settings** | Configure the engine |
| **Pause** | Temporarily stop the wallpaper |
| **Resume** | Resume the wallpaper |
| **Next World** | Cycle through installed worlds |
| **Trigger Event** | Manually fire an event |
| **Performance Mode** | Quick quality adjustment |
| **Settings** | Open the settings window |
| **About** | Version and credits |
| **Exit** | Close the engine |

## Settings

The settings window has sections for:

### Home

- Current world name and version
- Engine status (running/paused)
- Performance summary (FPS, memory, CPU)
- Quick controls (pause, resume, next world, trigger event)

### Worlds

- List of installed worlds
- Activate, preview, delete worlds
- Import new worlds from `.world` files
- Open the worlds folder

### Performance

- **FPS Limit**: 30, 60, 120, or unlimited
- **Quality Preset**: Low, Medium, High, Ultra, Custom
- **Pause on fullscreen**: Stop rendering when a fullscreen app is detected
- **Pause on battery**: Stop rendering when on battery power
- **Dynamic quality**: Automatically adjust quality to maintain FPS
- **Reduce when idle**: Reduce animation when the system is idle

### Events

- **Event sources**: Enable/disable clock, random, weather, system, network, GitHub, RSS, remote events
- **Rarity**: Allow common, uncommon, rare, very rare, legendary events
- **Frequency**: Adjust how often random events fire

### Integrations

- **Weather**: Provider selection, API key, location
- **GitHub**: Username, repositories to monitor
- **RSS**: Feed URLs and update intervals
- **Remote events**: Endpoint URL for community events

### Secrets

- Discovered anomalies count
- Journal entries
- Progress bar

### About

- Version number
- Author credits
- License information

## Hotkeys

| Hotkey | Action |
|--------|--------|
| `Ctrl+Alt+W` | Take a screenshot |
| `Ctrl+Alt+P` | Pause wallpaper |
| `Ctrl+Alt+R` | Resume wallpaper |
| `Ctrl+Alt+T` | Trigger event |
| `Ctrl+Alt+D` | Toggle debug overlay |
| `Ctrl+Alt+C` | Toggle creator mode |

## Interactions

The world has interactive elements:

### Hover

- **Forest**: Leaves rustle slightly
- **Observatory**: The dome glows faintly
- **Cabin**: Windows brighten
- **Radio tower**: The beacon blinks faster
- **Moon**: It pulses once

### Click

- **Observatory**: A signal begins
- **Cabin**: A knock is heard
- **Radio tower**: A transmission starts
- **Forest**: The watcher may appear
- **Moon**: An eclipse begins

### Triple-Click

- **Forest**: The watcher appears
- **Observatory**: The door opens slightly

### Konami Code

Press the following sequence:

```
↑ ↑ ↓ ↓ ← → ← → B A
```

All lights in the town turn on for 10 seconds.

## Anomalies

Anomalies are rare, strange events. They are not random — they are intentional.

### What to Watch For

- A second moon appears for 8 seconds
- Something moves in the forest
- The observatory sends a signal
- The moon turns red
- A shadow walks behind the trees
- The radio tower transmits
- A shooting star crosses the sky
- Fireflies appear at night

### Rarity

| Rarity | Frequency |
|--------|-----------|
| Common | Often |
| Uncommon | Sometimes |
| Rare | Occasionally |
| Very Rare | Rarely |
| Legendary | Almost never |

### Cooldowns

Each anomaly has a cooldown. Once it fires, it won't fire again until the cooldown expires.

## Journal

The journal records every anomaly you observe.

### Entry Fields

- **Timestamp**: When the anomaly was observed
- **Anomaly**: The name of the anomaly
- **Rarity**: How rare the anomaly is
- **Location**: Where in the world it occurred
- **Notes**: Your personal notes
- **Screenshot**: Optional screenshot
- **State**: Unknown, Observed, Discovered, Solved

### Export

Export your journal to:

- **Markdown**: Human-readable format
- **JSON**: Machine-readable format

## Secrets

The world contains secrets that are not documented.

### How to Find Them

- Observe anomalies carefully
- Read the lore
- Explore the world
- Experiment with interactions
- Look for patterns
- Be patient

### What They Unlock

- New anomalies
- New interactions
- New lore
- New worlds
- New features

## CLI

The `livingwall` command-line tool provides additional control.

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

## Troubleshooting

### The wallpaper is not showing

- Check that the engine is running (tray icon)
- Check that the world is loaded
- Check that the renderer is not paused
- Restart the engine

### The wallpaper is frozen

- Check if a fullscreen app is detected
- Check if the system is on battery
- Check if the engine is paused
- Restart the engine

### High CPU usage

- Lower the FPS limit
- Lower the quality preset
- Disable dynamic quality
- Reduce particle count

### High memory usage

- Lower the texture quality
- Reduce the particle limit
- Disable unused features
- Restart the engine

### WebView2 errors

- Ensure WebView2 Runtime is installed
- Update WebView2 Runtime to the latest version
- Reinstall the engine

### Events are not firing

- Check that event sources are enabled
- Check that the rarity settings allow the event
- Check that the cooldown has expired
- Trigger the event manually via CLI

---

<p align="center">
  <sub>Still stuck? Open an <a href="https://github.com/realizations/anomaly-engine/issues">issue</a>.</sub>
</p>
