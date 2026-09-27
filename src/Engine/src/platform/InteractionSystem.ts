export interface InteractiveZone {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  onClick?: () => void;
  onHover?: () => void;
  onIdle?: () => void;
  cursor?: string;
  hint?: string;
}

export class InteractionSystem {
  private _zones: Map<string, InteractiveZone> = new Map();
  private _hoveredZone: InteractiveZone | null = null;
  private _clickCounts: Map<string, number> = new Map();
  private _idleTimers: Map<string, number> = new Map();
  private _mouseX = 0;
  private _mouseY = 0;
  private _enabled = true;

  constructor() {
    this._setupListeners();
  }

  private _setupListeners(): void {
    window.addEventListener('mousemove', (e) => {
      if (!this._enabled) return;
      this._mouseX = e.clientX / window.innerWidth;
      this._mouseY = e.clientY / window.innerHeight;
      this._checkHover();
    });

    window.addEventListener('click', (e) => {
      if (!this._enabled) return;
      const x = e.clientX / window.innerWidth;
      const y = e.clientY / window.innerHeight;
      this._checkClick(x, y);
    });
  }

  private _checkHover(): void {
    for (const zone of this._zones.values()) {
      if (this._isInZone(zone, this._mouseX, this._mouseY)) {
        if (this._hoveredZone !== zone) {
          this._hoveredZone = zone;
          zone.onHover?.();
          if (zone.cursor) document.body.style.cursor = zone.cursor;
          if (zone.hint) this._showHint(zone.hint);
        }
        return;
      }
    }

    if (this._hoveredZone) {
      this._hoveredZone = null;
      document.body.style.cursor = 'default';
      this._hideHint();
    }
  }

  private _checkClick(x: number, y: number): void {
    for (const zone of this._zones.values()) {
      if (this._isInZone(zone, x, y)) {
        const count = (this._clickCounts.get(zone.id) ?? 0) + 1;
        this._clickCounts.set(zone.id, count);
        zone.onClick?.();

        if (count === 3) {
          window.dispatchEvent(new CustomEvent('anomaly:triple-click', { detail: { zoneId: zone.id } }));
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

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
  }

  isEnabled(): boolean {
    return this._enabled;
  }

  dispose(): void {
    this._zones.clear();
    this._clickCounts.clear();
    this._idleTimers.clear();
    this._hoveredZone = null;
  }
}
