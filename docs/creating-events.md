# Creating Events

## Overview

Events can be defined declaratively (JSON) or programmatically (TypeScript).

## Declarative Events

```json
{
  "id": "forest-shadow",
  "trigger": "time.after-midnight",
  "rarity": "rare",
  "cooldown": 86400,
  "duration": 12,
  "conditions": [
    "weather != storm",
    "moon.phase != new"
  ],
  "effects": [
    "spawn.shadow",
    "play.sound",
    "lights.flicker"
  ]
}
```

### Trigger Types

| Trigger | Description |
|---------|-------------|
| `time.at` | Specific time (HH:MM) |
| `time.after` | After specific time |
| `time.before` | Before specific time |
| `time.range` | Between two times |
| `random` | Random interval |
| `system` | System event |

### Conditions

Conditions are evaluated before the event fires:

- `weather != storm` — weather is not storm
- `moon.phase == full` — moon is full
- `time.night` — it is nighttime
- `system.battery` — on battery power

## Programmatic Events

```typescript
world.on('time.midnight', () => {
  if (world.weather().condition === 'clear') {
    world.spawn({
      type: 'anomaly',
      sprite: 'shadow',
      x: 0.3,
      y: 0.6,
      duration: 12000,
    });
  }
});
```

## Effect Types

| Effect | Description |
|--------|-------------|
| `spawn.sprite` | Spawn a sprite entity |
| `spawn.particle` | Spawn particles |
| `spawn.creature` | Spawn a creature |
| `play.sound` | Play a sound |
| `lights.flicker` | Flicker lights |
| `lights.turn_on` | Turn on lights |
| `lights.turn_off` | Turn off lights |
| `camera.shake` | Shake the camera |
| `time.freeze` | Freeze time briefly |
