export type DiscoveryState = 'unknown' | 'observed' | 'discovered' | 'solved';

export interface JournalEntry {
  id: string;
  timestamp: number;
  anomalyId: string;
  anomalyName: string;
  rarity: string;
  location: string;
  notes: string;
  screenshot?: string;
  state: DiscoveryState;
  clues: string[];
}

export interface JournalState {
  entries: JournalEntry[];
  totalObserved: number;
  totalSolved: number;
}

export class JournalSystem {
  private _entries: JournalEntry[] = [];
  private _listeners: ((entry: JournalEntry) => void)[] = [];
  private _stateListeners: ((state: JournalState) => void)[] = [];

  addEntry(entry: JournalEntry): void {
    this._entries.unshift(entry);
    this._notify();
    this._listeners.forEach(fn => fn(entry));
  }

  updateEntry(id: string, updates: Partial<JournalEntry>): void {
    const entry = this._entries.find(e => e.id === id);
    if (!entry) return;
    Object.assign(entry, updates);
    this._notify();
  }

  getEntries(): JournalEntry[] {
    return [...this._entries];
  }

  getEntry(id: string): JournalEntry | undefined {
    return this._entries.find(e => e.id === id);
  }

  getState(): JournalState {
    return {
      entries: [...this._entries],
      totalObserved: this._entries.length,
      totalSolved: this._entries.filter(e => e.state === 'solved').length,
    };
  }

  exportToMarkdown(): string {
    const lines = ['# Anomaly Journal', ''];
    for (const entry of this._entries) {
      lines.push(`## ${entry.anomalyName}`);
      lines.push(`- **Date:** ${new Date(entry.timestamp).toLocaleString()}`);
      lines.push(`- **Rarity:** ${entry.rarity}`);
      lines.push(`- **Location:** ${entry.location}`);
      lines.push(`- **State:** ${entry.state}`);
      if (entry.notes) lines.push(`- **Notes:** ${entry.notes}`);
      if (entry.clues.length > 0) lines.push(`- **Clues:** ${entry.clues.join(', ')}`);
      lines.push('');
    }
    return lines.join('\n');
  }

  exportToJSON(): string {
    return JSON.stringify(this._entries, null, 2);
  }

  /**
   * Rehydrates entries from durable state. Entries that no longer parse are
   * dropped rather than poisoning the journal, because a corrupt save must not
   * be able to break the engine on every subsequent launch.
   */
  restore(entries: ReadonlyArray<Record<string, unknown>>): void {
    const ok: JournalEntry[] = [];
    for (const e of entries) {
      if (!e || typeof e.id !== 'string' || typeof e.timestamp !== 'number') continue;
      const state = e.state;
      ok.push({
        id: e.id,
        timestamp: e.timestamp,
        anomalyId: typeof e.anomalyId === 'string' ? e.anomalyId : 'unknown',
        anomalyName: typeof e.anomalyName === 'string' ? e.anomalyName : 'Unknown',
        rarity: typeof e.rarity === 'string' ? e.rarity : 'rare',
        location: typeof e.location === 'string' ? e.location : 'unknown',
        notes: typeof e.notes === 'string' ? e.notes : '',
        state: state === 'discovered' || state === 'solved' ? state : 'observed',
        clues: Array.isArray(e.clues) ? e.clues.filter((c): c is string => typeof c === 'string') : [],
      });
    }
    this._entries = ok.sort((a, b) => a.timestamp - b.timestamp);
    this._notify();
  }

  onEntry(listener: (entry: JournalEntry) => void): () => void {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  }

  onStateChange(listener: (state: JournalState) => void): () => void {
    this._stateListeners.push(listener);
    return () => {
      const idx = this._stateListeners.indexOf(listener);
      if (idx >= 0) this._stateListeners.splice(idx, 1);
    };
  }

  private _notify(): void {
    const state = this.getState();
    this._stateListeners.forEach(fn => fn(state));
  }

  dispose(): void {
    this._listeners = [];
    this._stateListeners = [];
  }
}
