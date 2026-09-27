# Creating a World

## Overview

This tutorial walks you through creating a simple world for Anomaly Engine.

## 1. Create the Directory Structure

```
my-world/
  manifest.json
  scenes/
    main.html
  assets/
  events/
  lore/
```

## 2. Write the Manifest

```json
{
  "id": "my-world",
  "name": "My World",
  "author": "Your Name",
  "version": "1.0.0",
  "engine": ">=0.1.0",
  "entryScene": "main",
  "description": "A simple world",
  "features": {
    "weather": false,
    "astronomy": false,
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

## 3. Create the Scene

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; }
    body { background: #1a1a2e; }
    canvas { display: block; }
  </style>
</head>
<body>
  <canvas id="scene"></canvas>
  <script>
    const canvas = document.getElementById('scene');
    const ctx = canvas.getContext('2d');

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    function render() {
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      requestAnimationFrame(render);
    }
    render();
  </script>
</body>
</html>
```

## 4. Add Events (Optional)

Create `events/definitions.json`:

```json
{
  "events": [
    {
      "id": "my-event",
      "trigger": "random",
      "rarity": "uncommon",
      "cooldown": 3600,
      "duration": 10,
      "effects": ["spawn.particle"]
    }
  ]
}
```

## 5. Validate

```bash
livingwall world validate my-world/
```

## 6. Package

```bash
# From the parent directory of my-world/
zip -r my-world.world my-world/
```

## 7. Install

```bash
livingwall world install my-world.world
```
