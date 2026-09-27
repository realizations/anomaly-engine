# World Format

## Overview

A world is a directory containing a manifest, scenes, assets, events, and lore.
Worlds can be packaged as `.world` files (ZIP archives) for distribution.

## Directory Structure

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

## Manifest

```json
{
  "id": "my-world",
  "name": "My World",
  "author": "Author Name",
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
      "file": "scenes/main.html",
      "description": "Main scene"
    }
  ]
}
```

## Validation

Worlds are validated before loading:

- Manifest schema check
- Required files exist
- Asset type validation
- Path traversal protection
- File size limits

## Installation

Worlds can be installed from:

- Local `.world` file
- Local folder
- Drag-and-drop
- GitHub release
- URL (HTTPS only)

## Security

- Worlds run in a sandboxed environment
- No arbitrary code execution
- No native API access
- All network requests go through the engine
