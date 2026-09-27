export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra' | 'custom';

export interface PerformanceConfig {
  fpsCap: number;
  quality: QualityPreset;
  particleCount: number;
  shadowQuality: number;
  textureQuality: number;
  fullscreenPause: boolean;
  batteryPause: boolean;
  idleReduce: boolean;
  dynamicQuality: boolean;
  gpuMemoryLimit: number;
}

export interface PerformanceStats {
  fps: number;
  frameTime: number;
  memoryMB: number;
  cpuPercent: number;
  gpuPercent: number;
  drawCalls: number;
  triangleCount: number;
}

export class PerformanceSystem {
  private _config: PerformanceConfig = {
    fpsCap: 60,
    quality: 'high',
    particleCount: 1000,
    shadowQuality: 1,
    textureQuality: 1,
    fullscreenPause: true,
    batteryPause: false,
    idleReduce: true,
    dynamicQuality: true,
    gpuMemoryLimit: 512,
  };

  private _stats: PerformanceStats = {
    fps: 0,
    frameTime: 0,
    memoryMB: 0,
    cpuPercent: 0,
    gpuPercent: 0,
    drawCalls: 0,
    triangleCount: 0,
  };

  private _frameCount = 0;
  private _lastFpsTime = 0;
  private _lastFrameTime = 0;
  public _targetFrameTime: number;
  private _listeners: ((stats: PerformanceStats) => void)[] = [];
  private _qualityListeners: ((quality: QualityPreset) => void)[] = [];

  constructor() {
    this._targetFrameTime = 1000 / this._config.fpsCap;
  }

  getConfig(): PerformanceConfig {
    return { ...this._config };
  }

  setConfig(config: Partial<PerformanceConfig>): void {
    this._config = { ...this._config, ...config };
    this._targetFrameTime = 1000 / this._config.fpsCap;
  }

  getStats(): PerformanceStats {
    return { ...this._stats };
  }

  update(frameTime: number): void {
    this._lastFrameTime = frameTime;
    this._frameCount++;

    const now = performance.now();
    if (now - this._lastFpsTime >= 1000) {
      this._stats.fps = this._frameCount;
      this._stats.frameTime = this._lastFrameTime;
      this._frameCount = 0;
      this._lastFpsTime = now;

      this._stats.memoryMB = this._estimateMemoryUsage();

      if (this._config.dynamicQuality) {
        this._adjustQuality();
      }

      this._listeners.forEach(fn => fn(this._stats));
    }
  }

  private _estimateMemoryUsage(): number {
    if (performance && 'memory' in performance) {
      const mem = (performance as unknown as { memory: { usedJSHeapSize: number } }).memory;
      return mem.usedJSHeapSize / (1024 * 1024);
    }
    return 0;
  }

  private _adjustQuality(): void {
    if (this._stats.fps < 30 && this._config.quality !== 'low') {
      this._config.quality = 'low';
      this._config.particleCount = Math.floor(this._config.particleCount * 0.5);
      this._qualityListeners.forEach(fn => fn('low'));
    } else if (this._stats.fps < 45 && this._config.quality === 'high') {
      this._config.quality = 'medium';
      this._config.particleCount = Math.floor(this._config.particleCount * 0.75);
      this._qualityListeners.forEach(fn => fn('medium'));
    }
  }

  shouldRender(): boolean {
    if (this._config.fullscreenPause) {
      return !this._isFullscreen();
    }
    return true;
  }

  private _isFullscreen(): boolean {
    return window.screen.width === window.innerWidth && window.screen.height === window.innerHeight;
  }

  onStats(listener: (stats: PerformanceStats) => void): () => void {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  }

  onQualityChange(listener: (quality: QualityPreset) => void): () => void {
    this._qualityListeners.push(listener);
    return () => {
      const idx = this._qualityListeners.indexOf(listener);
      if (idx >= 0) this._qualityListeners.splice(idx, 1);
    };
  }

  dispose(): void {
    this._listeners = [];
    this._qualityListeners = [];
  }
}
