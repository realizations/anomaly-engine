/**
 * Where the cursor is, and what it is over.
 *
 * ## Why this existed and did nothing
 *
 * `registerZone` was never called by anything. The system was constructed, exposed
 * through `getInteraction()`, and had no callers of its own -- so `_checkHover` and
 * `_checkClick` both iterated an empty map, `onIdle` was declared and never invoked,
 * and `_idleTimers` was allocated and never written. The `triple-click:observatory`
 * egg could not fire because there was nothing to triple-click. This was the same
 * shape of bug as the `weather.storm_started` subscription: a complete, valid
 * implementation with no path into it.
 *
 * ## Coordinate space
 *
 * Pointer positions are normalised against the **wallpaper canvas's** rectangle, not
 * against `window.innerWidth`/`innerHeight` as they were. The renderer normalises
 * against `canvas.getBoundingClientRect()`, and on a multi-monitor layout those are
 * different rectangles -- the canvas can be a subset of the window, or offset. Using
 * the window while the renderer used the canvas put every hover region a fixed
 * fraction of the way off, and the error grew with the number of displays.
 *
 * Regions themselves are still stored normalised, because that is the unit the asset
 * registry produces and the unit that survives a resize.
 */

export interface InteractiveZone {
  id: string;
  name: string;
  /** Left edge, as a fraction of the canvas. */
  x: number;
  /** Top edge, as a fraction of the canvas. */
  y: number;
  /** Width, as a fraction of the canvas. */
  width: number;
  /** Height, as a fraction of the canvas. */
  height: number;
  onClick?: () => void;
  onHover?: () => void;
  /**
   * Called once the cursor has rested on this zone for `dwellMs`.
   *
   * Named for what it does rather than what it was going to be. It was `onIdle`, which
   * describes the absence of input, but the effect it existed for is a cursor
   * *resting* somewhere -- "you looked at the forest for thirty seconds" is the
   * opposite of idle input. A name that misdescribes its own behaviour is worse than
   * no name.
   */
  onDwell?: () => void;
  /** How long the cursor must rest here before `onDwell` fires. 0 disables it. */
  dwellMs?: number;
  cursor?: string;
  hint?: string;
}

/** How often dwell timers are checked. One second is coarse enough to be free. */
const DWELL_TICK_MS = 1000;

export class InteractionSystem {
  private _zones: Map<string, InteractiveZone> = new Map();
  private _hoveredZone: InteractiveZone | null = null;
  private _clickCounts: Map<string, number> = new Map();
  /** Zone id -> how long the cursor has rested on it. */
  private _dwell: Map<string, number> = new Map();
  /**
   * Zones whose dwell has already fired for the current hover.
   *
   * Without this the clock restarts at zero the moment it fires -- the delete before the
   * callback is what stops a throwing callback from firing on every subsequent tick --
   * and "fires once the cursor has rested for `dwellMs`" quietly becomes "fires every
   * `dwellMs` for as long as the cursor stays there". Benign for a one-shot egg, since
   * the second trigger finds nothing, but it contradicts the documented behaviour and
   * would not be benign for anything with a side effect. Cleared alongside `_dwell`, so
   * leaving and returning gives a fresh stare.
   */
  private _dwellFired: Set<string> = new Set();
  private _mouseX = 0;
  private _mouseY = 0;
  private _enabled = true;
  private _ticker: number | null = null;
  private _boundMove: (e: MouseEvent) => void;
  private _boundClick: (e: MouseEvent) => void;

  constructor() {
    this._boundMove = (e: MouseEvent) => {
      if (!this._enabled) return;
      const p = this._normalize(e);
      this._mouseX = p.x;
      this._mouseY = p.y;
      this._checkHover();
    };
    this._boundClick = (e: MouseEvent) => {
      if (!this._enabled) return;
      const p = this._normalize(e);
      this._checkClick(p.x, p.y);
    };
    this._setupListeners();
  }

  /**
   * The canvas the renderer draws into, or null before the engine has created it.
   *
   * Falls back to the window so that a missing canvas degrades to the old behaviour
   * rather than to a division by zero or a thrown error on every mousemove.
   */
  private _surface(): { left: number; top: number; width: number; height: number } {
    const el = document.getElementById('wallpaper-canvas');
    if (el) {
      const r = el.getBoundingClientRect();
      // A canvas that has not been laid out reports zero, which would make every
      // normalised coordinate infinite or NaN.
      if (r.width > 0 && r.height > 0) return r;
    }
    return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }

  private _normalize(e: MouseEvent): { x: number; y: number } {
    const s = this._surface();
    return { x: (e.clientX - s.left) / s.width, y: (e.clientY - s.top) / s.height };
  }

  private _setupListeners(): void {
    window.addEventListener('mousemove', this._boundMove);
    window.addEventListener('click', this._boundClick);
    this._ticker = window.setInterval(() => this._tickDwell(), DWELL_TICK_MS);
  }

