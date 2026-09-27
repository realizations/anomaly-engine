import { EventBus } from './core/EventBus.js';
import { EventScheduler } from './core/EventScheduler.js';
import { EntityManager } from './core/EntityManager.js';
import { StateManager } from './core/StateManager.js';
import { ClockSource } from './events/ClockSource.js';
import { RandomSource } from './events/RandomSource.js';
import { NetworkSource } from './events/NetworkSource.js';
import { DayNightCycle } from './renderer/DayNightCycle.js';
import { NativeBridge } from './platform/NativeBridge.js';
import { WeatherSystem } from './systems/WeatherSystem.js';
import { AstronomySystem } from './systems/AstronomySystem.js';
import { PerformanceSystem } from './systems/PerformanceSystem.js';
import { AnomalySystem } from './anomalies/AnomalyRegistry.js';
import { JournalSystem } from './systems/JournalSystem.js';
import { MomentSystem } from './systems/MomentSystem.js';
import { SecretSystem } from './systems/SecretSystem.js';
import { ParticleSystem } from './systems/ParticleSystem.js';
import { AudioSystem } from './systems/AudioSystem.js';
import { ScreenshotSystem } from './platform/ScreenshotSystem.js';
import { DebugOverlay } from './platform/DebugOverlay.js';
import { CreatorMode } from './platform/CreatorMode.js';
import { I18n } from './platform/I18n.js';
import { AccessibilitySystem } from './platform/AccessibilitySystem.js';
import { UpdateSystem } from './platform/UpdateSystem.js';
import { WorldLoader } from './worlds/WorldLoader.js';

class Engine {
  private _bus: EventBus;
  private _scheduler: EventScheduler;
  private _entities: EntityManager;
  private _state: StateManager;
  private _clock: ClockSource;
  private _random: RandomSource;
  private _network: NetworkSource;
  private _renderer: DayNightCycle;
  private _bridge: NativeBridge;
  private _weather: WeatherSystem;
  private _astronomy: AstronomySystem;
  private _performance: PerformanceSystem;
  private _anomalies: AnomalySystem;
  private _journal: JournalSystem;
  private _moments: MomentSystem;
  private _secrets: SecretSystem;
  private _particles: ParticleSystem;
  private _audio: AudioSystem;
  private _screenshot: ScreenshotSystem;
  private _debug: DebugOverlay;
  private _creator: CreatorMode;
  private _i18n: I18n;
  private _accessibility: AccessibilitySystem;
  public _updater: UpdateSystem;
  private _worlds: WorldLoader;
  private _canvas: HTMLCanvasElement;
  private _running = false;
  private _paused = false;
  private _frameCount = 0;
  private _lastFpsTime = 0;
  private _fps = 0;
  public _lastFrameTime = 0;

