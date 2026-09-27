# Getting Started

## Prerequisites

- Windows 10/11
- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
- [Node.js 20+](https://nodejs.org/)
- [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (pre-installed on Windows 11)

## Build

```bash
# Build the web renderer
cd src/Engine
npm install
npm run build

# Build the native host
cd ../AnomalyEngine
dotnet build
```

## Run

```bash
cd src/AnomalyEngine
dotnet run
```

The engine will attach to your desktop and render the default world.

## CLI

```bash
# List installed worlds
livingwall world list

# Install a world
livingwall world install path/to/world.world

# Validate a world package
livingwall world validate path/to/world.world

# Trigger an event manually
livingwall event trigger meteor-shower

# Take a screenshot
livingwall screenshot
```

## First Run

On first launch, the engine will:

1. Detect your monitors
2. Load the default world ("The Town That Wasn't There")
3. Attach the renderer behind your desktop icons
4. Show a tray icon in the system tray

Right-click the tray icon for options.
