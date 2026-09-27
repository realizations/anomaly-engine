# Event System

## Overview

Everything in Anomaly Engine is an event. Time changes, weather updates,
system state changes, user interactions — all become events that flow through
the EventBus.

## Event Structure

```typescript
interface AnomalyEvent {
  id: string;
  type: string;
  timestamp: number;
  source: string;
  payload: Record<string, unknown>;
  priority: 'low' | 'normal' | 'high' | 'critical';
  rarity: 'common' | 'uncommon' | 'rare' | 'very_rare' | 'legendary';
  cooldown: number;
  duration: number;
  targetScene: string;
  seed: number;
  metadata: Record<string, unknown>;
}
```

## Event Types

### Time Events
- `time.hourly` — fires every hour
- `time.midnight` — fires at 00:00
- `time.0333` — fires at 03:33 (rare)
- `time.sunrise` / `time.sunset` — fires at dawn/dusk

### Random Events
- `random.meteor` — shooting star
- `random.bird_flyby` — birds cross the sky
- `random.forest_creature` — creature in the forest
- `random.second_moon` — very rare, second moon appears

### System Events
- `system.startup` / `system.shutdown`
- `system.sleep` / `system.wake`
- `system.fullscreen` / `system.windowed`
- `system.battery` / `system.ac`

### Weather Events
- `weather.rain_started` / `weather.rain_stopped`
- `weather.storm_started` / `weather.storm_stopped`
- `weather.fog_started` / `weather.fog_stopped`

## Rarity System

| Rarity | Weight |
|--------|--------|
| Common | 70% |
| Uncommon | 20% |
| Rare | 8% |
| Very Rare | 1.8% |
| Legendary | 0.2% |

## Cooldowns

Each event has a cooldown (in seconds). The EventBus tracks when each event
type last fired and suppresses duplicates during the cooldown period.

## Subscribing

```typescript
bus.subscribe('random.meteor', (event) => {
  console.log('A meteor!', event.payload);
});
```

## Emitting

```typescript
bus.emit({
  id: 'my_event',
  type: 'custom.event',
  timestamp: Date.now(),
  source: 'my-source',
  payload: { key: 'value' },
  priority: 'normal',
  rarity: 'common',
  cooldown: 60,
  duration: 10,
  targetScene: 'main',
  seed: Date.now(),
  metadata: {},
});
```
