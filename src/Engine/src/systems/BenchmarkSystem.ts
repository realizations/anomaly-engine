export interface BenchmarkResult {
  name: string;
  fps: number;
  frameTime: number;
  memoryMB: number;
  cpuPercent: number;
  gpuPercent: number;
  drawCalls: number;
  triangleCount: number;
  timestamp: number;
}

export interface BenchmarkScene {
  id: string;
  name: string;
  description: string;
  setup: () => void;
  teardown: () => void;
}

export class BenchmarkSystem {
  private _results: BenchmarkResult[] = [];
  private _running = false;
  public _currentScene: BenchmarkScene | null = null;
  private _frameCount = 0;
  private _startTime = 0;
  private _listeners: ((result: BenchmarkResult) => void)[] = [];

  registerScene(scene: BenchmarkScene): void {
    this._scenes.push(scene);
  }

  private _scenes: BenchmarkScene[] = [];

  getScenes(): BenchmarkScene[] {
    return [...this._scenes];
  }

  async run(sceneId: string, durationMs = 10000): Promise<BenchmarkResult> {
    const scene = this._scenes.find(s => s.id === sceneId);
    if (!scene) throw new Error(`Benchmark scene not found: ${sceneId}`);

    this._currentScene = scene;
    this._running = true;
    this._frameCount = 0;
    this._startTime = performance.now();

    scene.setup();

    return new Promise((resolve) => {
      const checkEnd = () => {
        if (!this._running || performance.now() - this._startTime >= durationMs) {
          this._running = false;
          scene.teardown();

          const result = this._computeResult(scene.name);
          this._results.push(result);
          this._listeners.forEach(fn => fn(result));
          resolve(result);
        } else {
          requestAnimationFrame(checkEnd);
        }
      };
      requestAnimationFrame(checkEnd);
    });
  }

  private _computeResult(sceneName: string): BenchmarkResult {
    const elapsed = performance.now() - this._startTime;
    const fps = Math.round((this._frameCount / elapsed) * 1000);

    return {
      name: sceneName,
      fps,
      frameTime: elapsed / this._frameCount,
      memoryMB: this._getMemoryUsage(),
      cpuPercent: 0,
      gpuPercent: 0,
      drawCalls: 0,
      triangleCount: 0,
      timestamp: Date.now(),
    };
  }

  private _getMemoryUsage(): number {
    if (performance && 'memory' in performance) {
      const mem = (performance as unknown as { memory: { usedJSHeapSize: number } }).memory;
      return mem.usedJSHeapSize / (1024 * 1024);
    }
    return 0;
  }

  getResults(): BenchmarkResult[] {
    return [...this._results];
  }

  getAverageFps(): number {
    if (this._results.length === 0) return 0;
    return Math.round(this._results.reduce((sum, r) => sum + r.fps, 0) / this._results.length);
  }

  exportResults(): string {
    return JSON.stringify(this._results, null, 2);
  }

  onResult(listener: (result: BenchmarkResult) => void): () => void {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  }

  dispose(): void {
    this._listeners = [];
    this._results = [];
    this._scenes = [];
    this._currentScene = null;
  }
}
