export interface RemoteEventDefinition {
  event: string;
  start: string;
  duration: number;
  payload: Record<string, unknown>;
  signature?: string;
}

export interface RemoteEventConfig {
  endpoint: string;
  interval: number;
  timeout: number;
}

export class RemoteEventSource {
  private _config: RemoteEventConfig;
  private _timer: number | null = null;
  private _listeners: ((event: RemoteEventDefinition) => void)[] = [];
  private _errorListeners: ((error: Error) => void)[] = [];
  private _backoffMs = 1000;
  private _maxBackoffMs = 60000;
  private _lastFetch = 0;

  constructor(config: RemoteEventConfig) {
    this._config = config;
  }

  start(): void {
    this._fetch();
    this._timer = window.setInterval(() => this._fetch(), this._config.interval * 1000);
  }

  stop(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  private async _fetch(): Promise<void> {
    if (Date.now() - this._lastFetch < this._config.interval * 1000) return;
    this._lastFetch = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this._config.timeout * 1000);

      const response = await fetch(this._config.endpoint, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });

      clearTimeout(timeoutId);

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json() as { events?: RemoteEventDefinition[] };
      this._backoffMs = 1000;

      if (!data.events || !Array.isArray(data.events)) return;

      const now = Date.now();
      for (const event of data.events) {
        const startTime = new Date(event.start).getTime();
        if (now >= startTime && now <= startTime + event.duration * 1000) {
          this._listeners.forEach(fn => fn(event));
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this._errorListeners.forEach(fn => fn(error));
      this._backoffMs = Math.min(this._backoffMs * 2, this._maxBackoffMs);
    }
  }

  onEvent(listener: (event: RemoteEventDefinition) => void): () => void {
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
