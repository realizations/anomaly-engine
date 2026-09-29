import { EventBus } from './core/EventBus.js';
import { EventScheduler } from './core/EventScheduler.js';
import { EntityManager } from './core/EntityManager.js';
import { StateManager } from './core/StateManager.js';
import { ClockSource } from './events/ClockSource.js';
import { RandomSource } from './events/RandomSource.js';
import { NetworkSource } from './events/NetworkSource.js';
import { WorldRenderer } from './renderer/WorldRenderer.js';
import type { AnomalyKind } from './renderer/WorldRenderer.js';
import { NativeBridge } from './platform/NativeBridge.js';
import { Persistence } from './platform/Persistence.js';
import { WeatherSystem } from './systems/WeatherSystem.js';
import { AstronomySystem } from './systems/AstronomySystem.js';
import { PerformanceSystem } from './systems/PerformanceSystem.js';
import { AnomalySystem } from './anomalies/AnomalyRegistry.js';
import { flavorFor } from './anomalies/worldFlavor.js';
import { JournalSystem, type JournalEntry } from './systems/JournalSystem.js';
import { MomentSystem } from './systems/MomentSystem.js';
import { SecretSystem } from './systems/SecretSystem.js';
import { ParticleSystem } from './systems/ParticleSystem.js';
import { AudioSystem } from './systems/AudioSystem.js';
import { ScreenshotSystem } from './platform/ScreenshotSystem.js';
import { DebugOverlay } from './platform/DebugOverlay.js';
import { FieldNotes } from './platform/FieldNotes.js';
import { CreatorMode } from './platform/CreatorMode.js';
import { I18n } from './platform/I18n.js';
import { AccessibilitySystem } from './platform/AccessibilitySystem.js';
import { UpdateSystem } from './platform/UpdateSystem.js';
import { WorldLoader } from './worlds/WorldLoader.js';
import { WorldClock } from './systems/SelfReferential.js';
import { EasterEggSystem } from './systems/EasterEggSystem.js';
import { HotkeySystem } from './platform/HotkeySystem.js';
import { InteractionSystem } from './platform/InteractionSystem.js';
import { MediaReactivitySystem } from './systems/MediaReactivity.js';
import { BenchmarkSystem } from './systems/BenchmarkSystem.js';

class Engine {
  private _bus: EventBus;
  private _scheduler: EventScheduler;
  private _entities: EntityManager;
  private _state: StateManager;
  private _clock: ClockSource;
  private _random: RandomSource;
  private _network: NetworkSource;
  private _renderer: WorldRenderer;
  private _bridge: NativeBridge;
  private _persistence: Persistence;
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
  private _notes: FieldNotes;
  private _creator: CreatorMode;
  private _i18n: I18n;
  private _accessibility: AccessibilitySystem;
  public _updater: UpdateSystem;
  private _worlds: WorldLoader;
  private _worldClock: WorldClock;
  private _easterEggs: EasterEggSystem;
  private _hotkeys: HotkeySystem;
  private _interaction: InteractionSystem;
  private _media: MediaReactivitySystem;
  private _benchmark: BenchmarkSystem;
  private _canvas: HTMLCanvasElement;
  private _running = false;
  private _paused = false;
  private _frameCount = 0;
  private _lastFpsTime = 0;
  private _fps = 0;
  private _lastFrameTime = 0;
  private _fpsLimit = 0;
  private _lastRender = 0;

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
    this._notes = new FieldNotes();
    this._creator = new CreatorMode();
    this._i18n = new I18n();
    this._accessibility = new AccessibilitySystem();
    this._updater = new UpdateSystem({ checkInterval: 3600, endpoint: '', autoCheck: false, allowMandatory: true }, '0.1.0');
    this._worlds = new WorldLoader();
    this._worldClock = new WorldClock();
    this._easterEggs = new EasterEggSystem();
    this._hotkeys = new HotkeySystem();
    this._interaction = new InteractionSystem();
    this._media = new MediaReactivitySystem();
    this._benchmark = new BenchmarkSystem();

    this._canvas = document.getElementById('wallpaper-canvas') as HTMLCanvasElement;
    this._renderer = new WorldRenderer(this._canvas);

