export interface AudioTrack {
  id: string;
  src: string;
  volume: number;
  loop: boolean;
  ambient: boolean;
}

export interface AudioConfig {
  masterVolume: number;
  muted: boolean;
  ambientOnly: boolean;
  audioReactive: boolean;
}

export class AudioSystem {
  private _config: AudioConfig = {
    masterVolume: 0.7,
    muted: false,
    ambientOnly: false,
    audioReactive: false,
  };

  private _tracks: Map<string, HTMLAudioElement> = new Map();
  private _activeTracks: Set<string> = new Set();
  private _listeners: ((trackId: string, event: string) => void)[] = [];

  registerTrack(track: AudioTrack): void {
    const audio = new Audio(track.src);
    audio.volume = track.volume * this._config.masterVolume;
    audio.loop = track.loop;
    this._tracks.set(track.id, audio);
  }

  play(trackId: string): void {
    const audio = this._tracks.get(trackId);
    if (!audio) return;
    if (this._config.muted) return;
    if (this._config.ambientOnly && !this._isAmbient(trackId)) return;

    audio.play().catch(() => {});
    this._activeTracks.add(trackId);
    this._listeners.forEach(fn => fn(trackId, 'play'));
  }

  stop(trackId: string): void {
    const audio = this._tracks.get(trackId);
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    this._activeTracks.delete(trackId);
    this._listeners.forEach(fn => fn(trackId, 'stop'));
  }

  stopAll(): void {
    for (const trackId of this._activeTracks) {
      this.stop(trackId);
    }
  }

  setVolume(trackId: string, volume: number): void {
    const audio = this._tracks.get(trackId);
    if (!audio) return;
    audio.volume = volume * this._config.masterVolume;
  }

  setMasterVolume(volume: number): void {
    this._config.masterVolume = Math.max(0, Math.min(1, volume));
    for (const audio of this._tracks.values()) {
      audio.volume = this._config.masterVolume;
    }
  }

  mute(): void {
    this._config.muted = true;
    this.stopAll();
  }

  unmute(): void {
    this._config.muted = false;
  }

  isMuted(): boolean {
    return this._config.muted;
  }

  getConfig(): AudioConfig {
    return { ...this._config };
  }

  setConfig(config: Partial<AudioConfig>): void {
    this._config = { ...this._config, ...config };
  }

  private _isAmbient(trackId: string): boolean {
    const audio = this._tracks.get(trackId);
    return audio?.loop ?? false;
  }

  onTrackEvent(listener: (trackId: string, event: string) => void): () => void {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  }

  dispose(): void {
    this.stopAll();
    for (const audio of this._tracks.values()) {
      audio.src = '';
    }
    this._tracks.clear();
    this._activeTracks.clear();
    this._listeners = [];
  }
}
