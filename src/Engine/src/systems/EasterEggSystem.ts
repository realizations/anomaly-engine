export interface EasterEgg {
  id: string;
  name: string;
  description: string;
  trigger: string;
  effect: string;
  discovered: boolean;
}

export const KONAMI_CODE = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight',
  'b', 'a',
];

export const BUILTIN_EASTER_EGGS: EasterEgg[] = [
  {
    id: 'konami',
    name: 'The Classic',
    description: 'The oldest trick in the book.',
    trigger: 'konami',
    effect: 'All lights in the town turn on for 10 seconds.',
    discovered: false,
  },
  {
    id: 'triple-click-observatory',
    name: 'The Observer',
    description: 'You found the watcher.',
    trigger: 'triple-click:observatory',
    effect: 'The observatory door opens slightly.',
    discovered: false,
  },
  {
    id: 'midnight-hover-moon',
    name: 'Moonlit',
    description: 'The moon notices you.',
    trigger: 'hover:moon@midnight',
    effect: 'The moon pulses once.',
    discovered: false,
  },
  {
    id: 'forest-stare',
    name: 'The Stare',
    description: 'You looked too long.',
    trigger: 'idle:forest:30s',
    effect: 'Something blinks back.',
    discovered: false,
  },
  {
    id: 'dev-build-message',
    name: 'Behind the Curtain',
    description: 'You were not supposed to see this.',
    trigger: 'dev-build',
    effect: 'A message appears: "We know you are there."',
    discovered: false,
  },
  {
    id: '0333-stare',
    name: 'The Third Night',
    description: 'Three nights of watching.',
    trigger: '3:33 x3',
    effect: 'The clock shows a different time.',
    discovered: false,
  },
];

export class EasterEggSystem {
  private _eggs: Map<string, EasterEgg> = new Map();
  private _discovered: Set<string> = new Set();
  private _konamiProgress = 0;
  private _listeners: ((egg: EasterEgg) => void)[] = [];

  constructor() {
    for (const egg of BUILTIN_EASTER_EGGS) {
      this._eggs.set(egg.id, { ...egg });
    }
    this._setupKonamiListener();
  }

  /**
   * Listens for the Konami sequence on `window`.
   *
   * This fires wherever the page holds keyboard focus, and not in the shipped host:
   * the wallpaper is reparented behind the desktop icons and never takes focus, so no
   * key ever reaches it. Under `npm run dev` it is a normal browser tab and the
   * sequence works, which is the point -- it is a developer's easter egg, reachable
   * exactly where a developer is looking.
   *
   * `trigger('konami')` is the other entry point, and that one does reach the shipped
   * build: it is what `window.__engine.discoverEgg('konami')` calls, which is the
   * documented escape hatch `tools/story-beats.mjs` uses to prove the beat renders.
   * A previous version of this comment said "nothing calls it yet", which was true of
   * the class and false of the shipped behaviour.
   *
   * The route that would make it a player-facing discovery does not exist yet, and the
   * honest thing is to say so rather than to pretend a global hotkey can express ten
   * keys in order.
   */
  private _setupKonamiListener(): void {
    window.addEventListener('keydown', (e) => {
      if (e.key === KONAMI_CODE[this._konamiProgress]) {
        this._konamiProgress++;
        if (this._konamiProgress === KONAMI_CODE.length) {
          this._konamiProgress = 0;
          this._triggerEgg('konami');
        }
      } else {
        this._konamiProgress = 0;
      }
    });
  }

  private _triggerEgg(id: string): boolean {
    if (this._discovered.has(id)) return false;

    const egg = this._eggs.get(id);
    if (!egg) return false;

    this._discovered.add(id);
    egg.discovered = true;
    this._listeners.forEach(fn => fn(egg));
    return true;
  }

  trigger(trigger: string): boolean {
    for (const egg of this._eggs.values()) {
      if (egg.trigger === trigger) {
        return this._triggerEgg(egg.id);
      }
    }
    return false;
  }

  isDiscovered(id: string): boolean {
    return this._discovered.has(id);
  }

  getDiscovered(): EasterEgg[] {
    return Array.from(this._eggs.values()).filter(e => e.discovered);
  }

  getAll(): EasterEgg[] {
    return Array.from(this._eggs.values());
  }

  getProgress(): { discovered: number; total: number } {
    return { discovered: this._discovered.size, total: this._eggs.size };
  }

  onDiscover(listener: (egg: EasterEgg) => void): () => void {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  }

  dispose(): void {
    this._listeners = [];
    this._eggs.clear();
    this._discovered.clear();
    this._konamiProgress = 0;
  }
}
