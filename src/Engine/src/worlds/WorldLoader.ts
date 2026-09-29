import { BUILT_IN_WORLDS } from './registry.js';
import { validateWorld, type WorldDefinition, type WorldValidation } from './types.js';

/**
 * Loads and manages worlds.
 *
 * Built-in worlds are bundled rather than fetched, because the native host serves
 * the renderer from file:// where Chromium blocks fetch() of local files. Worlds
 * installed by the user can be supplied by the host as JSON over the native
 * bridge, or fetched when the renderer is served over http during development.
 */
export class WorldLoader {
  private _worlds = new Map<string, WorldDefinition>();
  private _activeId: string | null = null;
  private _listeners: Array<(id: string | null) => void> = [];

  constructor() {
    for (const w of BUILT_IN_WORLDS) {
      const v = validateWorld(w);
      if (!v.valid) {
        // A malformed built-in world is a programming error, not user input.
        throw new Error(`Built-in world "${w.id}" is invalid: ${v.errors.join('; ')}`);
      }
      this._worlds.set(w.id, w);
    }
  }

  /** Validates and registers an externally supplied world definition. */
  register(input: unknown): WorldValidation {
    const v = validateWorld(input);
    if (!v.valid) return v;
    const world = input as WorldDefinition;
    this._worlds.set(world.id, world);
    return v;
  }

  /**
   * Fetches a world.json over http. Only usable when the renderer is served from
   * a web server; file:// blocks this. Returns the validation result so callers
   * can surface problems instead of silently falling back.
   */
  async loadFromUrl(url: string): Promise<WorldValidation> {
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        return { valid: false, errors: [`HTTP ${resp.status} fetching ${url}`], warnings: [] };
      }
      return this.register(await resp.json());
    } catch (err) {
      return {
        valid: false,
        errors: [`Failed to load ${url}: ${err instanceof Error ? err.message : String(err)}`],
        warnings: [],
      };
    }
  }

  /**
   * Accepts a list of world definitions pushed from the native host, which is how
   * user-installed worlds reach the renderer without a web server.
   */
  registerAll(inputs: unknown[]): WorldValidation {
    const errors: string[] = [];
    const warnings: string[] = [];
    for (const input of inputs) {
      const v = this.register(input);
      errors.push(...v.errors.map((e) => `[${(input as WorldDefinition)?.id ?? '?'}] ${e}`));
      warnings.push(...v.warnings.map((w) => `[${(input as WorldDefinition)?.id ?? '?'}] ${w}`));
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  has(id: string): boolean {
    return this._worlds.has(id);
  }

  get(id: string): WorldDefinition | null {
    return this._worlds.get(id) ?? null;
  }

  getAll(): WorldDefinition[] {
    return [...this._worlds.values()];
  }

  getActive(): WorldDefinition | null {
    return this._activeId ? this._worlds.get(this._activeId) ?? null : null;
  }

  getActiveId(): string | null {
    return this._activeId;
  }

  /** Activates a world by id, or falls back to the first built-in. */
  activate(id: string): WorldDefinition | null {
    const next = this._worlds.has(id) ? id : (BUILT_IN_WORLDS[0]?.id ?? null);
    if (next === null) return null;
    this._activeId = next;
    for (const fn of this._listeners) fn(next);
    return this._worlds.get(next) ?? null;
  }

  /** Cycles to the next world, wrapping. Used by the tray and global hotkeys. */
  next(): WorldDefinition | null {
    const all = this.getAll();
    if (all.length === 0) return null;
    const i = this._activeId ? all.findIndex((w) => w.id === this._activeId) : -1;
    return this.activate(all[(i + 1) % all.length].id);
  }

  previous(): WorldDefinition | null {
    const all = this.getAll();
    if (all.length === 0) return null;
    const i = this._activeId ? all.findIndex((w) => w.id === this._activeId) : 0;
    return this.activate(all[(i - 1 + all.length) % all.length].id);
  }

  onChange(fn: (id: string | null) => void): () => void {
    this._listeners.push(fn);
    return () => {
      this._listeners = this._listeners.filter((f) => f !== fn);
    };
  }

  remove(id: string): boolean {
    if (id === BUILT_IN_WORLDS[0]?.id) return false; // never remove the fallback
    if (this._activeId === id) this.activate(BUILT_IN_WORLDS[0]?.id ?? '');
    return this._worlds.delete(id);
  }

  dispose(): void {
    this._worlds.clear();
    this._activeId = null;
    this._listeners = [];
  }
}

export { BUILT_IN_WORLDS, findBuiltInWorld } from './registry.js';
export { validateWorld } from './types.js';
export type { WorldDefinition, WorldValidation, WorldStructure, BiomeId } from './types.js';