    // Durable state is pushed in by the host, or read from localStorage in a
    // plain browser. Restoring before the first frame means a saved world and
    // style apply without a visible switch.
    this._persistence = new Persistence(this._bridge);
    this._persistence.load();
    window.addEventListener('anomaly:state', (e) => {
      this._persistence.acceptFromHost((e as CustomEvent<unknown>).detail);
      this._applyRestoredState();
    });
    this._applyRestoredState();

    // Worlds are data, not code. Activate the built-in default and keep the
    // loader in sync so the tray, hotkeys and persistence can all switch worlds.
    const firstWorld = this._worlds.getAll()[0];
    if (firstWorld && !this._worlds.getActiveId()) {
      this._worlds.activate(firstWorld.id);
      this._renderer.setWorld(firstWorld);
    }
    this._worlds.onChange((id) => {
      const w = id ? this._worlds.get(id) : null;
      if (!w) return;
      this._renderer.setWorld(w);
      this._state.set('world.id', w.id);
      this._state.set('world.name', w.name);
      this._bus.emit({
        id: `world_${w.id}_${Date.now()}`,
        type: 'world.changed',
        timestamp: Date.now(),
        source: 'world',
        payload: { id: w.id, name: w.name, biome: w.biome },
        priority: 'normal',
        rarity: 'common',
        cooldown: 0,
        duration: 0,
        targetScene: 'main',
        seed: Date.now(),
        metadata: {},
      });
    });

    this._setupEventHandlers();
    this._setupBridge();
    this._setupAnomalies();
    this._resize();
    window.addEventListener('resize', () => this._resize());

    const boot = document.getElementById('anomaly-boot');
    if (boot) {
      window.setTimeout(() => {
        boot.classList.add('gone');
        window.setTimeout(() => boot.remove(), 800);
      }, 900);
    }
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
    // WeatherSystem was never started, so the renderer never received live
    // weather and the world stayed permanently "clear".
    this._weather.start(42.3, -122.7);

    // Respect the OS reduced-motion preference: this is an ambient surface that
    // sits on the desktop for hours, so constant drift is a real accessibility
    // problem rather than a cosmetic one.
    const a11y = this._accessibility.getConfig();
    this._renderer.setMotionScale(a11y.reducedMotion ? 0.25 : 1);
    this._renderer.setHighContrast(a11y.highContrast);
    this._accessibility.onConfigChange((cfg) => {
      this._renderer.setMotionScale(cfg.reducedMotion ? 0.25 : 1);
      this._renderer.setHighContrast(cfg.highContrast);
      this._persistence?.update({ reducedMotion: cfg.reducedMotion });
    });

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
      // A wallpaper does not need to repaint at 144 Hz. Capping the frame rate is
      // the cheapest way to stop a desktop background driving a laptop fan.
      if (this._fpsLimit > 0) {
        const minFrame = 1000 / this._fpsLimit;
        if (frameStart - this._lastRender < minFrame) {
          requestAnimationFrame(() => this._loop());
          return;
        }
        this._lastRender = frameStart;
      }

      // The world clock can drift, freeze or run backward. Binding it to the
      // date handed to the renderer is what makes it visible rather than
      // bookkeeping nobody sees.
      const now = new Date();
      const simBase = this._simDate ?? now;
      const world = this._worldClock.getState();
      let display = simBase;
      if (world.mode !== 'normal') {
        const driftMs = (Date.now() - this._clockOrigin) * world.driftRate;
        display = new Date(simBase.getTime() + driftMs);
        if (world.mode === 'backward') display = new Date(simBase.getTime() - driftMs);
        if (world.mode === 'frozen') display = new Date(this._clockOrigin);
        if (world.mode === 'glitch') {
          // A short, deliberate discontinuity. This is the anomaly, so it should
          // be abrupt rather than smoothed.
          const g = Math.sin(this._frameCount * 0.37) * this._h0(0.06);
          display = new Date(display.getTime() + g * 86400000);
        }
      }

      this._renderer.render(display);
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

