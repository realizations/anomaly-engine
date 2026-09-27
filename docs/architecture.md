# Architecture

## Overview

Anomaly Engine uses a two-layer architecture:

1. **Native Host (C#)** — manages the Windows desktop integration, WebView2 hosting, system events, and persistence
2. **Web Renderer (TypeScript)** — runs inside WebView2, handles the event system, scene rendering, and world logic

## Communication

The native host and web renderer communicate via WebView2's `postMessage` API:

```
C# → TypeScript: window.chrome.webview.postMessage(...)
TypeScript → C#: window.chrome.webview.postMessage(...)
```

## Event Flow

```
Event Source → EventBus → Event Handlers → Scene Renderer
     ↑                                      ↓
     └────────── User Input ←───────────────┘
```

## Project Structure

```
src/
  AnomalyEngine/    C# native host
    Core/           WallpaperHost, TrayIcon, MonitorManager, etc.
  Engine/           TypeScript engine
    core/           EventBus, EventScheduler, WorldManager
    events/         ClockSource, RandomSource, WeatherSource
    renderer/       DayNightCycle, SceneRenderer
    platform/       NativeBridge, Storage
worlds/             World packages
  the-town-that-wasnt-there/
```

## Threading

- C# host runs on the UI thread (WPF)
- WebView2 runs the web renderer on its own thread
- SQLite operations are async
- Event processing is single-threaded (TypeScript event loop)
