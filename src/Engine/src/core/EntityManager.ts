export type EntityType = 'sprite' | 'particle' | 'light' | 'creature' | 'object';

export type EntityBehavior = 'idle' | 'patrol' | 'flee' | 'appear' | 'disappear' | 'follow' | 'watch';

export interface EntityDefinition {
  type: EntityType;
  sprite?: string;
  x: number;
  y: number;
  scale?: number;
  behavior?: EntityBehavior;
  duration?: number;
  layer?: number;
  opacity?: number;
  speed?: number;
  direction?: number;
  metadata?: Record<string, unknown>;
}

export interface Entity {
  id: string;
  definition: EntityDefinition;
  createdAt: number;
  expiresAt: number | null;
  state: 'active' | 'paused' | 'removing';
  currentX: number;
  currentY: number;
  currentOpacity: number;
  currentScale: number;
  velocity: { x: number; y: number };
  age: number;
}

export class EntityManager {
  private _entities: Map<string, Entity> = new Map();
  private _idCounter = 0;
  private _layers: Map<number, Entity[]> = new Map();

  spawn(definition: EntityDefinition): Entity {
    const id = `entity_${++this._idCounter}`;
    const entity: Entity = {
      id,
      definition,
      createdAt: Date.now(),
      expiresAt: definition.duration ? Date.now() + definition.duration * 1000 : null,
      state: 'active',
      currentX: definition.x,
      currentY: definition.y,
      currentOpacity: definition.opacity ?? 1,
      currentScale: definition.scale ?? 1,
      velocity: this._computeVelocity(definition),
      age: 0,
    };

    this._entities.set(id, entity);
    this._addToLayer(entity);
    return entity;
  }

  remove(id: string): void {
    const entity = this._entities.get(id);
    if (!entity) return;
    entity.state = 'removing';
    this._entities.delete(id);
    this._removeFromLayer(entity);
  }

  update(deltaMs: number): void {
    const deltaSec = deltaMs / 1000;
    for (const entity of this._entities.values()) {
      entity.age += deltaMs;

      if (entity.expiresAt !== null && entity.age >= (entity.expiresAt - entity.createdAt)) {
        this.remove(entity.id);
        continue;
      }

      if (entity.state !== 'active') continue;

      this._updateBehavior(entity, deltaSec);
    }
  }

  private _updateBehavior(entity: Entity, deltaSec: number): void {
    const def = entity.definition;

    switch (def.behavior) {
      case 'patrol':
        entity.currentX += entity.velocity.x * deltaSec;
        entity.currentY += entity.velocity.y * deltaSec;
        if (entity.currentX < 0 || entity.currentX > 1) entity.velocity.x *= -1;
        if (entity.currentY < 0 || entity.currentY > 1) entity.velocity.y *= -1;
        break;
      case 'follow':
        break;
      case 'flee':
        entity.currentX += entity.velocity.x * deltaSec;
        entity.currentY += entity.velocity.y * deltaSec;
        entity.currentOpacity = Math.max(0, entity.currentOpacity - deltaSec * 0.5);
        if (entity.currentOpacity <= 0) this.remove(entity.id);
        break;
      case 'appear':
        entity.currentOpacity = Math.min(1, entity.currentOpacity + deltaSec * 0.5);
        break;
      case 'disappear':
        entity.currentOpacity = Math.max(0, entity.currentOpacity - deltaSec * 0.5);
        if (entity.currentOpacity <= 0) this.remove(entity.id);
        break;
    }
  }

  private _computeVelocity(def: EntityDefinition): { x: number; y: number } {
    const speed = def.speed ?? 0.1;
    const direction = def.direction ?? 0;
    return {
      x: Math.cos(direction) * speed,
      y: Math.sin(direction) * speed,
    };
  }

  private _addToLayer(entity: Entity): void {
    const layer = entity.definition.layer ?? 0;
    const entities = this._layers.get(layer) ?? [];
    entities.push(entity);
    this._layers.set(layer, entities);
  }

  private _removeFromLayer(entity: Entity): void {
    const layer = entity.definition.layer ?? 0;
    const entities = this._layers.get(layer);
    if (!entities) return;
    const idx = entities.findIndex(e => e.id === entity.id);
    if (idx >= 0) entities.splice(idx, 1);
  }

  getEntities(layer?: number): Entity[] {
    if (layer !== undefined) {
      return this._layers.get(layer) ?? [];
    }
    return Array.from(this._entities.values());
  }

  getEntity(id: string): Entity | undefined {
    return this._entities.get(id);
  }

  clear(): void {
    this._entities.clear();
    this._layers.clear();
  }

  pause(): void {
    for (const entity of this._entities.values()) {
      entity.state = 'paused';
    }
  }

  resume(): void {
    for (const entity of this._entities.values()) {
      entity.state = 'active';
    }
  }
}
