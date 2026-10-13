import {
  detectBeats,
  energyEnvelope,
  beatDueSince,
  type Beat,
  type Samples,
} from './OnsetDetector.js';

/**
 * What the scene is doing in response to an audio track.
 *
 * This class was a state object with no source and no listeners: `updateState` and
 * `onBeat` were public methods nothing called, and the only thing in the file capable
 * of producing a beat was an `AnalyserNode` that was never connected to anything. The
 * README called it a deliberate non-goal, which was true of *desktop audio capture* and
 * not true of the rest of the file.
 *
 * What it does now is react to a track the user chose. Not to what is playing on the
 * system: capturing that needs a loopback device and a permission the user has to grant
 * through a picker, and a wallpaper is the last thing that should be asking for it.
 * A file is explicit, local, works offline, carries no licence question, and can be
 * analysed before it is ever played.
 *
 * The analysis itself is in `OnsetDetector.ts` and is a pure function, which is the
 * part that can be tested: everything here is transport and policy around it.
 */

export interface MediaState {
  /** Whether a track is loaded and the clock is running. */
  playing: boolean;
  /** Name of the loaded track, for the panel. */
  title: string;
  /** Seconds into the track. */
  position: number;
  /** Track length in seconds. */
  duration: number;
  /** Smoothed 0..1 loudness, for the continuous response. */
  level: number;
  /** True on the frame a beat fires. */
  beatDetected: boolean;
  /** Beats found in the loaded track. Zero means no track is loaded. */
  beatCount: number;
}

export interface MediaConfig {
  /** Master switch. Off means no track is analysed and no response is emitted. */
  enabled: boolean;
  /** Emit a beat response. */
  reactToBeat: boolean;
  /** Emit a continuous level response. */
  reactToLevel: boolean;
  /**
   * Analyse without playing.
   *
   * Separate from the mute preference on purpose. Muting is an accessibility decision
   * the user has already made and should silence this immediately; this flag is
   * "I want the visuals but not the sound", which is a different thing and can be
   * chosen per track.
   */
  silentPlayback: boolean;
}

const DEFAULT_STATE: MediaState = {
  playing: false,
  title: '',
  position: 0,
  duration: 0,
  level: 0,
  beatDetected: false,
  beatCount: 0,
};

export class MediaReactivitySystem {
  private _config: MediaConfig = {
    enabled: false,
    reactToBeat: true,
    reactToLevel: true,
    silentPlayback: false,
  };

  private _state: MediaState = { ...DEFAULT_STATE };

  private _listeners: ((state: MediaState) => void)[] = [];
  private _beatListeners: ((beat: Beat) => void)[] = [];

  private _beats: Beat[] = [];
  private _envelope: Float32Array = new Float32Array(0);
  private _hop = 512;
  private _sampleRate = 44100;
  private _lastBeatTime = -1;
  private _smoothedLevel = 0;
  private _buffer: AudioBuffer | null = null;
  private _source: AudioBufferSourceNode | null = null;
  private _context: AudioContext | null = null;
  private _gain: GainNode | null = null;
  private _startedAt = 0;
  private _offset = 0;
  private _muted = false;

  getConfig(): MediaConfig {
    return { ...this._config };
  }

  setConfig(config: Partial<MediaConfig>): void {
    const next = { ...this._config };

    for (const key of ['enabled', 'reactToBeat', 'reactToLevel', 'silentPlayback'] as const) {
      const value = (config as Record<string, unknown>)[key];
      if (typeof value === 'boolean') next[key] = value;
    }

    this._config = next;

    // Turning it off has to stop the clock, not just stop reporting. A system that
    // stays enabled with its responses suppressed is one line away from being on.
    // `stop` already emits, so there is no second notification here.
    if (!next.enabled) {
      this.stop();
    } else if (next.silentPlayback !== this._wasSilent()) {
      this._rebuildPlayback();
    }
  }

  getState(): MediaState {
    return { ...this._state };
  }

