export interface SecretDefinition {
  id: string;
  name: string;
  description: string;
  hints: string[];
  clues: string[];
  relatedAnomalies: string[];
}

export interface DiscoveredSecret {
  definition: SecretDefinition;
  discoveredAt: number;
  state: 'observed' | 'discovered' | 'solved';
  notes: string;
}

export const BUILTIN_SECRETS: SecretDefinition[] = [
  {
    id: 'observatory-signal',
    name: 'The Observatory Signal',
    description: 'A signal that the observatory sends into the void.',
    hints: ['Watch the observatory at night.', 'The light is not random.'],
    clues: ['73.4', 'midnight', 'third night'],
    relatedAnomalies: ['observatory-signal'],
  },
  {
    id: 'forest-watcher',
    name: 'The Watcher',
    description: 'Something lives in the pines that should not exist.',
    hints: ['Look at the tree line.', 'It only appears when the moon is right.'],
    clues: ['full moon', 'tree line', 'movement'],
    relatedAnomalies: ['forest-watcher'],
  },
  {
    id: 'red-moon-clue',
    name: 'The Red Moon Equation',
    description: 'A mathematical relationship hidden in the lunar cycle.',
    hints: ['The red moon is not an anomaly.', 'It is a message.'],
    clues: ['29.53', 'phase', 'equation'],
    relatedAnomalies: ['red-moon'],
  },
  {
    id: 'hidden-room',
    name: 'The Room Behind the Wall',
    description: 'A space that exists between the trees and the stars.',
    hints: ['Coordinates hidden in the constellation.', 'Look where the stars align.'],
    clues: ['42.3', '-122.7', 'alignment'],
    relatedAnomalies: ['constellation-shift'],
  },
  {
    id: 'time-loop',
    name: 'The Time Loop',
    description: 'The town remembers what has not happened yet.',
    hints: ['3:33 is not the only time.', 'The clock runs backward.'],
    clues: ['0333', 'backward', 'loop'],
    relatedAnomalies: ['time-0333'],
  },
];

export class SecretSystem {
  private _discovered: Map<string, DiscoveredSecret> = new Map();
  private _listeners: ((secret: DiscoveredSecret) => void)[] = [];

  discover(secretId: string, notes = ''): boolean {
    if (this._discovered.has(secretId)) return false;

    const definition = BUILTIN_SECRETS.find(s => s.id === secretId);
    if (!definition) return false;

    const discovered: DiscoveredSecret = {
      definition,
      discoveredAt: Date.now(),
      state: 'discovered',
      notes,
    };

    this._discovered.set(secretId, discovered);
    this._listeners.forEach(fn => fn(discovered));
    return true;
  }

  observe(secretId: string): boolean {
    const existing = this._discovered.get(secretId);
    if (existing) return false;

    const definition = BUILTIN_SECRETS.find(s => s.id === secretId);
    if (!definition) return false;

    const discovered: DiscoveredSecret = {
      definition,
      discoveredAt: Date.now(),
      state: 'observed',
      notes: '',
    };

    this._discovered.set(secretId, discovered);
    this._listeners.forEach(fn => fn(discovered));
    return true;
  }

  solve(secretId: string, notes = ''): boolean {
    const existing = this._discovered.get(secretId);
    if (!existing) return false;
    existing.state = 'solved';
    existing.notes = notes;
    this._listeners.forEach(fn => fn(existing));
    return true;
  }

  isDiscovered(secretId: string): boolean {
    return this._discovered.has(secretId);
  }

  getSecret(secretId: string): DiscoveredSecret | undefined {
    return this._discovered.get(secretId);
  }

  getDiscovered(): DiscoveredSecret[] {
    return Array.from(this._discovered.values());
  }

  getDefinitions(): SecretDefinition[] {
    return [...BUILTIN_SECRETS];
  }

  getProgress(): { discovered: number; total: number; percentage: number } {
    return {
      discovered: this._discovered.size,
      total: BUILTIN_SECRETS.length,
      percentage: (this._discovered.size / BUILTIN_SECRETS.length) * 100,
    };
  }

  onDiscover(listener: (secret: DiscoveredSecret) => void): () => void {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  }

  dispose(): void {
    this._listeners = [];
    this._discovered.clear();
  }
}
