export interface AccessibilityConfig {
  reducedMotion: boolean;
  highContrast: boolean;
  muteAll: boolean;
  keyboardNavigation: boolean;
  scalableUI: boolean;
  focusVisible: boolean;
}

export class AccessibilitySystem {
  private _config: AccessibilityConfig = {
    reducedMotion: false,
    highContrast: false,
    muteAll: false,
    keyboardNavigation: true,
    scalableUI: true,
    focusVisible: true,
  };

  private _listeners: ((config: AccessibilityConfig) => void)[] = [];

  constructor() {
    this._detectSystemPreferences();
  }

  private _detectSystemPreferences(): void {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this._config.reducedMotion = true;
    }
    if (window.matchMedia('(prefers-contrast: high)').matches) {
      this._config.highContrast = true;
    }
  }

  getConfig(): AccessibilityConfig {
    return { ...this._config };
  }

  setConfig(config: Partial<AccessibilityConfig>): void {
    this._config = { ...this._config, ...config };
    this._applyConfig();
    this._listeners.forEach(fn => fn(this._config));
  }

  private _applyConfig(): void {
    const root = document.documentElement;

    if (this._config.reducedMotion) {
      root.classList.add('anomaly-reduced-motion');
    } else {
      root.classList.remove('anomaly-reduced-motion');
    }

    if (this._config.highContrast) {
      root.classList.add('anomaly-high-contrast');
    } else {
      root.classList.remove('anomaly-high-contrast');
    }

    if (this._config.muteAll) {
      root.classList.add('anomaly-muted');
    } else {
      root.classList.remove('anomaly-muted');
    }
  }

  shouldReduceMotion(): boolean {
    return this._config.reducedMotion;
  }

  shouldUseHighContrast(): boolean {
    return this._config.highContrast;
  }

  shouldMuteAll(): boolean {
    return this._config.muteAll;
  }

  onConfigChange(listener: (config: AccessibilityConfig) => void): () => void {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  }

  dispose(): void {
    this._listeners = [];
  }
}
