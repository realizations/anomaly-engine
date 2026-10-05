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

The settings window has nine sections: Home, Worlds, Appearance, Performance,
Events, Field Notes, Displays, Integrations and About.

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

### Appearance

- **Art style**: Painterly, Flat Vector or Riso Print
- **Motion level**: How much of the scene moves
- **Follow the Windows reduce-motion setting**: Take the OS preference rather than
  setting it here

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

### Field Notes

What is recorded, and why. The journal of observations, the open questions each
one carries, and progress toward the notes that are still unrecorded.

This is a settings page only in the sense that it is a place to read what the
engine has written down. Nothing here is configurable, deliberately: discovering
a secret is not a preference, and a progress bar with a checkbox beside it would
imply there was a setting to change.

### Displays

The attached screens, each of which can be given its own world. The engine
composes every display separately, so a mixed aspect-ratio setup gets correct
framing on each rather than one crop of a wide panorama.

### About

- Version number
- Author credits
- License information

## Hotkeys

The wallpaper never holds keyboard focus, so these are registered with Windows
rather than handled inside the page.

| Hotkey | Action |
|--------|--------|
| `Ctrl+Alt+W` | Next world |
| `Ctrl+Alt+S` | Cycle art style |
| `Ctrl+Alt+P` | Pause / resume |
| `Ctrl+Alt+F` | Toggle field notes |
| `Ctrl+Alt+D` | Toggle debug overlay |

That is the complete list. There is no separate resume hotkey — `Ctrl+Alt+P`
toggles — and screenshot, trigger-event and creator mode are tray and CLI actions.
A wallpaper that claims `Ctrl+Alt+R`, `Ctrl+Alt+T` and `Ctrl+Alt+C` would bind three
combinations that people press by accident, which is a nuisance on a shared
machine. An earlier revision of this document listed exactly those three.

A hotkey already owned by another application is logged and skipped rather than
preventing the engine from starting.

## Interactions

**None of these are implemented.** An earlier version of this section listed hover
and click behaviour for the forest, observatory, cabin, radio tower and moon. The
machinery exists and is wired to the mouse — `InteractionSystem` tracks hover, click
and multi-click, and understands named zones with callbacks — but nothing ever
registers a zone, so there is nothing for it to hit-test against. `EasterEggSystem`
is the same: constructed, with four eggs defined, and never asked to trigger.

The Konami code additionally cannot work as written. It listens for `keydown` on
`window`, and the wallpaper never holds keyboard focus, which `main.ts` says
explicitly a few lines above where it wires the tray events. In the shipped host
that listener cannot fire.

Registering the zones is the whole of the work; the handler side is done. Until it
is, this section stays empty rather than aspirational.

### The Konami code

The sequence is defined in `EasterEggSystem.ts` as
`ArrowUp ArrowUp ArrowDown ArrowDown ArrowLeft ArrowRight ArrowLeft ArrowRight b a`.

It needs a route to reach the engine, since keyboard input does not arrive. The
global hotkeys the host already registers are the obvious candidate — the host
proves it can observe a key combination that the page never sees.

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
