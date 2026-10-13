export interface DebugOverlayData {
  fps: number;
  frameTime: number;
  memoryMB: number;
  activeScene: string;
  eventQueueLength: number;
  worldTime: string;
  activeEffects: string[];
  sourceStatus: Record<string, boolean>;
  webviewState: string;
  gpuInfo: string;
  monitorInfo: string;

  /* --- everything below was unreachable until the overlay was fed --- */
  /** The renderer's current buffer scale, 0..1. */
  renderScale: number;
  particleCount: number;

  /** Weather, from the local model or a provider. */
  weather: string | null;
  temperature: number | null;
  windSpeed: number | null;
  humidity: number | null;
  regime: string | null;

  /** The sky, from the ephemeris. */
  sunAltitude: number | null;
  moonAltitude: number | null;
  moonPhase: number | null;
  moonIllumination: number | null;
  isNight: boolean | null;

  anomaliesSeen: number;
  journalCount: number;
  secretsFound: number;
  secretsTotal: number;
  eggsFound: number;
  eggsTotal: number;

  style: string;
  locale: string;
  running: boolean;
}

/**
 * Defaults for every field.
 *
 * `null` rather than zero for anything that has not been measured yet. The previous
 * version defaulted the numeric fields to 0, which is a claim -- "the frame time is
 * zero" -- rather than an absence of one, and it is why the overlay read
 * `FPS: 0 | Frame: 0.0ms` for as long as it existed: `update()` was never called.
 * A dash says "not known", which is the truth and is distinguishable at a glance.
 */
const EMPTY: DebugOverlayData = {
  fps: 0,
  frameTime: 0,
  memoryMB: 0,
  activeScene: 'main',
  eventQueueLength: 0,
  worldTime: '',
  activeEffects: [],
  sourceStatus: {},
  webviewState: 'unknown',
  gpuInfo: 'unknown',
  monitorInfo: 'unknown',
  renderScale: 1,
  particleCount: 0,
  weather: null,
  temperature: null,
  windSpeed: null,
  humidity: null,
  regime: null,
  sunAltitude: null,
  moonAltitude: null,
  moonPhase: null,
  moonIllumination: null,
  isNight: null,
  anomaliesSeen: 0,
  journalCount: 0,
  secretsFound: 0,
  secretsTotal: 0,
  eggsFound: 0,
  eggsTotal: 0,
  style: '-',
  locale: '-',
  running: false,
};

export class DebugOverlay {
  private _container: HTMLElement | null = null;
  private _visible = false;
  private _updateInterval: number | null = null;
  private _data: DebugOverlayData = { ...EMPTY };

  show(): void {
    if (this._visible) return;
    this._visible = true;
    this._createContainer();
    this._startUpdating();
  }

  hide(): void {
    if (!this._visible) return;
    this._visible = false;
    this._destroyContainer();
    this._stopUpdating();
  }

  toggle(): void {
    if (this._visible) this.hide();
    else this.show();
  }

  update(data: Partial<DebugOverlayData>): void {
    this._data = { ...this._data, ...data };
    this._render();
  }

  private _createContainer(): void {
    this._container = document.createElement('div');
    this._container.id = 'anomaly-debug-overlay';
    this._container.style.cssText = `
      position: fixed;
      top: 10px;
      left: 10px;
      background: rgba(0, 0, 0, 0.85);
      color: #00ff88;
      font-family: 'Plex Mono', Consolas, monospace;
      font-size: 12px;
      padding: 12px;
      border-radius: 4px;
      z-index: 999999;
      pointer-events: none;
      min-width: 250px;
      line-height: 1.6;
    `;
    document.body.appendChild(this._container);
  }

  private _destroyContainer(): void {
    this._container?.remove();
    this._container = null;
  }

  private _startUpdating(): void {
    this._updateInterval = window.setInterval(() => this._render(), 100);
  }

  private _stopUpdating(): void {
    if (this._updateInterval !== null) {
      clearInterval(this._updateInterval);
      this._updateInterval = null;
    }
  }

  private _render(): void {
    if (!this._container) return;

    // Sections rather than one flat list. The flat version had ten equally-weighted
    // lines, which meant the two a person opening this actually wants -- why is it slow,
    // and what is it doing -- were indistinguishable from three that said "unknown".
    const L: string[] = [];
    const heading = (t: string) => {
      L.push('', `--- ${t} ---`);
    };
    const row = (k: string, v: string | number | boolean | null | undefined) => {
      L.push(`${k.padEnd(16)} ${v === null || v === undefined || v === '' ? '-' : v}`);
    };

    L.push('=== ANOMALY ENGINE ===');

    heading('Performance');
    row('FPS', this._data.fps);
    row('Frame', `${this._data.frameTime.toFixed(2)} ms`);
    row('Render scale', `${(this._data.renderScale * 100).toFixed(0)}%`);
    row('Memory', `${this._data.memoryMB.toFixed(1)} MB`);
    row('Particles', this._data.particleCount);

    heading('Scene');
    row('World', this._data.activeScene);
    row('Local time', this._data.worldTime);
    row('Event queue', this._data.eventQueueLength);
    row('Effects', this._data.activeEffects.join(', ') || 'none');

    // Weather and the sky are the two things that changed most recently and are the
    // first thing anyone suspects when the desktop looks wrong.
    heading('Sky');
    row('Condition', this._data.weather ?? '-');
    row('Temperature', this._data.temperature === null ? '-' : `${this._data.temperature} C`);
    row('Wind', this._data.windSpeed === null ? '-' : `${this._data.windSpeed} m/s`);
    row('Humidity', this._data.humidity === null ? '-' : `${Math.round(this._data.humidity * 100)}%`);
    row('Regime', this._data.regime ?? '-');
    row('Sun alt', this._data.sunAltitude === null ? '-' : `${this._data.sunAltitude.toFixed(1)} deg`);
    row('Moon alt', this._data.moonAltitude === null ? '-' : `${this._data.moonAltitude.toFixed(1)} deg`);
    row('Moon phase', this._data.moonPhase === null ? '-' : this._data.moonPhase.toFixed(3));
    row('Moon lit', this._data.moonIllumination === null ? '-' : `${Math.round(this._data.moonIllumination * 100)}%`);
    row('Night', this._data.isNight === null ? '-' : this._data.isNight ? 'yes' : 'no');

    heading('Discovery');
    row('Anomalies', `${this._data.anomaliesSeen} seen`);
    row('Journal', this._data.journalCount);
    row('Secrets', `${this._data.secretsFound}/${this._data.secretsTotal}`);
    row('Eggs', `${this._data.eggsFound}/${this._data.eggsTotal}`);

    heading('System');
    row('Style', this._data.style ?? '-');
    row('Locale', this._data.locale ?? '-');
    row('WebView', this._data.webviewState);
    row('GPU', this._data.gpuInfo);
    row('Monitor', this._data.monitorInfo);
    row('Running', this._data.running);

    if (Object.keys(this._data.sourceStatus).length > 0) {
      heading('Sources');
      for (const [source, active] of Object.entries(this._data.sourceStatus)) {
        row(source, active ? 'ON' : 'OFF');
      }
    }

    this._container.textContent = L.join('\n');
  }

  isVisible(): boolean {
    return this._visible;
  }

  dispose(): void {
    this.hide();
  }
}
