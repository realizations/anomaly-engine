# Getting Started

## What is Anomaly Engine?

Anomaly Engine is a live wallpaper engine for Windows. It renders a living world behind your desktop icons. The world changes with time, weather, and events. Sometimes strange things happen.

## Quick Start

### 1. Install Prerequisites

- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
- [Node.js 20+](https://nodejs.org/)
- [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (pre-installed on Windows 11)

### 2. Clone and Build

```bash
git clone https://github.com/realizations/anomaly-engine.git
cd anomaly-engine

cd src/Engine
npm install
npm run build

cd ../AnomalyEngine
dotnet build
```

### 3. Run

```bash
cd src/AnomalyEngine
dotnet run
```

### 4. Enjoy

The world will appear behind your desktop icons. Watch it change throughout the day.

## Next Steps

- Read the [How to Use](how-to-use.md) guide
- Explore the [Settings](how-to-use.md#settings)
- Discover your first [Anomaly](how-to-use.md#anomalies)
- Start [Contributing](../CONTRIBUTING.md)

## First World

**The Town That Wasn't There** is the default world. It features:

- A cozy cabin with glowing windows
- An abandoned observatory
- A radio tower with a blinking beacon
- A pine forest
- Distant mountains
- A mysterious moon

The world changes throughout the day:

| Time | What Happens |
|------|-------------|
| Dawn | Soft light, fog, birds |
| Morning | Clear sky, clouds move |
| Day | Bright light, wildlife |
| Dusk | Orange sky, windows light up |
| Night | Stars, moon, fireflies |
| Late Night | Quiet, rare events |
| 3:33 | Something might happen |

## Tips

- **Be patient.** Rare events are rare.
- **Watch closely.** Some events last only seconds.
- **Interact.** Hover and click things.
- **Check the journal.** It remembers what you've seen.
- **Try the Konami code.** You know the one.

## Need Help?

- [How to Use](how-to-use.md) — Full usage guide
- [Contributing](../CONTRIBUTING.md) — How to contribute
- [Issues](https://github.com/realizations/anomaly-engine/issues) — Bug reports and feature requests
- [Discussions](https://github.com/realizations/anomaly-engine/discussions) — General questions
