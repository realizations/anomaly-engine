export type AnomalyCategory = 'visual' | 'audio' | 'temporal' | 'behavioral' | 'cosmic';

export type AnomalyState = 'idle' | 'triggering' | 'active' | 'cooldown';

export interface AnomalyDefinition {
  id: string;
  name: string;
  description: string;
  category: AnomalyCategory;
  rarity: 'common' | 'uncommon' | 'rare' | 'very_rare' | 'legendary';
  cooldown: number;
  duration: number;
  prerequisites?: string[];
  conditions?: string[];
  effects: AnomalyEffect[];
}

export interface AnomalyEffect {
  type: 'spawn' | 'light' | 'sound' | 'transform' | 'time' | 'camera';
  target: string;
  params: Record<string, unknown>;
}

export interface ActiveAnomaly {
  definition: AnomalyDefinition;
  startedAt: number;
  expiresAt: number;
  seed: number;
}

export class AnomalySystem {
  private _definitions: Map<string, AnomalyDefinition> = new Map();
  private _active: ActiveAnomaly | null = null;
  private _cooldowns: Map<string, number> = new Map();
  private _prerequisitesMet: Set<string> = new Set();
  private _listeners: ((anomaly: ActiveAnomaly) => void)[] = [];
  private _endListeners: ((anomaly: ActiveAnomaly) => void)[] = [];
  private _timer: number | null = null;

  register(definition: AnomalyDefinition): void {
    this._definitions.set(definition.id, definition);
  }

  unregister(id: string): void {
    this._definitions.delete(id);
  }

  start(): void {
    this._timer = window.setInterval(() => this._checkExpirations(), 1000);
  }

  stop(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  private _checkExpirations(): void {
    if (!this._active) return;
    if (Date.now() >= this._active.expiresAt) {
      const ended = this._active;
      this._active = null;
      this._endListeners.forEach(fn => fn(ended));
    }
  }

  canTrigger(definition: AnomalyDefinition): boolean {
    if (this._active) return false;

    const cooldownEnd = this._cooldowns.get(definition.id);
    if (cooldownEnd && Date.now() < cooldownEnd) return false;

    if (definition.prerequisites) {
      for (const pre of definition.prerequisites) {
        if (!this._prerequisitesMet.has(pre)) return false;
      }
    }

    return true;
  }

  trigger(id: string, seed?: number): boolean {
    const definition = this._definitions.get(id);
    if (!definition) return false;
    if (!this.canTrigger(definition)) return false;

    const now = Date.now();
    const anomaly: ActiveAnomaly = {
      definition,
      startedAt: now,
      expiresAt: now + definition.duration * 1000,
      seed: seed ?? now,
    };

    this._active = anomaly;
    this._cooldowns.set(id, now + definition.cooldown * 1000);

    this._listeners.forEach(fn => fn(anomaly));
    return true;
  }

  markPrerequisiteMet(prerequisite: string): void {
    this._prerequisitesMet.add(prerequisite);
  }

  getActiveAnomaly(): ActiveAnomaly | null {
    return this._active;
  }

  getDefinitions(): AnomalyDefinition[] {
    return Array.from(this._definitions.values());
  }

  onTrigger(listener: (anomaly: ActiveAnomaly) => void): () => void {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  }

  onEnd(listener: (anomaly: ActiveAnomaly) => void): () => void {
    this._endListeners.push(listener);
    return () => {
      const idx = this._endListeners.indexOf(listener);
      if (idx >= 0) this._endListeners.splice(idx, 1);
    };
  }

  dispose(): void {
    this.stop();
    this._listeners = [];
    this._endListeners = [];
    this._definitions.clear();
    this._cooldowns.clear();
    this._prerequisitesMet.clear();
  }
}
