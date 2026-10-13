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
import { WeatherSystem, type WeatherData } from './systems/WeatherSystem.js';
import { DEFAULT_LOCATION, type Location } from './systems/LocalWeather.js';
import { AstronomySystem, type AstronomyData } from './systems/AstronomySystem.js';
import { PerformanceSystem } from './systems/PerformanceSystem.js';
import { AnomalySystem } from './anomalies/AnomalyRegistry.js';
import { BUILT_IN_ANOMALIES } from './anomalies/builtin.js';
import { flavorFor } from './anomalies/worldFlavor.js';
import { JournalSystem, type JournalEntry } from './systems/JournalSystem.js';
import { MomentSystem } from './systems/MomentSystem.js';
import { SecretSystem } from './systems/SecretSystem.js';
import { ParticleSystem, type ParticleEffect } from './systems/ParticleSystem.js';
import { AudioSystem } from './systems/AudioSystem.js';
import { ScreenshotSystem } from './platform/ScreenshotSystem.js';
import { DebugOverlay } from './platform/DebugOverlay.js';
import { FieldNotes } from './platform/FieldNotes.js';
import { CreatorMode } from './platform/CreatorMode.js';
import { I18n } from './platform/I18n.js';
import { AccessibilitySystem } from './platform/AccessibilitySystem.js';
import { UpdateSystem } from './platform/UpdateSystem.js';
import { WorldLoader } from './worlds/WorldLoader.js';
import { EasterEggSystem } from './systems/EasterEggSystem.js';
import { InteractionSystem } from './platform/InteractionSystem.js';
import { MediaReactivitySystem } from './systems/MediaReactivity.js';
import { BenchmarkSystem } from './systems/BenchmarkSystem.js';
import { WINDOW_EVENTS } from './core/windowEvents.js';
import { describeZones } from './systems/landmarkZones.js';
import { EGG_EFFECTS } from './systems/eggEffects.js';
import { advanceStreak, INITIAL_STREAK, type StreakState } from './systems/staringStreak.js';
import { dateKey as dateKeyOf } from './events/ClockSource.js';
import type { StoryBeat } from './renderer/storyBeat.js';

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
  private _easterEggs: EasterEggSystem;
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
    this._astronomy = new AstronomySystem(weatherLocation.lat, weatherLocation.lon);
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
    // Language first, before anything renders. The three surfaces that put text on
    // screen -- the field notes, the creator panel and the zone hints -- are handed the
    // translator here rather than reading a locale themselves, so a switch later in the
    // session reaches all three.
    this._applyLocale(this._i18n.detect(browserLanguages()));
    this._accessibility = new AccessibilitySystem();
    this._updater = new UpdateSystem({ checkInterval: 3600, endpoint: '', autoCheck: false, allowMandatory: true }, '0.1.0');
    this._worlds = new WorldLoader();
    this._easterEggs = new EasterEggSystem();
    this._interaction = new InteractionSystem();
    this._media = new MediaReactivitySystem();
    this._benchmark = new BenchmarkSystem();
    // A dev build says so on the terminal, once, when there is someone to say it to.
    // The egg existed with a trigger nothing could produce; this is the producer, and
    // it is gated on a build flag so it cannot reach a shipped install.
    this._maybeDevBuildEgg();

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

    window.addEventListener(WINDOW_EVENTS.state, (e) => {
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
    // And the zones, for the same reason: they are derived from the active world's
    // geometry, so they cannot be built before there is a world to read.
    this._rebuildZones();
    this._worlds.onChange((id) => {
      const w = id ? this._worlds.get(id) : null;
      if (!w) return;
      this._renderer.setWorld(w);
      // Zones are scene geometry, so they have to be rebuilt whenever the scene
      // changes. A world with no landmarks -- the interior -- yields no zones, and
      // that is a normal state rather than an error.
      this._rebuildZones();
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
    // `onUpdate` had no subscribers for the whole life of this file, so the system
    // recomputed the sky once a minute and threw every reading away. It is what tells
    // the debug overlay and the status document what time it is and how bright the moon
    // is, and both of those come from the ephemeris rather than from the wall clock.
    this._astronomy.onUpdate((d) => {
      this._sky = d;
      this._bridge.sendLog(`sky:${d.moonPhase > 0.45 && d.moonPhase < 0.55 ? 'full' : 'phase'}`, {
        moonPhase: d.moonPhase,
        moonIllumination: d.moonIllumination,
        sunrise: d.sunrise?.toISOString() ?? null,
        sunset: d.sunset?.toISOString() ?? null,
      });
    });
    // WeatherSystem was never started, so the renderer never received live weather and
    // the world stayed permanently "clear". It is started, and it no longer needs a
    // provider: `WeatherSystem` falls back to the local model, which is what the
    // settings window and the documentation have always described.
    this._weather.start(weatherLocation.lat, weatherLocation.lon);

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

  /**
   * Stops the engine and releases everything it holds.
   *
   * The distinction between `stop` and `dispose` was missing here, and it was missing
   * everywhere: nothing ever called `dispose` on any of the systems this constructs, so
   * `stop()` cleared six intervals and left every other timer, listener and DOM node
   * alive. For a wallpaper that is invisible until the user toggles pause a few hundred
   * times, at which point there are several hundred live intervals driving a scene that
   * is supposed to be still.
   *
   * `stop` is now the reversible half -- it can be followed by `start` -- and `dispose`
   * is the terminal one. `dispose` calls `stop` first, so a caller that only ever wants
   * to stop does not have to remember which is which.
   */
  stop(): void {
    if (!this._running) {
      // Still tear down the non-interval resources: a caller may be disposing after a
      // failed start, where `_running` was never set.
      this._releaseResources();
      return;
    }
    this._running = false;
    this._scheduler.stop();
    this._clock.stop();
    this._random.stop();
    this._anomalies.stop();
    this._astronomy.stop();
    this._weather.stop();
    this._particles.stop();
    this._debug.toggle();
  }

  /** Terminal teardown. After this the engine cannot be restarted. */
  dispose(): void {
    this.stop();
    this._releaseResources();
  }

  /**
   * Releases the resources that survive a stop.
   *
   * Grouped rather than inlined so `stop` and `dispose` release exactly the same set.
   * Two lists that drift apart is the bug this shape exists to prevent.
   */
  private _releaseResources(): void {
    this._notes.dispose();
    this._creator.dispose();
    this._debug.dispose();
    this._screenshot.dispose();
    this._interaction.dispose();
    this._secrets.dispose();
    this._journal.dispose();
    this._moments.dispose();
    this._benchmark.dispose();
    this._particles.dispose();
    this._entities.dispose();
    this._worlds.dispose();
    this._weather.dispose();
    this._astronomy.dispose();
    this._anomalies.dispose();
    this._audio.dispose();
    this._media.dispose();
    this._i18n.dispose();
    this._accessibility.dispose();
    this._performance.dispose();
    this._state.dispose();
    this._updater.dispose();
    this._easterEggs.dispose();
    this._network.dispose();
    this._persistence?.dispose();
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

      // The date handed to the renderer is the simulated hour when one is set, and
      // the real clock otherwise.
      //
      // This used to read a `WorldClock` here and add its drift, freeze or glitch
      // offset to the base date. `setMode` and `setDriftRate` had no callers, so the
      // clock's mode was permanently 'normal' and the whole branch was unreachable --
      // while the clock itself ticked a once-a-second interval forever, computing a
      // world time that nothing displayed. The clock is gone.
      //
      // What it was reaching for already ships, and is measured: the `clock-lie` story
      // beat moves the hour the renderer draws by up to 173 minutes, fires on the
      // three-nights-at-03:33 egg, and is proven to change real pixels by
      // tools/story-beats.mjs. A second, unreachable mechanism for the same effect is
      // worse than one that works.
      this._renderer.render(this._simDate ?? new Date());
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
      this._pushDebugOverlay();
    }
  }

  /**
   * Feeds the debug overlay.
   *
   * `DebugOverlay.update` was never called from anywhere, so the overlay opened and
   * rendered its own hardcoded defaults -- `FPS: 0`, `WebView: unknown` -- and README.md
   * advertised it as reporting frame time, memory and render scale. Every number the
   * engine already computed is here; the overlay was simply not being told.
   *
   * Pushed once a second rather than once a frame: the overlay repaints on its own
   * 100 ms timer, and building this object per frame to be thrown away sixty times a
   * second would cost more than the thing being measured.
   *
   * Called even when the overlay is hidden, because `show` may be called at any moment
   * and a panel that fills in over a second looks broken.
   */
  private _pushDebugOverlay(): void {
    const w = this._lastWeather;
    const sky = this._sky;
    const eggs = this._easterEggs.getProgress();
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;

    this._debug.update({
      fps: this._fps,
      frameTime: this._lastFrameTime,
      memoryMB: mem ? mem.usedJSHeapSize / 1048576 : 0,
      renderScale: this._renderer.getRenderScale(),
      particleCount: this._particles.getParticleCount(),
      activeScene: this._worlds.getActive()?.name ?? 'none',
      worldTime: this._effectiveDate().toLocaleTimeString(),
      eventQueueLength: this._scheduler.size,
      activeEffects: (() => {
        const beat = this._renderer.getActiveStoryBeat();
        return beat ? [beat.beat.kind] : [];
      })(),

      weather: w?.condition ?? null,
      temperature: w?.temperature ?? null,
      windSpeed: w?.windSpeed ?? null,
      humidity: w?.humidity ?? null,
      regime: this._lastRegime,

      sunAltitude: sky?.sunAltitude ?? null,
      moonAltitude: sky?.moonAltitude ?? null,
      moonPhase: sky?.moonPhase ?? null,
      moonIllumination: sky?.moonIllumination ?? null,
      isNight: sky?.isNight ?? null,

      anomaliesSeen: this._anomalies.getDefinitions().length,
      journalCount: this._journal.getEntries().length,
      secretsFound: this._secrets.getDiscovered().length,
      secretsTotal: this._secrets.getProgress().total,
      eggsFound: eggs.discovered,
      eggsTotal: eggs.total,

      style: this._renderer.getStyle(),
      locale: this._i18n.getLocale().code,
      running: this._running,
    });
  }

  private _setupEventHandlers(): void {
    // Weather arrives every ten minutes from either a provider or the local model.
    //
    // This handler used to discard most of what it was given: it hardcoded `intensity`
    // to 0.2 or 0.6 from the condition alone, threw away temperature, humidity,
    // pressure, visibility and uvIndex, and produced a wind direction with `Math.sign`,
    // which turns 270 degrees into 1 and 90 degrees into 1 -- so the wind blew the same
    // way regardless of which way it was coming from. The model computes all of it.
    // Subscribed once, outside `onUpdate`. Registering an error handler inside the
    // update handler would add one per weather reading -- ten an hour, forever.
    this._weather.onError((err) => {
      this._bridge.sendLog('weather:error', { error: err.message });
    });

    this._weather.onUpdate((w) => {
      this._applyWeather(w);

      this._bus.emit({
        id: `weather_${w.condition}_${Date.now()}`,
        type: `weather.${w.condition}`,
        timestamp: Date.now(),
        source: 'weather',
        payload: {
          temperature: w.temperature,
          windSpeed: w.windSpeed,
          humidity: w.humidity,
          pressure: w.pressure,
          visibility: w.visibility,
        },
        priority: 'normal',
        rarity: 'common',
        cooldown: 0,
        duration: 0,
        targetScene: 'main',
        seed: Date.now(),
        metadata: {},
      });

      // Precipitation and drifting fog are drawn by the particle layer, which is a
      // separate system from the renderer. Previously only 'fireflies' was ever
      // started, so rain, snow, leaves and fog were reachable types with no way to ask
      // for them.
      this._syncWeatherParticles(w);
    });

    this._bus.subscribe('random.meteor', () => {
      this._renderer.triggerShootingStar();
      this._pushAnomaly('meteor', 3.2, 1);
      // A trail of sparks at the strike point, not just the flash. The particle type
      // existed and had no producer, which is the same gap as the weather particles.
      this._burstParticles('meteor');
    });

    this._bus.subscribe('time.midnight', () => {
      this._particles.start('fireflies');
    });

    this._bus.subscribe('time.0333', () => {
      this._fireAnomaly('observatory-signal', 26, 1);
      this._noteStaringNight();
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

    // Lightning is driven by the renderer from the weather state it already has,
    // rather than from here. This used to subscribe to `weather.storm_started`,
    // which nothing has ever emitted, so `triggerLightning` had no caller at all and
    // storms rendered without a single flash despite the bolt renderer sitting
    // right there. The renderer owns it now, which also puts the strike rate under
    // the same motion-intensity control as everything else that moves.

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
    window.addEventListener(WINDOW_EVENTS.pause, () => this.pause());
    window.addEventListener(WINDOW_EVENTS.resume, () => this.resume());
    window.addEventListener(WINDOW_EVENTS.style, (e) => {
      const detail = (e as CustomEvent<{ style?: string }>).detail;
      const style = detail?.style;
      if (style === 'painterly' || style === 'flat' || style === 'riso') this.setStyle(style);
    });
    // The wallpaper never holds keyboard focus, so window key listeners never
    // fire in the real host. Debug/creator toggles are driven from the tray.
    window.addEventListener(WINDOW_EVENTS.debug, () => this._debug.toggle());
    window.addEventListener(WINDOW_EVENTS.creator, () => this._creator.enable());
    window.addEventListener(WINDOW_EVENTS.world, (e) => {
      const detail = (e as CustomEvent<{ world?: string }>).detail;
      if (detail?.world) this.setWorld(detail.world);
    });
    window.addEventListener(WINDOW_EVENTS.worldNext, () => this.nextWorld());
    window.addEventListener(WINDOW_EVENTS.worldPrev, () => {
      this._worlds.previous();
    });

    // The host reports the real monitor layout, because the browser's
    // `window.screen` describes the primary display only and knows nothing
    // about the others attached to this machine.
    window.addEventListener(WINDOW_EVENTS.monitors, (e) => {
      const detail = (e as CustomEvent<{ monitors?: MonitorReport[] }>).detail;
      if (Array.isArray(detail?.monitors)) this._resize(detail.monitors);
    });
    window.addEventListener(WINDOW_EVENTS.worlds, (e) => {
      const detail = (e as CustomEvent<{ worlds?: unknown[] }>).detail;
      if (Array.isArray(detail?.worlds) && detail.worlds.length) {
        const v = this._worlds.registerAll(detail.worlds);
        if (!v.valid) this._bridge.sendLog('worlds:invalid', { errors: v.errors });
      }
    });
    window.addEventListener(WINDOW_EVENTS.worldRemove, (e) => {
      const id = (e as CustomEvent<{ world?: string }>).detail?.world;
      if (id) this.removeWorld(id);
    });
    window.addEventListener(WINDOW_EVENTS.reducedMotion, (e) => {
      const on = !!(e as CustomEvent<{ on?: boolean }>).detail?.on;
      this._accessibility.setConfig({ reducedMotion: on });
    });
    window.addEventListener(WINDOW_EVENTS.trigger, () => this.triggerRandomAnomaly());
    window.addEventListener(WINDOW_EVENTS.notes, () => this.toggleFieldNotes());
    window.addEventListener(WINDOW_EVENTS.locale, (e) => {
      const code = (e as CustomEvent<{ locale?: string }>).detail?.locale;
      if (typeof code !== 'string' || !code) return;
      // A rejected code is logged by `_applyLocale` returning false; it deliberately
      // leaves the current language in place rather than resetting to English.
      this._applyLocale(code);
    });

    // Creator mode drives the world by dispatching events rather than by holding a
    // reference to the engine, which is the right shape for a panel that can be
    // opened and closed independently. But it dispatches five of them, and nothing
    // was listening for any of the five: Set Time, Set Weather, Reload World,
    // Trigger Event and Screenshot were all buttons that did nothing at all when
    // clicked. The creator panel is reachable from the tray and Ctrl+Alt+C, so this
    // was five dead controls in a shipping feature.
    window.addEventListener(WINDOW_EVENTS.setTime, (e) => {
      const d = (e as CustomEvent<{ hour?: number; minute?: number }>).detail;
      const h = Number(d?.hour);
      const m = Number(d?.minute);
      if (!Number.isFinite(h)) return;
      // setSimulatedHour takes a decimal hour, so the minute part has to be folded in.
      this.setSimulatedHour(h + (Number.isFinite(m) ? Math.max(0, Math.min(59, m)) / 60 : 0));
    });
    window.addEventListener(WINDOW_EVENTS.setWeather, (e) => {
      const condition = (e as CustomEvent<{ condition?: string }>).detail?.condition;
      if (typeof condition === 'string' && condition) this.setSimulatedWeather(condition);
    });
    window.addEventListener(WINDOW_EVENTS.reloadWorld, () => {
      // Re-activating the active world is what a reload is here: the renderer
      // rebuilds the scene from the definition rather than swapping to a different
      // one, which is what you want when you are iterating on the current world.
      const id = this._worlds.getActiveId();
      if (id) this.setWorld(id);
    });
    window.addEventListener(WINDOW_EVENTS.triggerEvent, (e) => {
      const eventId = (e as CustomEvent<{ eventId?: string }>).detail?.eventId;
      if (typeof eventId !== 'string' || !eventId) return;
      // By event id rather than by kind, because that is what the panel collects.
      // Subscribers are keyed on the type, so a typed event is what reaches them;
      // an unknown id simply falls through to the log and the history.
      this._bus.emit({
        id: `creator_${eventId}_${Date.now()}`,
        type: eventId,
        timestamp: Date.now(),
        source: 'system',
        payload: { triggeredBy: 'creator' },
        priority: 'normal',
        rarity: 'common',
        cooldown: 0,
        duration: 0,
        targetScene: 'main',
        seed: Date.now(),
        metadata: {},
      });
    });
    window.addEventListener(WINDOW_EVENTS.screenshot, () => {
      void this._screenshot.saveToFile();
    });
    window.addEventListener(WINDOW_EVENTS.tripleClick, (e) => {
      const zoneId = (e as CustomEvent<{ zoneId?: string }>).detail?.zoneId;
      if (typeof zoneId !== 'string' || !zoneId) return;
      // The zone carries its own trigger, so the mapping from "what was clicked" to
      // "what that means" stays in one table rather than in a switch here.
      const desc = describeZones(
        this._renderer.getInteractionSurfaces(this._effectiveDate()),
        this._i18n.translator()
      ).find(
        (z) => z.id === zoneId
      );
      if (desc?.trigger) this._tryDiscover(desc.trigger);
    });

    this._bridge.onMessage((msg) => {
      if (msg.type === 'pause') this.pause();
      if (msg.type === 'resume') this.resume();
    });
  }

  private _setupAnomalies(): void {
    for (const definition of BUILT_IN_ANOMALIES) this._anomalies.register(definition);
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

  /**
   * Pushes a weather reading into the renderer, scaled to what it expects.
   *
   * The renderer wants three 0..1 fractions and a direction it can rotate by. Two
   * conversions happen here and are deliberately explicit, because guessing either one
   * is how a 270-degree wind ends up blowing from the east:
   *
   *   - `windSpeed` arrives in metres per second. Twelve is a storm.
   *   - `windDirection` arrives in degrees, which is already the unit the renderer
   *     wants, so it is normalised into 0..1 rather than passed raw.
   */
  private _applyWeather(w: WeatherData): void {
    this._renderer.setWeather({
      condition: w.condition,
      // A clear sky is not a zero. Intensity is "how strongly the condition shows",
      // and a cloudless sky shows its condition very strongly.
      intensity: w.condition === 'clear' ? 0 : clamp01(0.25 + w.condition.length / 20),
      windSpeed: clamp01(w.windSpeed / 12),
      windDirection: ((w.windDirection % 360) + 360) % 360 / 360,
    });
    this._lastWeather = w;
    // The synoptic regime is a local-model concept; a provider has no equivalent, so
    // it is only recorded when the local model produced the reading.
    const simulated = w.regime;
    this._lastRegime = typeof simulated === 'string' ? simulated : null;
  }

  private _lastWeather: WeatherData | null = null;

  /**
   * Starts, or stops, the particles the current weather calls for.
   *
   * Only one effect can be active at a time, so this is a small state machine rather
   * than a set of flags. Precipitation wins over fog, because rain in front of fog is
   * what you would see; leaves are a separate seasonal layer and are left to the
   * anomalies rather than the weather, so this never fights them for the slot.
   */
  private _syncWeatherParticles(w: WeatherData): void {
    const intensity = w.condition === 'clear' ? 0 : clamp01(w.windSpeed / 12);
    const want =
      w.condition === 'rain' || w.condition === 'storm' ? 'rain'
      : w.condition === 'snow' ? 'snow'
      : w.condition === 'fog' ? 'fog'
      : null;

    if (want === this._weatherParticle) {
      // Already in this state. The count still follows the intensity, so a storm that
      // strengthens gets denser rather than looking identical to a shower.
      if (want) this._particles.setMaxParticles(particleBudget(want, intensity));
      return;
    }
    this._weatherParticle = want;
    if (want) {
      this._particles.start(want);
      this._particles.setMaxParticles(particleBudget(want, intensity));
    } else {
      // `stop` leaves existing particles alive so they can finish falling; `clear`
      // would make rain vanish mid-air on the frame the sky clears.
      this._particles.stop();
    }
  }

  /**
   * Drifting leaves, for the worlds and months that have them.
   *
   * The only remaining particle type with no producer. Leaves are a property of the
   * place and the season rather than of the weather, so they are keyed on the biome
   * and the month, and they run only when the weather has not already claimed the slot
   * -- a fine day under a deciduous canopy is exactly when they should be moving, and a
   * day when it is raining is not.
   */
  private _applySeasonalParticles(): void {
    if (this._weatherParticle) return;
    const biome = this._worlds.getActive()?.biome;
    if (biome !== 'temperate-forest') return;

    const month = this._effectiveDate().getMonth();
    // Northern-hemisphere autumn; the shipped temperate world is in the northern one,
    // and a world placed in the south would need the same inversion the weather model
    // applies to its seasons.
    const autumnal = month >= 8 && month <= 10;
    if (!autumnal) {
      if (this._weatherParticle === 'leaves') this._particles.stop();
      this._weatherParticle = null;
      return;
    }

    this._weatherParticle = 'leaves';
    this._particles.start('leaves');
    this._particles.setMaxParticles(particleBudget('leaves', 0.6));
  }

  private _weatherParticle: ParticleEffect | null = null;

  /**
   * Adds particles for a moment without claiming the weather's slot.
   *
   * `_syncWeatherParticles` owns the single active effect because weather is continuous
   * and precipitation should not be interrupted. An anomaly is the opposite: it is
   * brief and specific, and stopping the rain to show it would be worse than overlaying
   * it. So a burst is additive, which is why `ParticleSystem.burst` exists as a
   * separate entry point rather than the caller juggling `start`.
   */
  private _burstParticles(effect: ParticleEffect, count = 30): void {
    this._particles.burst(effect, count);
  }

  /** The most recent weather, for the debug overlay and the settings status document. */
  getLastWeather(): WeatherData | null {
    return this._lastWeather;
  }

  /**
   * Switches the interface language and rebuilds everything that renders text.
   *
   * Returns whether the locale was one we ship, so a caller -- and a test -- can tell a
   * rejected code from an accepted one. An unknown code leaves the current language
   * alone rather than falling back to English, because a mistyped `anomaly:locale` from
   * the host should not silently reset someone's interface.
   *
   * `this._notes.useTranslator` and `this._creator.useTranslator` both re-render when a
   * panel is already open, so the change is visible without closing and reopening.
   */
  private _applyLocale(code: string): boolean {
    if (!this._i18n.setLocale(code)) return false;
    const translator = this._i18n;
    this._notes.useTranslator(translator);
    this._creator.useTranslator(translator);
    // Zones carry a translated hint, so they are rebuilt rather than re-labelled. Not on
    // the boot path, though: the first `_applyLocale` runs while the constructor is
    // still building, and there is no renderer yet to ask for surfaces. The zones built
    // later by `_rebuildZones` pick the current language up on their own, so skipping
    // here loses nothing.
    if (this._renderer) this._rebuildZones();
    this._bridge.sendLog(`locale:changed:${code}`, { locale: code });
    return true;
  }

  /** The available interface languages, for a host that wants to offer a choice. */
  getAvailableLocales(): { code: string; name: string }[] {
    return this._i18n.getAvailableLocales().map((l) => ({ code: l.code, name: l.name }));
  }
  getAccessibility(): AccessibilitySystem { return this._accessibility; }
  getPerformance(): PerformanceSystem { return this._performance; }
  getWorlds(): WorldLoader { return this._worlds; }
  getWeather(): WeatherSystem { return this._weather; }
  getAstronomy(): AstronomySystem { return this._astronomy; }
  getNetwork(): NetworkSource { return this._network; }
  getEasterEggs(): EasterEggSystem { return this._easterEggs; }
  getInteraction(): InteractionSystem { return this._interaction; }
  getMedia(): MediaReactivitySystem { return this._media; }
  getBenchmark(): BenchmarkSystem { return this._benchmark; }

  /**
   * Fires the `dev-build-message` egg on a development build.
   *
   * The egg shipped in `EasterEggSystem` with a trigger nothing produced: the only way
   * to reach it was `discoverEgg('dev-build')`, which is the escape hatch the
   * verification tools use. So it passed every table check -- the egg had an effect, the
   * effect had a beat, the beat was tested -- while being unreachable by any human in
   * any build.
   *
   * `import.meta.env.DEV` is true for `vite dev` and false for `vite build`, which is
   * the distinction that matters: the joke is "you were not supposed to see this", so
   * showing it in the build that ships would defeat it. Vite replaces the flag at build
   * time, so the branch is dead code in the release bundle rather than a runtime check
   * someone can flip.
   */
  private _maybeDevBuildEgg(): void {
    if (!import.meta.env.DEV) return;
    this._tryDiscover('dev-build');
  }

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
    /** The ephemeris reading: sun and moon positions, phase, and rise and set times. */
    sky: {
      sunAltitude: number;
      moonAltitude: number;
      moonPhase: number;
      moonIllumination: number;
      sunrise: string | null;
      sunset: string | null;
      moonrise: string | null;
      moonset: string | null;
      isNight: boolean;
    } | null;
    /** The weather being rendered, and where it was evaluated. Null before the first tick. */
    weather: {
      condition: string;
      temperature: number;
      humidity: number;
      windSpeed: number;
      pressure: number;
      visibility: number;
      regime: string;
      /** Whether a provider supplied this reading or the local model did. */
      source: 'provider' | 'local';
    } | null;
    /** Per-phase render timings in ms, present only while profiling is on. */
    phases?: Record<string, number> | undefined;
  } {
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const w = this._lastWeather;
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
      sky: this._sky
        ? {
            sunAltitude: this._sky.sunAltitude,
            moonAltitude: this._sky.moonAltitude,
            moonPhase: this._sky.moonPhase,
            moonIllumination: this._sky.moonIllumination,
            // ISO strings rather than epoch numbers: this crosses into a C# status
            // document and into a WPF window, and a date that reads as a date is worth
            // more there than one that reads as a number.
            sunrise: this._sky.sunrise?.toISOString() ?? null,
            sunset: this._sky.sunset?.toISOString() ?? null,
            moonrise: this._sky.moonrise?.toISOString() ?? null,
            moonset: this._sky.moonset?.toISOString() ?? null,
            isNight: this._sky.isNight,
          }
        : null,
      weather: w
        ? {
            condition: w.condition,
            temperature: Math.round(w.temperature * 10) / 10,
            humidity: Math.round(w.humidity * 100) / 100,
            windSpeed: Math.round(w.windSpeed * 10) / 10,
            pressure: Math.round(w.pressure),
            visibility: Math.round(w.visibility),
            regime: this._lastRegime ?? 'unknown',
            source: this._weather.getProvider() ? 'provider' : 'local',
          }
        : null,
      phases: this._profiling ? this._renderer.getPhaseTimings() : undefined,
    };
  }

  private _lastRegime: string | null = null;

  /** The most recent ephemeris reading, or null before the first tick. */
  private _sky: AstronomyData | null = null;

  /** The sky: sun, moon, and the times each rises and sets. Null before the first tick. */
  getSky(): AstronomyData | null {
    return this._sky;
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

  /**
   * Fires a discovery by its trigger string, as the zones and the clock do.
   *
   * Public because it is the only honest way to review a beat: the verification tools
   * need to trigger one on demand, and reaching past the facade into a private static
   * does not survive minification and would bypass the discovery bookkeeping along the
   * way -- so a beat that looked correct in a screenshot could have been applied without
   * ever being recorded as found.
   *
   * Returns whether it fired. `false` means the egg was already found, or no egg has
   * that trigger.
   */
  discoverEgg(trigger: string): boolean {
    return this._tryDiscover(trigger);
  }

  /**
   * Applies a beat directly, with no discovery bookkeeping.
   *
   * The escape hatch for reviewing an effect that is *already* discovered, which is
   * most of them: a real player finds each one once, so a tool that only used
   * `discoverEgg` could never photograph the second one. It deliberately does not
   * journal, log or mark anything found.
   */
  previewStoryBeat(beat: StoryBeat): void {
    this._renderer.applyStoryBeat(beat);
  }

  /** Progress through the discoveries, for the settings window and the gate. */
  getDiscoveryProgress(): { discovered: number; total: number } {
    return this._easterEggs.getProgress();
  }

  /** The interactive zones currently registered, for the gate and for debugging. */
  getZoneIds(): string[] {
    return this._interaction.getZones().map((z) => z.id);
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

  // ---- Interaction zones and discoveries ---------------------------------------
  //
  // `InteractionSystem` and `EasterEggSystem` were both constructed, both exposed
  // through getters, and neither had a single caller. Every egg was permanently
  // undiscoverable, every `effect` string was prose nothing read, and the zone map was
  // empty. Everything below exists to give those two systems a path into the scene.
  // The egg-to-beat table lives in `systems/eggEffects.ts`, where a test can see it.

  /**
   * Rebuild the interactive zones for the current scene.
   *
   * Called on every world change. Zones are derived geometry, so a world swap invalidates
   * them; the alternative -- registering them once -- would leave the observatory's zone
   * pointing at a building that is no longer in the frame.
   */
  private _rebuildZones(): void {
    this._applySeasonalParticles();
    for (const z of this._interaction.getZones()) this._interaction.unregisterZone(z.id);
    const surfaces = this._renderer.getInteractionSurfaces(this._effectiveDate());
    for (const desc of describeZones(surfaces, this._i18n.translator())) {
      this._interaction.registerZone({
        id: desc.id,
        name: desc.name,
        x: desc.rect.x,
        y: desc.rect.y,
        width: desc.rect.width,
        height: desc.rect.height,
        cursor: desc.cursor,
        hint: desc.hint,
        dwellMs: desc.dwellMs,
        onClick: () => this._bridge.sendLog(`zones:click:${desc.id}`, { zone: desc.id }),
        onDwell: () => {
          // Whatever the zone declares, not one hard-coded zone.
          //
          // This was `desc.id === 'forest' && desc.trigger`, which meant the moon zone
          // carried `hover:moon@midnight` for the whole life of the feature and no
          // callback would ever forward it: the egg was in the table, had an effect,
          // passed every check about tables, and could not be found by anyone. The
          // zone's own `trigger` is the whole of the routing, and the table is curated
          // -- a zone with no trigger simply does not fire.
          if (desc.trigger) this._tryDiscover(desc.trigger);
        },
      });
    }
  }

  /**
   * Attempt to fire an egg by trigger string.
   *
   * Returns whether it fired, so callers that care -- and tests -- can tell a missed
   * trigger from a delivered one. `EasterEggSystem.trigger` already returns that, but
   * the effect has to be applied only on the transition, or the beat would restart on
   * every dwell tick and on every hover.
   */
  private _tryDiscover(trigger: string): boolean {
    if (!this._easterEggs.trigger(trigger)) return false;
    const egg = this._easterEggs.getAll().find((e) => e.trigger === trigger);
    const beat = egg ? EGG_EFFECTS[egg.id] : undefined;
    if (beat) {
      this._renderer.applyStoryBeat(beat);
      this._bridge.sendLog(`egg:discovered:${egg?.id ?? trigger}`, { egg: egg?.id ?? trigger });
      this._recordAnomaly(
        egg?.id ?? trigger,
        egg?.name ?? trigger,
        'rare'
      );
    }
    return true;
  }

  /**
   * Three consecutive nights at 03:33.
   *
   * The rules live in `systems/staringStreak.ts` so they can be tested; this is only the
   * wiring from the clock's payload to the egg.
   */
  private _noteStaringNight(dateKey?: string): void {
    const next = advanceStreak(this._streak, dateKey ?? dateKeyOf(new Date()));
    this._streak = next.state;
    if (next.fired) this._tryDiscover('3:33 x3');
  }

  private _streak: StreakState = INITIAL_STREAK;

  /**
   * The date the scene should be read at, honouring a simulated hour.
   *
   * Needed because a zone built against the real clock would put the moon's hover
   * region in the wrong place whenever the hour had been simulated, which is exactly
   * when someone would be looking at the sky.
   */
  private _effectiveDate(): Date {
    if (this._simDate) return this._simDate;
    const d = new Date();
    return d;
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

  /** The hour the scene is drawn at, when creator mode has pinned one. */
  private _simDate: Date | null = null;
}

/**
 * Where the weather is evaluated.
 *
 * `DEFAULT_LOCATION` rather than anything derived from the machine. A wallpaper that
 * approximates your position from an IP lookup, or reads it from a system API, is
 * disclosing something nobody asked it to, and this project has no telemetry and no
 * accounts. The value is a named constant so it is obviously a choice rather than an
 * oversight, and the same point is given to the user in the settings window.
 */
const weatherLocation: Location = DEFAULT_LOCATION;

/**
 * How many particles a weather condition is worth.
 *
 * Exported because the number is a design decision and belongs somewhere it can be
 * tested, not buried in a method that is only reached when the sky happens to rain.
 * A light shower is a few hundred; a storm is a few thousand, and the ceiling is
 * deliberately modest because each particle is a filled circle on the compositor.
 */
export function particleBudget(effect: ParticleEffect, intensity: number): number {
  const t = clamp01(intensity);
  switch (effect) {
    case 'rain': return Math.round(200 + t * 900);
    case 'snow': return Math.round(150 + t * 500);
    case 'fog': return Math.round(20 + t * 60);
    case 'fireflies': return 40;
    case 'leaves': return Math.round(20 + t * 60);
    case 'meteor': return 4;
    default: return 100;
  }
}

/**
 * The user's ordered language preferences.
 *
 * `navigator.languages` is the list; `navigator.language` is only the first entry, and
 * some hosts populate one and not the other. Read defensively because this runs at
 * module scope on a page that also has to work under `file://` in WebView2, where the
 * navigator is a real one but a reduced one.
 */
function browserLanguages(): string[] {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const list = Array.isArray(nav?.languages) ? nav.languages.filter((l) => typeof l === 'string') : [];
  const single = nav?.language;
  return typeof single === 'string' && !list.includes(single) ? [single, ...list] : list;
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
