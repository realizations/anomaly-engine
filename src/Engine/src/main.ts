import { EventBus } from './core/EventBus.js';
import { EventScheduler } from './core/EventScheduler.js';
import { ClockSource } from './events/ClockSource.js';
import { RandomSource } from './events/RandomSource.js';
import { DayNightCycle } from './renderer/DayNightCycle.js';
import { NativeBridge } from './platform/NativeBridge.js';

class Engine {
  private _bus: EventBus;
  private _scheduler: EventScheduler;
  private _clock: ClockSource;
  private _random: RandomSource;
  private _renderer: DayNightCycle;
  private _bridge: NativeBridge;
  private _canvas: HTMLCanvasElement;
  private _running = false;
  private _paused = false;
  private _frameCount = 0;
  private _lastFpsTime = 0;
  private _fps = 0;

  constructor() {
    this._bus = new EventBus();
    this._scheduler = new EventScheduler(this._bus);
    this._clock = new ClockSource(this._bus);
    this._random = new RandomSource(this._bus);
    this._bridge = new NativeBridge();

    this._canvas = document.getElementById('wallpaper-canvas') as HTMLCanvasElement;
    this._renderer = new DayNightCycle(this._canvas);

    this._setupEventHandlers();
    this._setupBridge();
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  start(): void {
    if (this._running) return;
    this._running = true;

    this._scheduler.start();
    this._clock.start();
    this._random.start();

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
  }

  pause(): void {
    this._paused = true;
  }

  resume(): void {
    this._paused = false;
  }

  private _loop(): void {
    if (!this._running) return;

    if (!this._paused) {
      this._renderer.render(new Date());
      this._updateFps();
    }

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
    });

    this._bus.subscribe('*', (event) => {
      this._bridge.sendLog(`event:${event.type}`, event.payload);
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

  private _resize(): void {
    this._canvas.width = window.screen.width;
    this._canvas.height = window.screen.height;
  }

  getFps(): number {
    return this._fps;
  }

  getBus(): EventBus {
    return this._bus;
  }
}

const engine = new Engine();
engine.start();

(window as any).__engine = engine;