  constructor() {
    this._bus = new EventBus();
    this._scheduler = new EventScheduler(this._bus);
    this._entities = new EntityManager();
    this._state = new StateManager();
    this._clock = new ClockSource(this._bus);
    this._random = new RandomSource(this._bus);
    this._network = new NetworkSource();
    this._bridge = new NativeBridge();
    this._weather = new WeatherSystem();
    this._astronomy = new AstronomySystem(42.3, -122.7);
    this._performance = new PerformanceSystem();
    this._anomalies = new AnomalySystem();
    this._journal = new JournalSystem();
    this._moments = new MomentSystem();
    this._secrets = new SecretSystem();
    this._particles = new ParticleSystem();
    this._audio = new AudioSystem();
    this._screenshot = new ScreenshotSystem();
    this._debug = new DebugOverlay();
    this._creator = new CreatorMode();
    this._i18n = new I18n();
    this._accessibility = new AccessibilitySystem();
    this._updater = new UpdateSystem({ checkInterval: 3600, endpoint: '', autoCheck: false, allowMandatory: true }, '0.1.0');
    this._worlds = new WorldLoader();

    this._canvas = document.getElementById('wallpaper-canvas') as HTMLCanvasElement;
    this._renderer = new DayNightCycle(this._canvas);

    this._setupEventHandlers();
    this._setupBridge();
    this._setupAnomalies();
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  async start(): Promise<void> {
    if (this._running) return;
    this._running = true;

    await this._state.init();
    this._scheduler.start();
    this._clock.start();
    this._random.start();
    this._anomalies.start();
    this._astronomy.start();

    this._bus.emit({
      id: 'engine_start',
      type: 'app.started',
      timestamp: Date.now(),
      source: 'engine',
      payload: { version: '0.1.0' },
      priority: 'high',
      rarity: 'common',
      cooldown: 0,
      duration: 0,
      targetScene: 'main',
      seed: Date.now(),
      metadata: {},
    });

    this._loop();
  }

  stop(): void {
    this._running = false;
    this._scheduler.stop();
    this._clock.stop();
    this._random.stop();
    this._anomalies.stop();
    this._astronomy.stop();
    this._weather.stop();
  }

  pause(): void {
    this._paused = true;
    this._entities.pause();
  }

  resume(): void {
    this._paused = false;
    this._entities.resume();
  }

  private _loop(): void {
    if (!this._running) return;

    const frameStart = performance.now();

    if (!this._paused) {
      const now = new Date();
      this._renderer.render(now);
      this._particles.update(16);
      this._particles.render(this._canvas.getContext('2d')!, this._canvas.width, this._canvas.height);
      this._entities.update(16);
      this._updateFps();
    }

    const frameTime = performance.now() - frameStart;
    this._lastFrameTime = frameTime;
    this._performance.update(frameTime);

    requestAnimationFrame(() => this._loop());
  }

  private _updateFps(): void {
    this._frameCount++;
    const now = performance.now();
    if (now - this._lastFpsTime >= 1000) {
      this._fps = this._frameCount;
      this._frameCount = 0;
      this._lastFpsTime = now;
    }
  }

  private _setupEventHandlers(): void {
    this._bus.subscribe('random.meteor', () => {
      this._renderer.triggerShootingStar();
      this._particles.start('meteor');
      setTimeout(() => this._particles.stop(), 2000);
    });

    this._bus.subscribe('time.midnight', () => {
      this._particles.start('fireflies');
    });

    this._bus.subscribe('time.sunrise', () => {
      this._particles.stop();
    });

    this._bus.subscribe('*', (event) => {
      this._bridge.sendLog(`event:${event.type}`, event.payload);
      this._state.addEventToHistory(event);
    });

    this._anomalies.onTrigger((anomaly) => {
      this._journal.addEntry({
        id: `journal_${Date.now()}`,
        timestamp: Date.now(),
        anomalyId: anomaly.definition.id,
        anomalyName: anomaly.definition.name,
        rarity: anomaly.definition.rarity,
        location: 'unknown',
        notes: '',
        state: 'observed',
        clues: [],
      });
    });

    this._network.onStatusChange((online) => {
      this._bus.emit({
        id: `network_${online ? 'online' : 'offline'}`,
        type: online ? 'network.online' : 'network.offline',
        timestamp: Date.now(),
        source: 'network',
        payload: { online },
        priority: 'normal',
        rarity: 'common',
        cooldown: 0,
        duration: 0,
        targetScene: 'main',
        seed: Date.now(),
        metadata: {},
      });
    });
  }

  private _setupBridge(): void {
    window.addEventListener('anomaly:pause', () => this.pause());
    window.addEventListener('anomaly:resume', () => this.resume());

    this._bridge.onMessage((msg) => {
      if (msg.type === 'pause') this.pause();
      if (msg.type === 'resume') this.resume();
    });
  }

  private _setupAnomalies(): void {
    this._anomalies.register({
      id: 'second-moon',
      name: 'Second Moon',
      description: 'A second moon appears in the sky for 8 seconds.',
      category: 'cosmic',
      rarity: 'very_rare',
      cooldown: 86400,
      duration: 8,
      effects: [{ type: 'spawn', target: 'moon', params: { count: 2 } }],
    });

    this._anomalies.register({
      id: 'forest-watcher',
      name: 'Watcher in the Pines',
      description: 'Something moves between the trees.',
      category: 'behavioral',
      rarity: 'very_rare',
      cooldown: 43200,
      duration: 12,
      effects: [{ type: 'spawn', target: 'creature', params: { type: 'shadow' } }],
    });

    this._anomalies.register({
      id: 'observatory-signal',
      name: 'Observatory Signal',
      description: 'The observatory sends a signal into the void.',
      category: 'cosmic',
      rarity: 'rare',
      cooldown: 14400,
      duration: 30,
      effects: [{ type: 'light', target: 'observatory', params: { color: 'red' } }],
    });

    this._anomalies.register({
      id: 'red-moon',
      name: 'Red Moon',
      description: 'The moon turns red.',
      category: 'cosmic',
      rarity: 'legendary',
      cooldown: 604800,
      duration: 300,
      effects: [{ type: 'transform', target: 'moon', params: { color: 'red' } }],
    });
  }

  private _resize(): void {
    this._canvas.width = window.screen.width;
    this._canvas.height = window.screen.height;
  }

  getFps(): number { return this._fps; }
  getBus(): EventBus { return this._bus; }
  getEntities(): EntityManager { return this._entities; }
  getState(): StateManager { return this._state; }
  getAnomalies(): AnomalySystem { return this._anomalies; }
  getJournal(): JournalSystem { return this._journal; }
  getMoments(): MomentSystem { return this._moments; }
  getSecrets(): SecretSystem { return this._secrets; }
  getParticles(): ParticleSystem { return this._particles; }
  getAudio(): AudioSystem { return this._audio; }
  getScreenshot(): ScreenshotSystem { return this._screenshot; }
  getDebug(): DebugOverlay { return this._debug; }
  getCreator(): CreatorMode { return this._creator; }
  getI18n(): I18n { return this._i18n; }
  getAccessibility(): AccessibilitySystem { return this._accessibility; }
  getPerformance(): PerformanceSystem { return this._performance; }
  getWorlds(): WorldLoader { return this._worlds; }
  getWeather(): WeatherSystem { return this._weather; }
  getAstronomy(): AstronomySystem { return this._astronomy; }
  getNetwork(): NetworkSource { return this._network; }
}

const engine = new Engine();
engine.start();

(window as any).__engine = engine;
