export interface MediaState {
  playing: boolean;
  title: string;
  artist: string;
  album: string;
  duration: number;
  position: number;
  volume: number;
  beatDetected: boolean;
}

export interface MediaConfig {
  enabled: boolean;
  reactToPlayback: boolean;
  reactToBeat: boolean;
  reactToVolume: boolean;
  privacyMode: boolean;
}

export class MediaReactivitySystem {
  private _config: MediaConfig = {
    enabled: false,
    reactToPlayback: true,
    reactToBeat: true,
    reactToVolume: true,
    privacyMode: true,
  };

  private _state: MediaState = {
    playing: false,
    title: '',
    artist: '',
    album: '',
    duration: 0,
    position: 0,
    volume: 0.7,
    beatDetected: false,
  };

  private _listeners: ((state: MediaState) => void)[] = [];
  private _beatListeners: (() => void)[] = [];
  private _audioContext: AudioContext | null = null;
  public _analyser: AnalyserNode | null = null;

  getConfig(): MediaConfig {
    return { ...this._config };
  }

  setConfig(config: Partial<MediaConfig>): void {
    this._config = { ...this._config, ...config };
  }

  getState(): MediaState {
    return { ...this._state };
  }

  updateState(updates: Partial<MediaState>): void {
    const prev = this._state;
    this._state = { ...this._state, ...updates };

    if (updates.playing !== undefined && updates.playing !== prev.playing) {
      this._listeners.forEach(fn => fn(this._state));
    }

    if (updates.volume !== undefined && updates.volume !== prev.volume) {
      this._listeners.forEach(fn => fn(this._state));
    }

    if (updates.beatDetected && !prev.beatDetected) {
      this._beatListeners.forEach(fn => fn());
    }
  }

  onUpdate(listener: (state: MediaState) => void): () => void {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  }

  onBeat(listener: () => void): () => void {
    this._beatListeners.push(listener);
    return () => {
      const idx = this._beatListeners.indexOf(listener);
      if (idx >= 0) this._beatListeners.splice(idx, 1);
    };
  }

  dispose(): void {
    this._listeners = [];
    this._beatListeners = [];
    this._audioContext?.close();
    this._audioContext = null;
    this._analyser = null;
  }
}