  private _checkHover(): void {
    for (const zone of this._zones.values()) {
      if (this._isInZone(zone, this._mouseX, this._mouseY)) {
        if (this._hoveredZone !== zone) {
          this._hoveredZone = zone;
          zone.onHover?.();
          if (zone.cursor) document.body.style.cursor = zone.cursor;
          if (zone.hint) this._showHint(zone.hint);
          // Entering a new zone restarts every dwell clock. Otherwise walking from the
          // cabin to the forest would inherit the cabin's accumulated time and fire
          // the forest's egg immediately, which is not what resting somewhere means.
          this._dwell.clear();
          this._dwellFired.clear();
          this._dwell.set(zone.id, 0);
        }
        return;
      }
    }

    if (this._hoveredZone) {
      this._hoveredZone = null;
      this._dwell.clear();
      this._dwellFired.clear();
      document.body.style.cursor = 'default';
      this._hideHint();
    }
  }

  /**
   * Advance the dwell clock for the hovered zone and fire once its threshold is met.
   *
   * The timer is keyed on the hovered zone, so leaving resets it for free: an
   * unhovered zone is never in `_dwell`, and re-entering starts from zero. A zone that
   * has already fired does not fire again until the cursor has left and come back.
   */
  private _tickDwell(): void {
    const zone = this._hoveredZone;
    if (!zone || !zone.onDwell || !zone.dwellMs || zone.dwellMs <= 0) return;
    if (this._dwellFired.has(zone.id)) return;
    const elapsed = (this._dwell.get(zone.id) ?? 0) + DWELL_TICK_MS;
    this._dwell.set(zone.id, elapsed);
    if (elapsed >= zone.dwellMs) {
      // Recorded before the callback, not after: a callback that threw would otherwise
      // leave the clock unmarked and fire again on every tick. It is a set rather than a
      // long-lived clock because the delete that used to stand here is what made the
      // next tick start from zero and reach the threshold all over again.
      this._dwellFired.add(zone.id);
      this._dwell.delete(zone.id);
      zone.onDwell();
    }
  }

  private _checkClick(x: number, y: number): void {
    for (const zone of this._zones.values()) {
      if (this._isInZone(zone, x, y)) {
        const count = (this.getClickCount(zone.id) ?? 0) + 1;
        this._clickCounts.set(zone.id, count);
        zone.onClick?.();

        if (count === 3) {
          window.dispatchEvent(
            new CustomEvent('anomaly:triple-click', { detail: { zoneId: zone.id } })
          );
          // Reset, so a second triple-click needs three more clicks rather than one.
          // Without this the zone fires on every third click forever.
          this._clickCounts.set(zone.id, 0);
        }
        return;
      }
    }
  }

  private _isInZone(zone: InteractiveZone, x: number, y: number): boolean {
    return x >= zone.x && x <= zone.x + zone.width && y >= zone.y && y <= zone.y + zone.height;
  }

  private _showHint(text: string): void {
    let hint = document.getElementById('anomaly-hint');
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'anomaly-hint';
      hint.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:#e0e0ff;padding:8px 16px;border-radius:4px;font-size:13px;pointer-events:none;z-index:9999;';
      document.body.appendChild(hint);
    }
    hint.textContent = text;
  }

  private _hideHint(): void {
    document.getElementById('anomaly-hint')?.remove();
  }

  registerZone(zone: InteractiveZone): void {
    this._zones.set(zone.id, zone);
  }

  unregisterZone(id: string): void {
    this._zones.delete(id);
    this._dwell.delete(id);
    this._dwellFired.delete(id);
    // Also drop the click count, or re-registering a zone lets it inherit a count of
    // two and fire a triple-click on the player's first click.
    this._clickCounts.delete(id);
    if (this._hoveredZone?.id === id) {
      this._hoveredZone = null;
      document.body.style.cursor = 'default';
      this._hideHint();
    }
  }

  getZones(): InteractiveZone[] {
    return Array.from(this._zones.values());
  }

  getClickCount(id: string): number {
    return this._clickCounts.get(id) ?? 0;
  }

  resetClickCount(id: string): void {
    this._clickCounts.set(id, 0);
  }

  /** How long the cursor has rested on a zone, in milliseconds. Read by tests. */
  getDwellMs(id: string): number {
    return this._dwell.get(id) ?? 0;
  }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    if (!enabled) {
      this._dwell.clear();
      this._dwellFired.clear();
      this._hoveredZone = null;
      document.body.style.cursor = 'default';
      this._hideHint();
    }
  }

  isEnabled(): boolean {
    return this._enabled;
  }

  dispose(): void {
    this._zones.clear();
    this._clickCounts.clear();
    this._dwell.clear();
    this._dwellFired.clear();
    this._hoveredZone = null;
    document.body.style.cursor = 'default';
    this._hideHint();
    // The listeners were never removed before. On dispose of an engine that is being
    // replaced in place, they kept a live reference to the old zone map.
    window.removeEventListener('mousemove', this._boundMove);
    window.removeEventListener('click', this._boundClick);
    if (this._ticker !== null) {
      window.clearInterval(this._ticker);
      this._ticker = null;
    }
  }
}
