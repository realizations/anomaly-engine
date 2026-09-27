export interface UpdateInfo {
  version: string;
  releaseNotes: string;
  downloadUrl: string;
  publishedAt: string;
  mandatory: boolean;
  signature?: string;
}

export interface UpdaterConfig {
  checkInterval: number;
  endpoint: string;
  autoCheck: boolean;
  allowMandatory: boolean;
}

export class UpdateSystem {
  private _config: UpdaterConfig;
  private _timer: number | null = null;
  private _listeners: ((info: UpdateInfo) => void)[] = [];
  private _errorListeners: ((error: Error) => void)[] = [];
  private _currentVersion: string;

  constructor(config: UpdaterConfig, currentVersion: string) {
    this._config = config;
    this._currentVersion = currentVersion;
  }

  start(): void {
    if (!this._config.autoCheck) return;
    this._check();
    this._timer = window.setInterval(() => this._check(), this._config.checkInterval * 1000);
  }

  stop(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  private async _check(): Promise<void> {
    try {
      const response = await fetch(this._config.endpoint, {
        headers: { 'Accept': 'application/json' },
      });
      if (!response.ok) return;

      const info = await response.json() as UpdateInfo;
      if (this._isNewer(info.version, this._currentVersion)) {
        this._listeners.forEach(fn => fn(info));
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this._errorListeners.forEach(fn => fn(error));
    }
  }

  private _isNewer(remote: string, current: string): boolean {
    const r = remote.split('.').map(Number);
    const c = current.split('.').map(Number);
    for (let i = 0; i < Math.max(r.length, c.length); i++) {
      const rv = r[i] ?? 0;
      const cv = c[i] ?? 0;
      if (rv > cv) return true;
      if (rv < cv) return false;
    }
    return false;
  }

  onUpdateAvailable(listener: (info: UpdateInfo) => void): () => void {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  }

  onError(listener: (error: Error) => void): () => void {
    this._errorListeners.push(listener);
    return () => {
      const idx = this._errorListeners.indexOf(listener);
      if (idx >= 0) this._errorListeners.splice(idx, 1);
    };
  }

  dispose(): void {
    this.stop();
    this._listeners = [];
    this._errorListeners = [];
  }
}