  private _h0(v: number): number {
    return this._worldClock.getState().glitchFrequency * v;
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
    this._weather.onUpdate((w) => {
      this._renderer.setWeather({
        condition: w.condition,
        intensity: w.condition === 'clear' ? 0.2 : 0.6,
        windSpeed: Math.min(1, w.windSpeed / 12),
        windDirection: Math.sign(w.windDirection) || 0.3,
      });
      this._bus.emit({
        id: `weather_${w.condition}_${Date.now()}`,
        type: `weather.${w.condition}`,
        timestamp: Date.now(),
        source: 'weather',
        payload: { temperature: w.temperature, windSpeed: w.windSpeed },
        priority: 'normal',
        rarity: 'common',
        cooldown: 0,
        duration: 0,
        targetScene: 'main',
        seed: Date.now(),
        metadata: {},
      });
    });

    this._bus.subscribe('random.meteor', () => {
      this._renderer.triggerShootingStar();
      this._pushAnomaly('meteor', 3.2, 1);
    });

    this._bus.subscribe('time.midnight', () => {
      this._particles.start('fireflies');
    });

    this._bus.subscribe('time.0333', () => {
      this._fireAnomaly('observatory-signal', 26, 1);
    });

    this._bus.subscribe('random.second_moon', () => {
      this._pushAnomaly('second-moon', 8, 1);
    });

    this._bus.subscribe('random.red_moon', () => {
      this._pushAnomaly('red-moon', 120, 1);
    });

    this._bus.subscribe('random.forest_creature', () => {
      this._fireAnomaly('forest-watcher', 12, 0.9);
    });

    this._bus.subscribe('random.observatory_flash', () => {
      this._fireAnomaly('observatory-signal', 18, 0.8);
    });

    this._bus.subscribe('random.lights_out', () => {
      this._fireAnomaly('lights-out', 10, 1);
    });

    this._bus.subscribe('weather.storm_started', () => {
      this._renderer.triggerLightning();
    });

    this._bus.subscribe('*', (event) => {
      this._bridge.sendLog(`event:${event.type}`, event.payload);
      this._state.addEventToHistory(event);
    });

    this._anomalies.onTrigger((anomaly) => {
      this._recordAnomaly(anomaly.definition.id, anomaly.definition.name, anomaly.definition.rarity);
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

  /**
   * Records an anomaly in the journal. Called from both the scheduled trigger
   * path and forceAnomaly, so a manually triggered anomaly is written down too.
   * Previously only the scheduled path recorded, which made the field-notes panel
   * look broken whenever an event was fired from the tray.
   */
   private _recordAnomaly(id: string, _name: string, rarity: string): void {
    // Name and note the anomaly for the world the player is actually in, so
    // the journal reads as a record of this place rather than a global effect
    // log. Falls back to the generic description when the world has no
    // specific flavour for it.
    const world = this._renderer.getWorld();
    const flavor = flavorFor(world, id);
    const entry: JournalEntry = {
      id: `journal_${Date.now()}_${id}`,
      timestamp: Date.now(),
      anomalyId: id,
      anomalyName: flavor.name,
      rarity,
      location: world.name,
      notes: flavor.note,
      state: 'observed',
      clues: [flavor.deniability],
    };
    this._journal.addEntry(entry);
    this._persistence.addJournalEntry(entry);
    this._secrets.observe(id);
  }

  private _pushAnomaly(type: AnomalyKind, duration: number, opacity: number): void {
    this._renderer.addAnomaly({
      type,
      active: true,
      opacity,
      startedAt: performance.now(),
      duration,
    });
    this._bus.emit({
      id: `anomaly_${type}_${Date.now()}`,
      type: `anomaly.${type}.began`,
      timestamp: Date.now(),
      source: 'anomaly',
      payload: { duration },
      priority: 'high',
      rarity: 'rare',
      cooldown: 0,
      duration,
      targetScene: 'main',
      seed: Date.now(),
      metadata: {},
    });
  }

  /**
   * Fires an anomaly, but only if it makes sense where the user is.
   *
   * The scheduled events fire on a timer and used to push their anomaly blindly,
   * so a forest-watcher could trigger over a salt marsh and an
   * observatory-signal over a world with no observatory. Both read as bugs
   * rather than as mysteries. Now the scheduler asks the registry for an
   * anomaly that fits the active world; if the preferred one does not fit, it
   * falls back to any anomaly that does, so switching to a sparse world never
   * leaves the user staring at a dead scene. Only when literally nothing fits
   * does the event go unused.
   */
  private _fireAnomaly(preferredId: string, duration: number, opacity: number): void {
    const world = this._renderer.getWorld();
    const chosen = this._anomalies.chooseForWorld(world, preferredId);
    if (!chosen) return;
    // The duration and opacity belong to how the event wants to feel, so they
    // carry over even when the world forces a substitution.
    this._pushAnomaly(chosen.id as AnomalyKind, duration, opacity);
  }

  private _setupBridge(): void {
    window.addEventListener('anomaly:pause', () => this.pause());
    window.addEventListener('anomaly:resume', () => this.resume());
    window.addEventListener('anomaly:style', (e) => {
      const detail = (e as CustomEvent<{ style?: string }>).detail;
      const style = detail?.style;
      if (style === 'painterly' || style === 'flat' || style === 'riso') this.setStyle(style);
    });
    // The wallpaper never holds keyboard focus, so window key listeners never
    // fire in the real host. Debug/creator toggles are driven from the tray.
    window.addEventListener('anomaly:debug', () => this._debug.toggle());
    window.addEventListener('anomaly:creator', () => this._creator.enable());
    window.addEventListener('anomaly:world', (e) => {
      const detail = (e as CustomEvent<{ world?: string }>).detail;
      if (detail?.world) this.setWorld(detail.world);
    });
    window.addEventListener('anomaly:world-next', () => this.nextWorld());
    window.addEventListener('anomaly:world-prev', () => {
      this._worlds.previous();
    });
    window.addEventListener('anomaly:worlds', (e) => {
      const detail = (e as CustomEvent<{ worlds?: unknown[] }>).detail;
      if (Array.isArray(detail?.worlds) && detail.worlds.length) {
        const v = this._worlds.registerAll(detail.worlds);
        if (!v.valid) this._bridge.sendLog('worlds:invalid', { errors: v.errors });
      }
    });
    window.addEventListener('anomaly:world-remove', (e) => {
      const id = (e as CustomEvent<{ world?: string }>).detail?.world;
      if (id) this.removeWorld(id);
    });
    window.addEventListener('anomaly:reduced-motion', (e) => {
      const on = !!(e as CustomEvent<{ on?: boolean }>).detail?.on;
      this._accessibility.setConfig({ reducedMotion: on });
    });
    window.addEventListener('anomaly:trigger', () => this.triggerRandomAnomaly());
    window.addEventListener('anomaly:notes', () => this.toggleFieldNotes());

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

    // Scoped to biomes with something to hide in. This has no business firing
    // on a salt flat or a desert, which is exactly the incoherence the user
    // spotted: "something moves between the trees" over a landscape with no
    // trees reads as a bug, not as a mystery.
    this._anomalies.register({
      id: 'forest-watcher',
      name: 'Watcher in the Pines',
      description: 'Something moves between the trees.',
      category: 'behavioral',
      rarity: 'very_rare',
      cooldown: 43200,
      duration: 12,
      biomes: ['temperate-forest'],
      effects: [{ type: 'spawn', target: 'creature', params: { type: 'shadow' } }],
    });

    // Requires an observatory, so it only fires in the two worlds that have one.
    this._anomalies.register({
      id: 'observatory-signal',
      name: 'Observatory Signal',
      description: 'The observatory sends a signal into the void.',
      category: 'cosmic',
      rarity: 'rare',
      cooldown: 14400,
      duration: 30,
      requiresStructure: 'observatory',
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

    // Registered so the journal and field notes can name it. The visual is a
    // direct renderer call rather than an effect entry, because a shooting star
    // is a one-off particle, not a persistent transform.
    this._anomalies.register({
      id: 'meteor',
      name: 'Meteor',
      description: 'Something crosses the sky quickly.',
      category: 'visual',
      rarity: 'common',
      cooldown: 3600,
      duration: 4,
      effects: [{ type: 'spawn', target: 'meteor', params: { count: 1 } }],
    });

    // Needs somewhere to be lit. The three worlds without a lit structure
    // cannot host "every light in the valley" because there is no valley and
    // no light, so this is scoped away from them.
    this._anomalies.register({
      id: 'lights-out',
      name: 'Lights Out',
      description: 'Every light in the valley goes off at once, then comes back.',
      category: 'behavioral',
      rarity: 'rare',
      cooldown: 43200,
      duration: 10,
      biomes: ['temperate-forest', 'salt-marsh', 'coast'],
      effects: [{ type: 'light', target: 'settlement', params: { state: 'off' } }],
    });
  }

  private _resize(): void {
    this._canvas.width = window.screen.width;
    this._canvas.height = window.screen.height;
    this._renderer.resize(this._canvas.width, this._canvas.height);
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
  getWorldClock(): WorldClock { return this._worldClock; }
  getEasterEggs(): EasterEggSystem { return this._easterEggs; }
  getHotkeys(): HotkeySystem { return this._hotkeys; }
  getInteraction(): InteractionSystem { return this._interaction; }
  getMedia(): MediaReactivitySystem { return this._media; }
  getBenchmark(): BenchmarkSystem { return this._benchmark; }

  setStyle(style: string): void {
    this._renderer.setStyle((style as 'painterly' | 'flat' | 'riso') ?? 'painterly');
    this._persistence?.update({ style: this._renderer.getStyle() });
  }

  getStyle(): string {
    return this._renderer.getStyle();
  }

  /** Pins the render scale, or passes null to resume automatic adaptation. */
  setRenderScale(scale: number | null): void {
    this._renderer.setRenderScale(scale);
  }

  getRenderScale(): number {
    return this._renderer.getRenderScale();
  }

  /** Live frame budget, so the settings window can show what the engine chose. */
  getQuality(): { renderScale: number; style: string; worldId: string | null } {
    return {
      renderScale: this._renderer.getRenderScale(),
      style: this._renderer.getStyle(),
      worldId: this._worlds.getActiveId(),
    };
  }

  /** Everything the settings window needs for its live readouts. */
  getStatus(): {
    fps: number;
    frameMs: number;
    memoryMB: number;
    renderScale: number;
    style: string;
    worldId: string | null;
    worldName: string;
    fpsLimit: number;
    reducedMotion: boolean;
    paused: boolean;
    journalCount: number;
    secretsFound: number;
    secretsTotal: number;
    anomalyKinds: number;
  } {
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return {
      fps: this._fps,
      frameMs: Math.round(this._lastFrameTime * 100) / 100,
      memoryMB: mem ? Math.round((mem.usedJSHeapSize / 1048576) * 10) / 10 : 0,
      renderScale: Math.round(this._renderer.getRenderScale() * 100) / 100,
      style: this._renderer.getStyle(),
      worldId: this._worlds.getActiveId(),
      worldName: this._worlds.getActive()?.name ?? 'Unknown',
      fpsLimit: this._fpsLimit,
      reducedMotion: this._accessibility.getConfig().reducedMotion,
      paused: this._paused,
      journalCount: this._journal.getEntries().length,
      secretsFound: this._secrets.getDiscovered().length,
      secretsTotal: this._secrets.getProgress().total,
      anomalyKinds: this._anomalies.getDefinitions().length,
    };
  }

  /** Caps the frame rate. 0 means unlimited. A wallpaper does not need 144 fps,
   *  and capping is the cheapest way to leave a laptop fan alone. */
  setFpsLimit(fps: number): void {
    this._fpsLimit = fps > 0 ? Math.max(1, Math.min(240, fps)) : 0;
  }

  getFpsLimit(): number {
    return this._fpsLimit;
  }

  /** Every world with its metadata, so the settings window can list them. */
  getWorldDetails(): Array<{
    id: string; name: string; biome: string; description: string;
    premise: string; structures: number; active: boolean; removable: boolean;
  }> {
    const active = this._worlds.getActiveId();
    return this._worlds.getAll().map((w) => ({
      id: w.id,
      name: w.name,
      biome: w.biome,
      description: w.description,
      premise: w.lore?.premise ?? '',
      structures: w.structures?.length ?? 0,
      active: w.id === active,
      // The first world is the fallback, so it can never be removed.
      removable: w.id !== this._worlds.getAll()[0]?.id,
    }));
  }

  /** Registers worlds supplied by the user. Returns the validation result so
   *  the window can report a rejection instead of silently doing nothing. */
  importWorlds(defs: unknown[]): { ok: boolean; errors: string[]; warnings: string[] } {
    const v = this._worlds.registerAll(defs);
    if (v.valid) {
      this._bridge.sendLog('worlds:imported', { count: defs.length });
      this._persistence?.save();
    }
    return { ok: v.valid, errors: v.errors, warnings: v.warnings };
  }

  removeWorld(id: string): boolean {
    const ok = this._worlds.remove(id);
    if (ok) this._persistence?.update({ worldId: this._worlds.getActiveId() });
    return ok;
  }

  setWorld(id: string): boolean {
    const ok = this._worlds.activate(id) !== null;
    if (ok) this._persistence?.update({ worldId: id });
    return ok;
  }

  nextWorld(): string | null {
    const w = this._worlds.next();
    return w?.id ?? null;
  }

  listWorlds(): Array<{ id: string; name: string; biome: string; description: string }> {
    return this._worlds.getAll().map((w) => ({
      id: w.id,
      name: w.name,
      biome: w.biome,
      description: w.description,
    }));
  }

  setSimulatedHour(hour: number): void {
    // A non-finite hour poisons the sky grade, and a NaN that reaches
    // createRadialGradient takes the whole render loop down with it. Clamp
    // rather than trust the caller.
    const h = Number.isFinite(hour) ? Math.max(0, Math.min(23.999, hour)) : 12;
    this._simDate = new Date();
    this._simDate.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0);
  }

  setSimulatedWeather(condition: string): void {
    this._renderer.setWeather({
      condition: (condition as 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'fog') ?? 'clear',
      intensity: condition === 'clear' ? 0 : 0.8,
      windSpeed: 0.6,
      windDirection: 0.3,
    });
  }

  forceAnomaly(type: string): void {
    const durations: Record<string, number> = {
      'second-moon': 30,
      'red-moon': 30,
      'forest-watcher': 30,
      'observatory-signal': 30,
      'meteor': 4,
      'lights-out': 10,
    };
    this._pushAnomaly(type as AnomalyKind, durations[type] ?? 10, 1);
    if (type === 'meteor') this._renderer.triggerShootingStar();
    if (type === 'lights-out') this._renderer.triggerLightning();

    // Record it, so a manually triggered anomaly is as traceable as a
    // scheduled one. Uses the registry's name and rarity when known.
    const def = this._anomalies.getDefinitions().find((d) => d.id === type);
    this._recordAnomaly(type, def?.name ?? type, def?.rarity ?? 'rare');
  }

  /** Re-applies saved preferences after the host pushes its state document. */
  private _applyRestoredState(): void {
    const s = this._persistence.get();
    if (s.worldId && this._worlds.has(s.worldId)) this._worlds.activate(s.worldId);
    if (s.style === 'painterly' || s.style === 'flat' || s.style === 'riso') {
      this._renderer.setStyle(s.style);
    }
    if (s.reducedMotion !== null) {
      this._accessibility.setConfig({ reducedMotion: s.reducedMotion });
    }
    this._journal.restore(s.journal);
    this._secrets.restore(s.secrets);
  }

  /** Toggles the field-notes panel, which surfaces the ARG layer on demand. */
  toggleFieldNotes(): void {
    const p = this._persistence?.get();
    this._notes.toggle({
      world: this._worlds.getActive(),
      journal: this._journal.getEntries(),
      secrets: this._secrets.getDiscovered(),
      secretDefinitions: this._secrets.getDefinitions(),
      sessions: p?.totalSessions ?? 0,
      firstRun: p?.firstRun ?? null,
      anomaliesSeen: this._journal.getEntries().length,
    });
  }

  /** Clears every active anomaly visual. Used by tooling and creator mode so a
   *  scene can be captured without a lingering effect from a previous test. */
  clearAnomalies(): void {
    for (const a of this._renderer.getActiveAnomalies()) this._renderer.removeAnomaly(a);
  }

  /** Fires a random registered anomaly. Used by the "Trigger Event" tray action
   *  and by creator mode; ignores cooldowns because it is a manual override. */
  triggerRandomAnomaly(): string | null {
    const defs = this._anomalies.getDefinitions();
    if (defs.length === 0) return null;
    const pick = defs[Math.floor(Math.random() * defs.length)];
    this.forceAnomaly(pick.id);
    return pick.id;
  }

  private _simDate: Date | null = null;
  private _clockOrigin = Date.now();
}

const engine = new Engine();
engine.start();

// Exposed for the verification tooling and creator mode, which drive the engine
// through the same surface the tray uses.
declare global {
  interface Window {
    __engine?: Engine;
  }
}
window.__engine = engine;
