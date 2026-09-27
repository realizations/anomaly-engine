export interface HotkeyConfig {
  screenshot: string;
  pause: string;
  resume: string;
  triggerEvent: string;
  debugOverlay: string;
  creatorMode: string;
}

const DEFAULT_HOTKEYS: HotkeyConfig = {
  screenshot: 'Ctrl+Alt+W',
  pause: 'Ctrl+Alt+P',
  resume: 'Ctrl+Alt+R',
  triggerEvent: 'Ctrl+Alt+T',
  debugOverlay: 'Ctrl+Alt+D',
  creatorMode: 'Ctrl+Alt+C',
};

export class HotkeySystem {
  private _config: HotkeyConfig = { ...DEFAULT_HOTKEYS };
  private _listeners: Map<string, Array<() => void>> = new Map();
  private _enabled = true;

  constructor() {
    this._setupListeners();
  }

  private _setupListeners(): void {
    window.addEventListener('keydown', (e) => {
      if (!this._enabled) return;

      const combo = this._getCombo(e);
      const listeners = this._listeners.get(combo);
      if (listeners) {
        e.preventDefault();
        listeners.forEach(fn => fn());
      }
    });
  }

  private _getCombo(e: KeyboardEvent): string {
    const parts: string[] = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    parts.push(e.key.toUpperCase());
    return parts.join('+');
  }

  register(action: keyof HotkeyConfig, callback: () => void): void {
    const combo = this._config[action];
    const existing = this._listeners.get(combo) ?? [];
    existing.push(callback);
    this._listeners.set(combo, existing);
  }

  unregister(action: keyof HotkeyConfig, callback: () => void): void {
    const combo = this._config[action];
    const existing = this._listeners.get(combo);
    if (!existing) return;
    const idx = existing.indexOf(callback);
    if (idx >= 0) existing.splice(idx, 1);
  }

  setHotkey(action: keyof HotkeyConfig, combo: string): void {
    this._config[action] = combo;
  }

  getConfig(): HotkeyConfig {
    return { ...this._config };
  }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
  }

  isEnabled(): boolean {
    return this._enabled;
  }

  dispose(): void {
    this._listeners.clear();
  }
}
