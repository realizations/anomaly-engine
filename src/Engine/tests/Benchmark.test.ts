import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BenchmarkSystem, type BenchmarkScene } from '../src/systems/BenchmarkSystem.js';

/**
 * The benchmark's arithmetic, which was wrong in a way that looked like a measurement.
 *
 * `_frameCount` was declared, reset to zero in `run`, and never incremented. So
 * `_computeResult` divided by zero on every path: `fps` came out 0 and `frameTime`
 * came out `Infinity`, and `exportResults` -- which is the only way anyone reads a
 * result -- serialised the Infinity as `null`. A caller asking "how fast is this
 * scene" got back an object that looked populated and said nothing.
 *
 * That is the same failure shape this repository keeps meeting: the value is wrong,
 * nothing throws, and the guard that would have caught it is the thing that was
 * missing. These tests drive the real `run` loop with a stubbed clock and
 * `requestAnimationFrame`, so the assertions are about what the system reports rather
 * than about how it counts.
 */

/** A scene that does nothing, because the cost being measured is the engine's. */
function scene(overrides: Partial<BenchmarkScene> = {}): BenchmarkScene {
  return {
    id: 'scene',
    name: 'Scene',
    description: 'a scene',
    setup: vi.fn(),
    teardown: vi.fn(),
    ...overrides,
  };
}

describe('BenchmarkSystem', () => {
  let frames: FrameRequestCallback[] = [];

  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    // A clock that advances by exactly one frame interval per tick, so a reported fps
    // has one correct answer and an arithmetic slip cannot hide.
    let now = 1000;
    vi.stubGlobal('performance', { now: () => (now += 16.667) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Runs the loop for `count` frames, which is how a real rAF loop would proceed. */
  async function pump(pending: Promise<unknown>, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      const cb = frames.shift();
      expect(cb, `expected a frame callback on step ${i}`).toBeTypeOf('function');
      (cb as FrameRequestCallback)(0);
      // Let the promise continuation run so the next rAF is scheduled.
      await Promise.resolve();
      await Promise.resolve();
    }
    return pending as Promise<void>;
  }

  it('counts the frames it measures', async () => {
    const bench = new BenchmarkSystem();
    bench.registerScene(scene({ id: 'a' }));

    const pending = bench.run('a', 100);
    // Ten frames is past 100ms at ~16.7ms each, so the run finishes on its own.
    for (let i = 0; i < 12 && frames.length > 0; i++) {
      const cb = frames.shift();
      if (!cb) break;
      cb(0);
      await Promise.resolve();
      await Promise.resolve();
    }
    const result = await pending;

    expect(result.fps).toBeGreaterThan(0);
    // The reciprocal check: if fps and frameTime disagree, one of them divided by
    // something other than the frame count.
    expect(result.frameTime).toBeCloseTo(1000 / result.fps, 0);
  });

  it('never reports a frame time that cannot be serialised', async () => {
    // The original defect, stated as the property that was broken. `Infinity` is what
    // `JSON.stringify` turns into `null`, so a result that fails this could not be
    // exported without silently losing a field.
    const bench = new BenchmarkSystem();
    bench.registerScene(scene({ id: 'a' }));

    const pending = bench.run('a', 50);
    for (let i = 0; i < 12 && frames.length > 0; i++) {
      const cb = frames.shift();
      if (!cb) break;
      cb(0);
      await Promise.resolve();
      await Promise.resolve();
    }
    const result = await pending;

    expect(Number.isFinite(result.frameTime)).toBe(true);
    expect(bench.exportResults()).not.toContain('null');
  });

  it('sets up and tears the scene down exactly once', async () => {
    const s = scene({ id: 'a' });
    const bench = new BenchmarkSystem();
    bench.registerScene(s);

    const pending = bench.run('a', 50);
    for (let i = 0; i < 12 && frames.length > 0; i++) {
      const cb = frames.shift();
      if (!cb) break;
      cb(0);
      await Promise.resolve();
      await Promise.resolve();
    }
    await pending;

    expect(s.setup).toHaveBeenCalledTimes(1);
    expect(s.teardown).toHaveBeenCalledTimes(1);
  });

  it('reports zeros rather than dividing by zero when nothing rendered', async () => {
    // A duration of zero ends the run on the first tick, and the guard means the result
    // is a stated zero instead of an Infinity that reads like a very slow scene.
    const bench = new BenchmarkSystem();
    bench.registerScene(scene({ id: 'a' }));

    const pending = bench.run('a', 0);
    frames.shift()?.(0);
    await Promise.resolve();
    await Promise.resolve();
    const result = await pending;

    expect(Number.isFinite(result.frameTime)).toBe(true);
    expect(Number.isFinite(result.fps)).toBe(true);
  });

  it('refuses an unregistered scene rather than measuring nothing', async () => {
    const bench = new BenchmarkSystem();
    await expect(bench.run('nope')).rejects.toThrow(/not found/);
  });

  it('accumulates results and averages them', async () => {
    const bench = new BenchmarkSystem();
    bench.registerScene(scene({ id: 'a' }));

    for (const id of ['a', 'a']) {
      const pending = bench.run(id, 50);
      for (let i = 0; i < 12 && frames.length > 0; i++) {
        const cb = frames.shift();
        if (!cb) break;
        cb(0);
        await Promise.resolve();
        await Promise.resolve();
      }
      await pending;
    }

    expect(bench.getResults()).toHaveLength(2);
    const avg = bench.getAverageFps();
    const fps = bench.getResults().map((r) => r.fps);
    expect(avg).toBe(Math.round(fps.reduce((a, b) => a + b, 0) / fps.length));
  });

  it('notifies a listener and stops after unsubscribing', async () => {
    const bench = new BenchmarkSystem();
    bench.registerScene(scene({ id: 'a' }));
    const seen: number[] = [];
    const off = bench.onResult((r) => seen.push(r.fps));

    const first = bench.run('a', 50);
    for (let i = 0; i < 12 && frames.length > 0; i++) {
      const cb = frames.shift();
      if (!cb) break;
      cb(0);
      await Promise.resolve();
      await Promise.resolve();
    }
    await first;
    expect(seen).toHaveLength(1);

    off();
    const second = bench.run('a', 50);
    for (let i = 0; i < 12 && frames.length > 0; i++) {
      const cb = frames.shift();
      if (!cb) break;
      cb(0);
      await Promise.resolve();
      await Promise.resolve();
    }
    await second;
    expect(seen).toHaveLength(1);
  });

  it('forgets everything on dispose', async () => {
    const bench = new BenchmarkSystem();
    bench.registerScene(scene({ id: 'a' }));
    bench.dispose();
    expect(bench.getScenes()).toEqual([]);
    expect(bench.getResults()).toEqual([]);
    expect(bench.getAverageFps()).toBe(0);
  });
});
