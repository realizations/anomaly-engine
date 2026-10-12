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

  /**
   * Measures a registered scene for `durationMs`.
   *
   * Throws for an unknown id rather than reporting a result for nothing. Nothing
   * registers a scene today -- `run` was unreachable dead code -- so every call would
   * have thrown, which at least fails loudly; the alternative, returning a synthetic
   * result, is what made this class worth deleting the counter from.
   */
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
        // Counted here rather than anywhere the caller might remember to.
        //
        // The counter used to be declared, reset in `run`, and never incremented, so
        // `_computeResult` divided by zero on every path: fps came out 0 and frameTime
        // came out Infinity. That did not throw -- it produced a result object with the
        // right shape and a number that meant nothing, and `exportResults` serialised
        // the Infinity as `null`, so the evidence vanished on the way out. Nothing
        // registered a scene either, so this loop had never actually run; it is
        // reachable now only through `getBenchmark()`, and it has to be right the first
        // time something measures with it.
        this._frameCount++;

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

  /**
   * Turns the measured window into a result.
   *
   * Both figures are guarded against a zero denominator rather than trusting the loop
   * to have ticked. A benchmark that reports `frameTime: Infinity` is worse than one
   * that reports nothing, because it looks like a measurement: `fps` rounds to 0,
   * `JSON.stringify` writes the Infinity as `null`, and the result reads as a slow
   * scene rather than a broken one. A caller that tears the scene down on the first
   * frame, or a `durationMs` of zero, would otherwise produce that silently.
   *
   * `frames === 0` means the scene rendered nothing at all, which is a fact about the
   * measurement rather than an error in it, so it is reported as zeros and recorded.
   */
  private _computeResult(sceneName: string): BenchmarkResult {
    const elapsed = performance.now() - this._startTime;
    const frames = this._frameCount;
    const measured = frames > 0 && elapsed > 0;

    return {
      name: sceneName,
      fps: measured ? Math.round((frames / elapsed) * 1000) : 0,
      frameTime: measured ? elapsed / frames : 0,
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
