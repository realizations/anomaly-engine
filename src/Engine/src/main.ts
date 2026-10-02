import { EventBus } from './core/EventBus.js';
import { EventScheduler } from './core/EventScheduler.js';
import { digestWorld, verifyWorld } from './worlds/digest.js';
import { clamp01, DEFAULT_MOTION_INTENSITY, REDUCED_MOTION_INTENSITY } from './renderer/motion.js';
import { setDirection } from './renderer/VisualDirection.js';
import { EntityManager } from './core/EntityManager.js';
import { StateManager } from './core/StateManager.js';
import { ClockSource } from './events/ClockSource.js';
import { RandomSource } from './events/RandomSource.js';
import { NetworkSource } from './events/NetworkSource.js';
import { WorldRenderer } from './renderer/WorldRenderer.js';
import type { AnomalyKind } from './renderer/WorldRenderer.js';
import { NativeBridge } from './platform/NativeBridge.js';
import { Persistence } from './platform/Persistence.js';
import { buildAwaySummary, summaryToTerminalLines } from './platform/AwaySummary.js';
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

/**
 * One display as the native host reports it.
 *
 * `id` is the display device path, which is what a per-display setting has to key
 * on. `x`/`y` are in virtual-desktop coordinates and may be negative.
 */
interface MonitorReport {
  id?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  primary?: boolean;
}

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
  /** The layout the host last reported, kept so a per-display world can be re-resolved. */
  private _monitors: Array<MonitorReport & { index: number }> = [];
  private _worldClock: WorldClock;
  private _easterEggs: EasterEggSystem;
  private _hotkeys: HotkeySystem;
  private _interaction: InteractionSystem;
  private _media: MediaReactivitySystem;
  private _benchmark: BenchmarkSystem;
  private _canvas: HTMLCanvasElement;
  private _running = false;
  private _paused = false;
  private _profiling = false;
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

    // Accessibility is applied here rather than where the system is constructed,
    // because it pushes settings into the renderer and the renderer does not exist
    // yet at construction time. Reduced motion reaches the canvas through the
    // motion intensity, which is the only surface that actually moves.
    this._applyAccessibility();
    this._accessibility.onConfigChange((cfg) => {
      this._renderer.setHighContrast(cfg.highContrast);
      this._applyMotionPreference();
      this._persistence?.update({ reducedMotion: cfg.reducedMotion });
    });

    // Durable state is pushed in by the host, or read from localStorage in a
    // plain browser. Restoring before the first frame means a saved world and
    // style apply without a visible switch.
    this._persistence = new Persistence(this._bridge);
    this._persistence.load();
    this._persistence.installFlushOnHide();

    // Worlds are data, not code. Imported worlds are rebuilt before any restored
    // state is applied, because a saved world id may refer to an imported world
    // and would otherwise silently fail to resolve and fall back to a built-in.
    // Then activate the default and keep the loader in sync so the tray, hotkeys
    // and persistence can all switch worlds.
    const restored = this.restoreCustomWorlds();
    if (restored.skipped.length) {
      this._bridge.sendLog('worlds:restore-skipped', { errors: restored.skipped.slice(0, 5) });
    }
    if (restored.changed.length) {
      this._bridge.sendLog('worlds:changed', { ids: restored.changed });
    }

    window.addEventListener('anomaly:state', (e) => {
      this._persistence.acceptFromHost((e as CustomEvent<unknown>).detail);
      this._applyRestoredState();
    });
    this._applyRestoredState();

    const firstWorld = this._worlds.getAll()[0];
    if (firstWorld && !this._worlds.getActiveId()) {
      this._worlds.activate(firstWorld.id);
      this._renderer.setWorld(firstWorld);
    }
    // After the world is settled, so the summary is written for the place the
    // user actually came back to.
    this._reportAbsence();
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

    // The boot line is the world's own epitaph, not a fixed string. Every world
    // carries one, and showing the right one is the first thing that says the
    // place has a history rather than a theme.
    const boot = document.getElementById('anomaly-boot');
    if (boot) {
      const world = this._worlds.getActive() ?? this._worlds.getAll()[0];
      const epitaph = world?.lore?.epitaph?.trim();
      if (epitaph) boot.textContent = epitaph;
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

    /**
   * Resolves the user's motion level against the accessibility preference.
   *
   * The user's choice wins, but reduced motion has the final say: someone who has
   * asked their operating system for less motion gets less motion regardless of
   * what the slider says, because the slider is not how they expressed it.
   */
  private _applyMotionPreference(): void {
    const reduced = this._accessibility.shouldReduceMotion();
    const wanted = this._persistence?.get().motionIntensity ?? DEFAULT_MOTION_INTENSITY;
    this._renderer.setMotionIntensity(
      reduced ? Math.min(wanted, REDUCED_MOTION_INTENSITY) : wanted
    );
    this._reflectReducedMotion(reduced);
  }

  /**
   * Reflects the reduced-motion preference in the document.
   *
   * This was previously the only thing reduced motion did: it set a class on the
   * root element, in a project with no stylesheets, so the preference had no
   * effect on the canvas at all -- the only surface that actually moves. The
   * intensity above is what makes it real; the class is kept so anything that
   * later does have a stylesheet can honour it too.
   */
  private _reflectReducedMotion(on: boolean): void {
    const root = document.documentElement;
    if (on) root.classList.add('anomaly-reduced-motion');
    else root.classList.remove('anomaly-reduced-motion');
  }

  /** Current art direction. */
  getDirection(): string {
    return this._renderer.getDirection();
  }

  /** Sets the art direction. */
  setDirection(direction: string): void {
    const d = (['depth', 'atmospheric', 'darker'] as const).find((x) => x === direction);
    if (!d) return;
    setDirection(d);
    this._renderer.setDirection(d);
    this._bridge.sendLog('direction:set', { direction });
  }

  /** Motion level, 0..1. */
  getMotionIntensity(): number {
    return this._renderer.getMotionIntensity();
  }

  /** Sets the motion level and remembers it. */
  setMotionIntensity(value: number): void {
    const clamped = clamp01(value);
    this._persistence?.update({ motionIntensity: clamped });
    this._applyMotionPreference();
    this._bridge.sendLog('motion:intensity', { value: clamped });
  }

  /** Current reduced-motion state, so settings can show it. */
  isReducedMotion(): boolean {
    return this._accessibility.shouldReduceMotion();
  }

  /**
   * Wires the accessibility preferences into the renderer.
   *
   * Reduced motion lowers the motion intensity rather than switching motion off.
   * A completely frozen scene reads as a screenshot, which is its own kind of
   * wrong; what should go is the parts that are tiring, which is what the
   * per-category responses in motion.ts are for.
   */
  private _applyAccessibility(): void {
    const cfg = this._accessibility.getConfig();
    this._renderer.setHighContrast(cfg.highContrast);
    this._applyMotionPreference();
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

    // The host reports the real monitor layout, because the browser's
    // `window.screen` describes the primary display only and knows nothing
    // about the others attached to this machine.
    window.addEventListener('anomaly:monitors', (e) => {
      const detail = (e as CustomEvent<{ monitors?: MonitorReport[] }>).detail;
      if (Array.isArray(detail?.monitors)) this._resize(detail.monitors);
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

  /**
   * Sizes the canvas to the whole virtual desktop and tells the renderer where
   * each display sits within it.
   *
   * The desktop is one continuous surface that Windows clips per monitor, so the
   * canvas spans all of them and the scene is composed once per display. That
   * gives each monitor its own composition rather than a crop of one very wide
   * viewport, which would put the focal point in the gap between two screens.
   *
   * When the host has not sent a monitor layout, this falls back to a single
   * full-screen viewport, so the engine still runs correctly in a plain browser.
   */
  private _resize(monitors?: MonitorReport[]): void {
    const layout = monitors && monitors.length > 0 ? monitors : null;

    if (!layout) {
      this._canvas.width = window.screen.width;
      this._canvas.height = window.screen.height;
      this._renderer.resize(this._canvas.width, this._canvas.height);
      this._monitors = [];
      return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const m of layout) {
      minX = Math.min(minX, m.x);
      minY = Math.min(minY, m.y);
      maxX = Math.max(maxX, m.x + m.w);
      maxY = Math.max(maxY, m.y + m.h);
    }
    this._canvas.width = maxX - minX;
    this._canvas.height = maxY - minY;

    // Remember the layout so a per-display world can be attached to it, and
    // resolve the assignments against the worlds that actually exist right now.
    this._monitors = layout.map((m, index) => ({ ...m, index }));
    const assignments = this._persistence?.get().displayWorlds ?? {};

    this._renderer.setViewports(
      layout.map((m, index) => {
        // A display with no id, or an id that matches nothing, or an id pointing
        // at a world that has since been removed, all fall back to the active
        // world. Silently compositing nothing would leave a black rectangle.
        const wanted = m.id ? assignments[m.id] : undefined;
        const world = wanted ? this._worlds.get(wanted) : null;
        // The key is omitted rather than set to undefined, because the project
        // compiles with exactOptionalPropertyTypes: an omitted key and an
        // explicit undefined are different there, and a viewport with no world
        // of its own must genuinely not have the property.
        return {
          index,
          x: m.x - minX,
          y: m.y - minY,
          w: m.w,
          h: m.h,
          // Only set when it differs, so a single-display machine and every
          // development run take exactly the path they took before.
          ...(world && world.id !== this._worlds.getActiveId() ? { world } : {}),
        };
      })
    );
  }

  /**
   * Assigns a world to one display.
   *
   * Passing null clears the assignment, so the display reverts to the active
   * world. An id for a display that is not attached is kept rather than rejected,
   * because a monitor that is currently unplugged is a normal state and the
   * assignment should still be there when it comes back.
   */
  setDisplayWorld(displayId: string | null, worldId: string | null): boolean {
    if (!displayId) return false;
    if (worldId !== null && !this._worlds.has(worldId)) return false;
    const next = { ...(this._persistence?.get().displayWorlds ?? {}) };
    if (worldId === null) delete next[displayId];
    else next[displayId] = worldId;
    this._persistence?.update({ displayWorlds: next });
    this._resize(this._monitors.length ? this._monitors : undefined);
    this._bridge.sendLog('displays:world-assigned', { displayId, worldId });
    return true;
  }

  /** Current per-display assignments, for the settings window. */
  getDisplayWorlds(): Record<string, string> {
    return { ...(this._persistence?.get().displayWorlds ?? {}) };
  }

  /** The displays the host last reported, with their stable ids. */
  getMonitors(): Array<{ id: string; x: number; y: number; w: number; h: number; primary: boolean }> {
    return this._monitors.map((m) => ({
      id: m.id ?? '',
      x: m.x, y: m.y, w: m.w, h: m.h,
      primary: m.primary === true,
    }));
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
    /** Per-phase render timings in ms, present only while profiling is on. */
    phases?: Record<string, number> | undefined;
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
      phases: this._profiling ? this._renderer.getPhaseTimings() : undefined,
    };
  }

  /** Turns render phase profiling on or off. Off by default: it is a
   *  diagnostic, and this process is expected to sit idle for hours. */
  setProfiling(on: boolean): void {
    this._profiling = on;
    this._renderer.setProfiling(on);
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
      this._persistCustomWorlds();
    }
    return { ok: v.valid, errors: v.errors, warnings: v.warnings };
  }

  removeWorld(id: string): boolean {
    const ok = this._worlds.remove(id);
    if (ok) {
      this._persistence?.update({
        worldId: this._worlds.getActiveId(),
        customWorlds: this._worlds.getCustomDefinitions(),
      });
    }
    return ok;
  }

  /**
   * Writes the current set of imported worlds into durable state, along with a
   * digest of each.
   *
   * Without this, importing a world looked like it worked and then quietly lost
   * it on the next launch, which is the worst shape a feature like this can
   * take: it appears to succeed, it survives a restart only in the sense that
   * nothing complains, and the world the user spent time writing is gone.
   *
   * The digest is what makes the restored copy trustworthy: it is recorded here,
   * when the world was first accepted, and checked when the world comes back.
   */
  private _persistCustomWorlds(): void {
    const customs = this._worlds.getCustomDefinitions();
    const digests = { ...(this._persistence?.get().worldDigests ?? {}) };
    for (const w of customs) {
      // Recorded only on first sight, so re-importing an edited world does not
      // silently overwrite the very digest that would have reported the change.
      if (!digests[w.id]) digests[w.id] = digestWorld(w);
    }
    this._persistence?.update({ customWorlds: customs, worldDigests: digests });
  }

  /**
   * Re-registers imported worlds from durable state.
   *
   * They go back through the same validation as a fresh import. The state file
   * lives somewhere a user can edit, so it is treated as untrusted input rather
   * than as something the app wrote and can therefore assume is sound. An
   * invalid entry is skipped and reported rather than aborting startup.
   */
  private restoreCustomWorlds(): { restored: number; skipped: string[]; changed: string[] } {
    const stored = this._persistence?.get().customWorlds ?? [];
    if (stored.length === 0) return { restored: 0, skipped: [], changed: [] };

    const digests = this._persistence?.get().worldDigests ?? {};

    // Checked before anything is registered, so a world that changed since it
    // was first approved is named rather than quietly re-registered.
    //
    // A changed world is still loaded. It is the user's own file and they may
    // have edited it on purpose; refusing it would be worse than reporting it.
    // What must not happen is the change going unnoticed, so it is logged under
    // its own event and the ids are exposed for the settings window to surface.
    const changed = stored
      .filter((w): w is { id: string } => !!w && typeof w === 'object' && typeof (w as { id?: unknown }).id === 'string')
      .map((w) => w.id)
      .filter((id) => !verifyWorld(stored.find((w) => (w as { id?: string })?.id === id), digests[id]));

    const v = this._worlds.registerAll(stored);
    const skipped = v.errors;
    if (v.warnings.length) this._bridge.sendLog('worlds:restore-warnings', { count: v.warnings.length });
    if (v.valid) {
      this._bridge.sendLog('worlds:restored', { count: stored.length });
    } else {
      // Partial success is normal and expected: some definitions may have been
      // hand-edited into an invalid state since. Keep the valid ones.
      this._bridge.sendLog('worlds:restore-partial', { requested: stored.length, rejected: skipped.length });
    }
    return { restored: this._worlds.getCustomDefinitions().length, skipped, changed };
  }

  /**
   * Imported worlds whose contents no longer match the digest recorded when
   * they were first imported.
   *
   * Reported rather than acted on. A world is the user's own file, so editing it
   * is legitimate; what is not acceptable is an edited world being loaded as if
   * nothing had happened.
   */
  getChangedWorlds(): string[] {
    const stored = this._persistence?.get().customWorlds ?? [];
    const digests = this._persistence?.get().worldDigests ?? {};
    return stored
      .filter((w): w is { id: string } => !!w && typeof w === 'object' && typeof (w as { id?: unknown }).id === 'string')
      .map((w) => w.id)
      .filter((id) => !verifyWorld(stored.find((w) => (w as { id?: string })?.id === id), digests[id]));
  }

  /**
   * Accepts the current contents of a world as the new baseline.
   *
   * Called when the user confirms an edit, so the change is not reported again
   * on every subsequent launch.
   */
  acceptWorldChanges(): void {
    const digests = { ...(this._persistence?.get().worldDigests ?? {}) };
    for (const w of this._worlds.getCustomDefinitions()) digests[w.id] = digestWorld(w);
    this._persistence?.update({ worldDigests: digests });
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

  /** Id of the world currently on screen. */
  getActiveWorldId(): string | null {
    return this._worlds.getActiveId();
  }

  /**
   * A summary of what is currently persisted.
   *
   * Exposed rather than the raw state object so the durable document stays an
   * implementation detail: this reports the fields that are interesting to check
   * from outside, and cannot be used to write them.
   */
  getPersistedSummary(): {
    worldId: string | null;
    journal: number;
    secrets: number;
    customWorlds: number;
  } {
    const s = this._persistence.get();
    return {
      worldId: s.worldId,
      journal: s.journal.length,
      secrets: s.secrets.length,
      customWorlds: s.customWorlds.length,
    };
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

  /**
   * Fires a discharge directly. Lightning is otherwise only reachable through
   * a storm transition, which makes it impossible to inspect on demand — and
   * the bolt is a per-frame drawing path, so being able to trigger it from a
   * tool is the only practical way to review it.
   */
  triggerLightning(): void {
    this._renderer.triggerLightning();
  }

  /** Number of displays the renderer is currently composing for. */
  getViewportCount(): number {
    return this._renderer.getViewportCount();
  }

  /** Fires the surreal near-miss event, likewise for inspection. */
  triggerSurreal(): void {
    this._renderer.triggerSurreal();
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
    this._renderer.setTerminalTelemetry(this._journal.getEntries().length, this._secrets.getDiscovered().length);
  }

  /**
   * Reports what changed while the engine was not running.
   *
   * The whole effect depends on three things being true: the gap has to be long
   * enough to have earned it, the copy has to be about the place rather than
   * about the player, and it has to be shown once and then released. A summary
   * on every launch is a notification, so short gaps report nothing at all.
   */
  private _reportAbsence(): void {
    const previous = this._persistence.getPreviousSeen();
    if (!previous) return;
    const awayMs = Date.now() - Date.parse(previous);
    // A timestamp in the future means a clock change, not a long absence.
    if (!Number.isFinite(awayMs) || awayMs <= 0) return;

    const world = this._worlds.getActive() ?? this._worlds.getAll()[0];
    if (!world) return;
    const summary = buildAwaySummary(awayMs, world, world.terrain.seed);
    if (!summary.worthShowing) return;

    const lines = summaryToTerminalLines(summary);
    this._renderer.setReturnSummary(lines);
    // The same moment is worth a log line, but only once per absence.
    this._bus.emit({
      id: `away_${Date.now()}`,
      type: 'system.absence_reported',
      timestamp: Date.now(),
      source: 'system',
      payload: { awayMs, lines: lines.length },
      priority: 'low',
      rarity: 'common',
      cooldown: 0,
      duration: 0,
      targetScene: 'main',
      seed: Date.now(),
      metadata: {},
    });
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
