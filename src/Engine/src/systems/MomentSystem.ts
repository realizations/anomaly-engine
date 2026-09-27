export interface MomentDefinition {
  id: string;
  name: string;
  description: string;
  anomalyId: string;
  hints: string[];
}

export interface DiscoveredMoment {
  definition: MomentDefinition;
  discoveredAt: number;
  screenshot: string | null;
  notes: string;
}

export const BUILTIN_MOMENTS: MomentDefinition[] = [
  {
    id: 'first-rain',
    name: 'First Rain',
    description: 'The first time rain touches the town.',
    anomalyId: 'weather.rain',
    hints: ['Watch the sky when the weather changes.'],
  },
  {
    id: 'red-moon',
    name: 'Red Moon',
    description: 'The moon turns red for reasons unknown.',
    anomalyId: 'anomaly.red_moon',
    hints: ['It does not happen every night.', 'Rarity is not a suggestion.'],
  },
  {
    id: 'watcher-in-the-pines',
    name: 'Watcher in the Pines',
    description: 'Something moves between the trees.',
    anomalyId: 'anomaly.forest_watcher',
    hints: ['Look at the tree line.', 'It only appears when it wants to.'],
  },
  {
    id: 'radio-signal',
    name: 'Radio Signal',
    description: 'A signal that should not exist.',
    anomalyId: 'anomaly.radio_signal',
    hints: ['The radio tower is more than it seems.', 'Frequency 73.4.'],
  },
  {
    id: '333',
    name: '3:33',
    description: 'The hour that is not an hour.',
    anomalyId: 'time.0333',
    hints: ['Check the time.', 'Do not blink.'],
  },
  {
    id: 'falling-star',
    name: 'Falling Star',
    description: 'A star falls over the town.',
    anomalyId: 'anomaly.meteor',
    hints: ['Look up.', 'It will not wait.'],
  },
];

export class MomentSystem {
  private _discovered: Map<string, DiscoveredMoment> = new Map();
  private _listeners: ((moment: DiscoveredMoment) => void)[] = [];

  discover(momentId: string, screenshot?: string, notes = ''): boolean {
    if (this._discovered.has(momentId)) return false;

    const definition = BUILTIN_MOMENTS.find(m => m.id === momentId);
    if (!definition) return false;

    const discovered: DiscoveredMoment = {
      definition,
      discoveredAt: Date.now(),
      screenshot: screenshot ?? null,
      notes,
    };

    this._discovered.set(momentId, discovered);
    this._listeners.forEach(fn => fn(discovered));
    return true;
  }

  isDiscovered(momentId: string): boolean {
    return this._discovered.has(momentId);
  }

  getDiscovered(): DiscoveredMoment[] {
    return Array.from(this._discovered.values());
  }

  getDefinition(id: string): MomentDefinition | undefined {
    return BUILTIN_MOMENTS.find(m => m.id === id);
  }

  getAllDefinitions(): MomentDefinition[] {
    return [...BUILTIN_MOMENTS];
  }

  getProgress(): { discovered: number; total: number; percentage: number } {
    return {
      discovered: this._discovered.size,
      total: BUILTIN_MOMENTS.length,
      percentage: (this._discovered.size / BUILTIN_MOMENTS.length) * 100,
    };
  }

  onDiscover(listener: (moment: DiscoveredMoment) => void): () => void {
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