  /**
   * Decodes a track and works out its beats.
   *
   * Analysis happens here, once, and is synchronous from the caller's point of view
   * apart from decoding. A three-minute track is a few hundred million multiply-adds,
   * which is long enough to drop frames if done per frame -- which is why it is not --
   * and short enough to do synchronously rather than in a worker, which would be more
   * machinery for one call at load time.
   *
   * Returns how many beats were found. Zero is a legitimate answer for an ambient
   * track and is reported rather than treated as a failure.
   */
  async load(samples: Samples, sampleRate = 44100, title = ''): Promise<number> {
    this._sampleRate = sampleRate;
    this._beats = detectBeats(samples, sampleRate);
    this._envelope = energyEnvelope(samples, this._hop);
    this._lastBeatTime = -1;
    this._smoothedLevel = 0;

    this._state = {
      ...this._state,
      title,
      duration: samples.length / sampleRate,
      beatCount: this._beats.length,
      level: 0,
      beatDetected: false,
    };

    // Playback needs an AudioBuffer, and decoding is what produces one. Kept separate
    // from the analysis so a caller that only wants the beats -- a test, or a headless
    // check -- never has to construct an AudioContext.
    try {
      this._context ??= new AudioContext();
      this._buffer = await this._context.decodeAudioData(
        samples.buffer.slice(0) as ArrayBuffer
      );
    } catch {
      // No AudioContext, or a format the browser will not decode. The beats are still
      // real and the level response still works off the envelope, so this is a
      // degraded transport rather than a dead feature.
      this._buffer = null;
      this._context = null;
    }

    this._emit();
    return this._beats.length;
  }

  /**
   * The beats found by the last `load`, for the settings readout.
   *
   * Read once per open rather than per frame: the count is what the panel shows, and
   * `getState().beatCount` carries that. This returns the times as well, which is what
   * the settings window's own debug line and the tests use to confirm that a click
   * track was heard at all rather than silently producing nothing.
   */
  getBeats(): Beat[] {
    return this._beats.slice();
  }

  /**
   * Advances the transport and emits whatever is due.
   *
   * Driven from the render loop with the frame's timestamp rather than by a timer of
   * its own. A system that ran its own interval would keep time while the wallpaper
   * was paused, so the first frame after a pause would fire every beat that had
   * accumulated -- a burst of pulses out of nowhere.
   */
  update(nowMs: number): void {
    if (!this._config.enabled || this._beats.length === 0) {
      this._smoothedLevel *= 0.9;
      return;
    }

    if (!this._playing) {
      this._state.level = this._smoothedLevel;
      this._state.beatDetected = false;
      return;
    }

    const position = this._positionAt(nowMs);

    // The level response is a fast-attack, slow-release follower rather than the raw
    // envelope value. A raw lookup follows the waveform closely enough to look like a
    // strobe, and a visual response that flickers at audio frequency is both unpleasant
    // and, on some displays, a genuine accessibility problem.
    const index = Math.floor(position * this._sampleRate) / this._hop;
    const target = this._envelope[Math.min(this._envelope.length - 1, Math.max(0, Math.floor(index)))] ?? 0;
    this._smoothedLevel += (target - this._smoothedLevel) * (target > this._smoothedLevel ? 0.5 : 0.08);

    this._state.beatDetected = false;

    if (this._config.reactToBeat) {
      // Half-open against the last beat that fired, so a coarse clock yields one beat
      // rather than every beat it slept through, and a fine clock cannot fire the same
      // one twice.
      const due = beatDueSince(this._beats, position, this._lastBeatTime);
      if (due) {
        this._lastBeatTime = due.time;

        this._state.beatDetected = true;
        this._beatListeners.forEach((fn) => fn(due));
      }
    }

    this._state.position = position;
    this._state.level = this._smoothedLevel;
    this._emit();
  }

