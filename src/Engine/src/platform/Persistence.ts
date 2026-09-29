/**
 * Durable state.
 *
 * better-sqlite3 does not load reliably inside WebView2, so persistence goes
 * through the native host to a JSON file in %APPDATA%. The data set is small
 * (selected world, style, journal, discovered secrets), so a document store is
 * the right tool and a database would be overkill.
 *
 * When no host is present the module falls back to localStorage, so the engine
 * still persists when run in a plain browser during development.
 */
import type { NativeBridge } from './NativeBridge.js';

export interface PersistedState {
  version: number;
  worldId: string | null;
  style: string | null;
  reducedMotion: boolean | null;
  totalSessions: number;
  firstRun: string | null;
  lastSeen: string | null;
  journal: Array<{
    id: string;
    timestamp: number;
    anomalyId: string;
    anomalyName: string;
    rarity: string;
    location: string;
    notes: string;
    state: string;
    clues: string[];
  }>;
  secrets: string[];
  moments: string[];
}

const VERSION = 1;
const LS_KEY = 'anomaly-engine:state';

export function emptyState(): PersistedState {
  return {
    version: VERSION,
    worldId: null,
    style: null,
    reducedMotion: null,
    totalSessions: 0,
    firstRun: null,
    lastSeen: null,
    journal: [],
    secrets: [],
    moments: [],
  };
}

/** Merges stored state over defaults, discarding anything of the wrong shape. */
export function reconcile(raw: unknown): PersistedState {
  const base = emptyState();
  if (!raw || typeof raw !== 'object') return base;
  const s = raw as Partial<PersistedState>;

  const str = (v: unknown): string | null => (typeof v === 'string' && v.length ? v : null);
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

  return {
    version: VERSION,
    worldId: str(s.worldId),
    style: str(s.style),
    reducedMotion: bool(s.reducedMotion),
    totalSessions: Math.max(0, num(s.totalSessions, 0)),
    firstRun: str(s.firstRun),
    lastSeen: str(s.lastSeen),
    journal: arr<Record<string, unknown>>(s.journal).filter(
      (e) => !!e && typeof e === 'object' && typeof (e as { id?: unknown }).id === 'string'
    ) as PersistedState['journal'],
    secrets: arr<string>(s.secrets).filter((x) => typeof x === 'string'),
    moments: arr<string>(s.moments).filter((x) => typeof x === 'string'),
  };
}

export class Persistence {
  private _bridge: NativeBridge | null;
  private _state: PersistedState = emptyState();
  private _loaded = false;
  /** The previous session's end time, captured before load() overwrites it. */
  private _previousSeen: string | null = null;

  /** The last time the engine was running before this session, or null on a
   *  first run. Drives the "while you were away" summary. */
  getPreviousSeen(): string | null {
    return this._previousSeen;
  }
  private _flushTimer: number | null = null;

  constructor(bridge: NativeBridge | null) {
    this._bridge = bridge;
  }

  isLoaded(): boolean {
    return this._loaded;
  }

  get(): Readonly<PersistedState> {
    return this._state;
  }

  /**
   * Loads durable state. Under the host the native side pushes the document in
   * on navigation complete; in a plain browser we read localStorage directly.
   */
  load(): PersistedState {
    if (this._loaded) return this._state;
    this._state = reconcile(this._readFallback());
    this._state.totalSessions += 1;
    const now = new Date().toISOString();
    this._state.firstRun = this._state.firstRun ?? now;
    // The last time the engine was running, before this session overwrites it.
    // The return summary is measured against this, and once lastSeen is
    // stamped with now the original is gone.
    this._previousSeen = this._state.lastSeen;
    this._state.lastSeen = now;
    this._loaded = true;
    this._writeFallback(this._state);
    // Push immediately so the host creates its file on first run, even before
    // anything changes. Otherwise the state file only appears after a mutation
    // and a fresh install looks like it lost its session.
    this._bridge?.send('state:save', { state: this._state as unknown as Record<string, unknown> });
    return this._state;
  }

  /** Accepts a state document pushed from the native host. */
  acceptFromHost(raw: unknown): void {
    const incoming = reconcile(raw);
    // The host copy is authoritative, but a session that started before the
    // push must not lose its own session count.
    incoming.totalSessions = Math.max(incoming.totalSessions, this._state.totalSessions);
    this._state = incoming;
    this._loaded = true;
  }

  update(patch: Partial<PersistedState>): void {
    this._state = reconcile({ ...this._state, ...patch });
    this.scheduleSave();
  }

  addJournalEntry(entry: PersistedState['journal'][number]): void {
    // Bound the journal so a long-lived install cannot grow without limit.
    const journal = [...this._state.journal.filter((e) => e.id !== entry.id), entry];
    if (journal.length > 200) journal.splice(0, journal.length - 200);
    this._state = { ...this._state, journal };
    this.scheduleSave();
  }

  discover(kind: 'secrets' | 'moments', id: string): boolean {
    const list = this._state[kind];
    if (list.includes(id)) return false;
    this._state = { ...this._state, [kind]: [...list, id] };
    this.scheduleSave();
    return true;
  }

  private scheduleSave(): void {
    if (this._flushTimer !== null) return;
    this._flushTimer = window.setTimeout(() => {
      this._flushTimer = null;
      this.save();
    }, 1500);
  }

  save(): void {
    this._writeFallback(this._state);
    this._bridge?.send('state:save', { state: this._state as unknown as Record<string, unknown> });
  }

  private _readFallback(): unknown {
    try {
      const raw = window.localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      // A blocked or corrupt store must not stop the engine from starting.
      return null;
    }
  }

  private _writeFallback(state: PersistedState): void {
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch {
      // Quota or a disabled store: the host copy is still authoritative.
    }
  }
}
