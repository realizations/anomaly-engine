# Event System

## Overview

Time passing and the random things that happen are events, and they flow through
the EventBus to whatever wants to notice them. Two claims in an earlier revision of
this overview did not hold: weather updates and system state changes are not events.
Weather is state the renderer reads, and the host does not put system state on the
bus at all. What follows is the surface that exists.

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

Every type the engine can emit, checked against the sources rather than remembered.
An earlier revision of this file listed `time.sunrise`, `time.sunset`, the six
`system.*` pairs and six `weather.*_started` types. None of them exist: the clock
source emits three events, the host sends two commands, and weather is modelled as
state rather than as transitions.

### Time Events — `ClockSource`

| Type | When |
|------|------|
| `time.hourly` | Every hour, with the hour and its period in the payload |
| `time.0333` | At 03:33. Rare, high priority, 30 seconds long |
| `time.midnight` | At 00:00 |

### Random Events — `RandomSource`

Eleven types, weighted by rarity and each with its own cooldown:

| Type | Rarity | Cooldown |
|------|--------|----------|
| `random.cloud_shift` | common | 5 min |
| `random.bird_flyby` | common | 10 min |
| `random.leaves_blow` | common | 5 min |
| `random.distant_light` | uncommon | 30 min |
| `random.radio_static` | uncommon | 1 hour |
| `random.meteor` | rare | 2 hours |
| `random.observatory_flash` | rare | 4 hours |
| `random.lights_out` | rare | 4 hours |
| `random.second_moon` | very rare | 24 hours |
| `random.forest_creature` | very rare | 12 hours |
| `random.red_moon` | legendary | 7 days |

`RANDOM_EVENT_TYPES` is exported from `src/events/RandomSource.ts`, so a test can
assert against this list rather than a copy of it.

### Weather

Weather is not a set of events. It is state the engine reads — `weather.condition`,
`weather.rain`, `weather.windSpeed` — and a transition is something to notice
rather than something to subscribe to. The moments in `MomentSystem` are the
mechanism for that, and they name a real event type as the thing to watch for.

### System

The native host does not put system events on the bus. Across the bridge it sends
exactly two messages, `pause` and `resume`. Fullscreen detection, sleep and battery
state are handled by the host and affect whether the renderer runs at all, rather
than becoming events the renderer reasons about.

## Subscribing

```typescript
const off = bus.subscribe('random.meteor', (event) => {
  console.log('A meteor!', event.payload);
});
off(); // subscribe returns its own unsubscribe
```

Handlers are called in descending priority order, and a handler that throws is
logged and does not stop the ones after it. Subscribing to `'*'` receives every
event regardless of type.

## Rarity System

The weights used to choose an event at random, in `RandomSource`:

| Rarity | Weight |
|--------|--------|
| Common | 70% |
| Uncommon | 20% |
| Rare | 8% |
| Very Rare | 1.8% |
| Legendary | 0.2% |

## Cooldowns

Every event carries a cooldown in seconds. The bus records the time an event type
last fired and drops a repeat of the same type until the cooldown has passed, so
cooldowns hold however many sources emit the same type.

The last thousand events are retained, and `getHistory(limit)` reads back from them.

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