  /**
   * Starts playback and the clock.
   *
   * Takes the current time from the caller rather than reading the clock itself, and
   * that is not tidiness: `update` is driven with the render loop's timestamp, so if
   * the two read different clocks the position is computed from one and advanced by the
   * other, and the first `update` after `play` reports a position of minus several
   * minutes. Passing the same value in keeps one clock.
   */
  startTransport(nowMs?: number): void {
    if (!this._config.enabled || this._beats.length === 0) return;

    this._offset = 0;
    this._lastBeatTime = -1;
    this._startedAt = nowMs ?? this._now();
    this._playing = true;
    this._state.playing = true;
    this._startSource();
    this._emit();
  }

  /**
   * Stops playback and rewinds.
   *
   * A full stop rather than a pause, because there is nothing to resume to: a wallpaper
   * that resumed an audio track an hour later would be a surprise.
   */
  stop(): void {
    this._stopSource();
    this._playing = false;
    this._offset = 0;
    this._lastBeatTime = -1;
    this._smoothedLevel = 0;
    if (this._state.playing || this._state.position !== 0) {
      this._state.playing = false;
      this._state.position = 0;
      this._state.level = 0;
      this._state.beatDetected = false;
      this._emit();
    }
  }

  private _playing = false;
  private _now = (): number =>
    typeof performance !== 'undefined' ? performance.now() : Date.now();

  private _positionAt(nowMs: number): number {
    if (!this._playing) return this._offset;
    return Math.min(this._state.duration, this._offset + (nowMs - this._startedAt) / 1000);
  }

  /**
   * Routes the track through the mixer, or does not.
   *
   * Nothing plays while muted, and unmuting does not start it: the preference is applied
   * to a gain node so it takes effect immediately, but a track that had been stopped
   * for being muted is not resumed by unticking a box. That is the accessibility
   * decision this repo already made for `muteAll`, applied to the one new thing that
   * makes sound.
   */
  setMuted(muted: boolean): void {
    this._muted = muted;
    this._rebuildPlayback();
  }

  private _wasSilent(): boolean {
    return this._config.silentPlayback || this._muted;
  }

  private _rebuildPlayback(): void {
    if (!this._playing) return;
    this._stopSource();
    this._startSource();
  }

  private _startSource(): void {
    if (this._wasSilent() || !this._buffer || !this._context) return;

    try {
      const source = this._context.createBufferSource();
      source.buffer = this._buffer;
      source.loop = true;
      this._gain = this._context.createGain();
      this._gain.gain.value = 0.6;
      source.connect(this._gain).connect(this._context.destination);
      source.start(0, this._offset % Math.max(0.001, this._state.duration));
      this._source = source;
    } catch {
      // Autoplay policy, or a context in a suspended state. Analysis carries on either
      // way, which is the whole reason analysis and playback are separate.
      this._source = null;
    }
  }

  private _stopSource(): void {
    if (!this._source) return;
    try {
      this._source.stop();
    } catch {
      // Already stopped.
    }
    this._source.disconnect();
    this._gain?.disconnect();
    this._source = null;
    this._gain = null;
  }

  /** Accepts a new state wholesale. Kept for callers that drive the clock themselves. */
  updateState(updates: Partial<MediaState>): void {
    this._state = { ...this._state, ...updates };
    this._emit();
  }

  private _emit(): void {
    const snapshot = this._state;
    this._listeners.forEach((fn) => fn(snapshot));
  }

  onUpdate(listener: (state: MediaState) => void): () => void {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  }

  /** Notified on the frame a beat fires, with the beat that fired. */
  onBeat(listener: (beat: Beat) => void): () => void {
    this._beatListeners.push(listener);
    return () => {
      const idx = this._beatListeners.indexOf(listener);
      if (idx >= 0) this._beatListeners.splice(idx, 1);
    };
  }

  dispose(): void {
    this.stop();
    this._listeners = [];
    this._beatListeners = [];
    this._beats = [];
    this._envelope = new Float32Array(0);
    this._buffer = null;
    void this._context?.close();
    this._context = null;
    this._gain = null;
  }
}
