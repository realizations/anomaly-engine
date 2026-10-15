# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Event feed integration end to end: add an RSS, Atom or JSON feed, map words in a
  headline onto one of the registered effects, and see which rule a sample headline
  would match before enabling anything.
- One effect registry (`anomalies/effects.ts`) as the single source of truth for what
  a feed can cause, what the renderer can draw, and what the rule editor offers.
- An anomaly archive and a "show in the world" preview, both read from that registry.
- Feed health on each card: last check, items seen, rules matched, last error.
- Initial project structure
- C# native wallpaper host with WebView2 and WorkerW injection
- TypeScript event bus with priorities, cooldowns, and rarity system
- Clock event source with day/night cycle
- Random event source with weighted rarity
- First world: "The Town That Wasn't There" (basic scene)
- System tray with pause/resume
- Monitor management
- Power management (sleep/wake/battery)
- Fullscreen detection
- Durable state as JSON in %APPDATA%, owned by the native host

### Fixed
- The motion level slider no longer resets itself to "still". The status document did
  not carry `motionIntensity`, so the one-second poll read the missing field as zero
  and wrote it straight back over the slider, making the control inert. The slider now
  shows the level you chose, the scene runs at whatever the reduced-motion cap allows,
  and a note appears when those two differ.
- The settings window paints its own background, so each page renders on the dark
  surface it was designed for rather than on white.
- Text boxes are themed. The URL field, the rule matcher and the headline tester were
  the last controls still using default Windows chrome, and the only bright elements
  on the page.
