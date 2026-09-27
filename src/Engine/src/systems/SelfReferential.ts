export type ClockMode = 'normal' | 'drift' | 'frozen' | 'glitch' | 'backward';

export interface WorldClockState {
  mode: ClockMode;
  worldTime: Date;
  driftRate: number;
  lastGlitch: number;
  glitchFrequency: number;
  hiddenTimestamp: string;
}

export class WorldClock {
  private _state: WorldClockState = {
    mode: 'normal',
    worldTime: new Date(),
    driftRate: 0,
    lastGlitch: 0,
    glitchFrequency: 0,
    hiddenTimestamp: '',
  };

  private _realStartTime = Date.now();
  private _worldStartTime = Date.now();
  private _listeners: ((state: WorldClockState) => void)[] = [];
  private _timer: number | null = null;
  private _glitchInterval = 0;

  constructor() {
    this._startTicking();
  }

  private _startTicking(): void {
    this._timer = window.setInterval(() => this._tick(), 1000);
  }

  private _tick(): void {
    const now = Date.now();
    const realElapsed = now - this._realStartTime;

    switch (this._state.mode) {
      case 'normal':
        this._state.worldTime = new Date(this._worldStartTime + realElapsed);
        break;
      case 'drift':
        this._state.worldTime = new Date(this._worldStartTime + realElapsed * (1 + this._state.driftRate));
        break;
      case 'frozen':
        break;
      case 'glitch':
        this._state.worldTime = new Date(this._worldStartTime + realElapsed);
        if (now - this._state.lastGlitch > this._glitchInterval) {
          this._triggerGlitch(now);
        }
        break;
      case 'backward':
        this._state.worldTime = new Date(this._worldStartTime - realElapsed);
        break;
    }

    this._listeners.forEach(fn => fn(this._getState()));
  }

  private _triggerGlitch(now: number): void {
    this._state.lastGlitch = now;
    const glitchMs = Math.floor(Math.random() * 5000) - 2500;
    this._state.worldTime = new Date(this._state.worldTime.getTime() + glitchMs);
    this._state.hiddenTimestamp = this._generateHiddenTimestamp();
  }

  private _generateHiddenTimestamp(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
  }

  setMode(mode: ClockMode): void {
    this._state.mode = mode;
    if (mode === 'glitch') {
      this._glitchInterval = Math.floor(Math.random() * 60000) + 30000;
      this._state.lastGlitch = Date.now();
    }
    this._listeners.forEach(fn => fn(this._getState()));
  }

  setDriftRate(rate: number): void {
    this._state.driftRate = rate;
    this._state.mode = 'drift';
  }

  getTime(): Date {
    return new Date(this._state.worldTime);
  }

  getMode(): ClockMode {
    return this._state.mode;
  }

  getHiddenTimestamp(): string {
    return this._state.hiddenTimestamp;
  }

  getState(): WorldClockState {
    return this._getState();
  }

  private _getState(): WorldClockState {
    return { ...this._state };
  }

  onUpdate(listener: (state: WorldClockState) => void): () => void {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  }

  forceGlitch(): void {
    this._state.worldTime = new Date(this._state.worldTime.getTime() + Math.floor(Math.random() * 10000) - 5000);
    this._state.hiddenTimestamp = this._generateHiddenTimestamp();
  }

  dispose(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._listeners = [];
  }
}
