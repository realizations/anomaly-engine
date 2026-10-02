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
import { clamp01 } from '../renderer/motion.js';

export interface PersistedState {
  version: number;
  worldId: string | null;
  style: string | null;
  reducedMotion: boolean | null;
  /**
   * How much of the scene moves, 0..1.
   *
   * Kept separate from reducedMotion, which is an accessibility preference rather
   * than a taste one. Reduced motion lowers this; it does not replace it, because a
   * completely frozen wallpaper reads as a screenshot rather than as calm.
   */
  motionIntensity: number | null;
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
  /**
   * Worlds the user imported, stored as the definitions they supplied.
   *
   * Definitions are kept rather than ids, because an id alone cannot rebuild a
   * world on the next launch. They are validated again on load, exactly as if
   * they had just been imported: the state file is as much untrusted input as a
   * pasted world is, and it is written somewhere a user can edit.
   */
  customWorlds: unknown[];
  /**
   * Digest of each imported world, keyed by world id.
   *
   * Recorded when a world is first imported and recomputed every time it is
   * restored, so a world edited between sessions is reported rather than
   * quietly accepted. See worlds/digest.ts for why this is a checksum and not a
   * cryptographic hash, and why a mismatch warns instead of rejecting.
   */
  worldDigests: Record<string, string>;
  /**
   * World chosen for each display, keyed by the display's stable id.
   *
   * Keyed by the host-reported device id rather than by index or by geometry.
   * Both of those are positions rather than identities: Windows reorders the
   * monitor list when the primary display changes, and a monitor moved to another
   * port changes its rectangle, so a setting stored either way would drift onto
   * the wrong screen. Ids that no longer match any attached display are dropped
   * on load rather than accumulating.
   */
  displayWorlds: Record<string, string>;
}

const VERSION = 1;
const LS_KEY = 'anomaly-engine:state';

/**
 * Ceiling on imported worlds held in the state file.
 *
 * The registry accepts far more than this in one go; this is only a bound on what
 * is written to disk, so that a state file cannot be inflated without limit.
 */
export const MAX_CUSTOM_WORLDS = 200;

/** Ceiling on per-display world assignments held in the state file. */
export const MAX_DISPLAY_ASSIGNMENTS = 16;

export function emptyState(): PersistedState {
  return {
    version: VERSION,
    worldId: null,
    style: null,
    reducedMotion: null,
    motionIntensity: null,
    totalSessions: 0,
    firstRun: null,
    lastSeen: null,
    journal: [],
    secrets: [],
    moments: [],
    customWorlds: [],
    displayWorlds: {},
    worldDigests: {},
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
    motionIntensity: s.motionIntensity === null || s.motionIntensity === undefined
      ? null
      : clamp01(Number(s.motionIntensity)),
    totalSessions: Math.max(0, num(s.totalSessions, 0)),
    firstRun: str(s.firstRun),
    lastSeen: str(s.lastSeen),
    journal: arr<Record<string, unknown>>(s.journal).filter(
      (e) => !!e && typeof e === 'object' && typeof (e as { id?: unknown }).id === 'string'
    ) as PersistedState['journal'],
    secrets: arr<string>(s.secrets).filter((x) => typeof x === 'string'),
    moments: arr<string>(s.moments).filter((x) => typeof x === 'string'),
    // Capped as well as filtered. The file is user-editable, and an unbounded
    // array here would be written back out on every save, so a hand-edited
    // state file could grow without limit and be re-serialised every launch.
    customWorlds: arr<unknown>(s.customWorlds)
      .filter((w) => !!w && typeof w === 'object' && !Array.isArray(w))
      .slice(0, MAX_CUSTOM_WORLDS),
    // Only string-to-string pairs survive. The values are world ids and are
    // re-checked against the registry on load, so a stale or hand-edited id
    // simply falls back to the active world rather than selecting nothing.
    displayWorlds: (() => {
      const src = (s as { displayWorlds?: unknown }).displayWorlds;
      if (!src || typeof src !== 'object' || Array.isArray(src)) return {};
      const out: Record<string, string> = {};
      let n = 0;
      for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
        if (typeof v !== 'string' || !v) continue;
        if (n >= MAX_DISPLAY_ASSIGNMENTS) break;
        out[k] = v;
        n++;
      }
      return out;
    })(),
    worldDigests: (() => {
      const src = (s as { worldDigests?: unknown }).worldDigests;
      if (!src || typeof src !== 'object' || Array.isArray(src)) return {};
      const out: Record<string, string> = {};
      let n = 0;
      for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
        if (typeof v !== 'string' || !v) continue;
        if (n >= MAX_CUSTOM_WORLDS) break;
        out[k] = v;
        n++;
      }
      return out;
    })(),
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

  /**
   * Installs a flush for the moment the engine goes away.
   *
   * Writes are debounced so that a burst of mutations, which is what the engine
   * does every time a world changes, produces one write instead of dozens. The
   * cost is a window in which the newest change is only in memory, and a
   * wallpaper host is exactly the kind of program that gets terminated rather
   * than closed, so anything saved during that window is simply lost. pagehide
   * and visibilitychange are both handled because neither reliably fires on its
   * own: pagehide does not fire on a crash, and visibilitychange is what
   * actually happens when a hosted window is minimised or occluded.
   */
  installFlushOnHide(): void {
    const flush = () => {
      if (this._flushTimer === null) return;
      window.clearTimeout(this._flushTimer);
      this._flushTimer = null;
      this.save();
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
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
