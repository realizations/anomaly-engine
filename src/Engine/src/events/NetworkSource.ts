export class NetworkSource {
  private _online: boolean;
  private _listeners: ((online: boolean) => void)[] = [];
  private _wasOnline: boolean;

  constructor() {
    this._online = navigator.onLine;
    this._wasOnline = this._online;

    window.addEventListener('online', () => this._handleChange(true));
    window.addEventListener('offline', () => this._handleChange(false));
  }

  private _handleChange(online: boolean): void {
    this._online = online;
    if (online !== this._wasOnline) {
      this._wasOnline = online;
      this._listeners.forEach(fn => fn(online));
    }
  }

  isOnline(): boolean {
    return this._online;
  }

  onStatusChange(listener: (online: boolean) => void): () => void {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  }

  dispose(): void {
    window.removeEventListener('online', () => this._handleChange(true));
    window.removeEventListener('offline', () => this._handleChange(false));
    this._listeners = [];
  }
}
