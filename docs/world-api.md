# World API

## Overview

Worlds interact with the engine through a small, stable API exposed as the
`world` global object.

## API Reference

### Events

```typescript
world.on('event', (event: AnomalyEvent) => { ... });
world.emit(event: AnomalyEvent): void;
```

### Entities

```typescript
world.spawn(entity: EntityDefinition): Entity;
world.remove(entityId: string): void;
```

### Scene

```typescript
world.scene(name: string): void;
```

### Random

```typescript
world.random(): number;
world.random(seed: number): number;
```

### Time

```typescript
world.time(): Date;
world.time(hour: number, minute: number): void;
```

### Weather

```typescript
world.weather(): WeatherState;
```

### Audio

```typescript
world.audio.play(soundId: string): void;
world.audio.stop(soundId: string): void;
world.audio.setVolume(volume: number): void;
```

### Storage

```typescript
world.storage.get(key: string): Promise<string | null>;
world.storage.set(key: string, value: string): Promise<void>;
```

### Secrets

```typescript
world.secrets.unlock(secretId: string): void;
world.secrets.isUnlocked(secretId: string): boolean;
```

## Example

```typescript
world.on('time.midnight', () => {
  world.spawn({
    type: 'creature',
    sprite: 'deer',
    x: 0.5,
    y: 0.7,
    behavior: 'patrol',
  });
});

world.on('random.meteor', () => {
  world.audio.play('shooting_star');
});
```
