import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { WINDOW_EVENTS } from '../src/core/windowEvents.js';
import { CreatorMode } from '../src/platform/CreatorMode.js';
import { ScreenshotSystem } from '../src/platform/ScreenshotSystem.js';

/**
 * Every window event the renderer dispatches has a listener.
 *
 * This exists because of five dead buttons. Creator mode drives the world by
 * dispatching `anomaly:*` CustomEvents on `window`, and `main.ts` listened for
 * fifteen of them but not the five that creator mode actually sends: Set Time, Set
 * Weather, Reload World, Trigger Event and Screenshot. All five buttons rendered,
 * none of them did anything, and nothing threw. The panel is reachable from the
 * tray and from Ctrl+Alt+C, so this shipped as five controls that silently did
 * nothing.
 *
 * The failure mode is invisible to every other check we have. A type error needs a
 * mismatch the compiler can see, and two matching string literals in two files are
 * two separate facts. So the names live in `windowEvents.ts` and both sides import
 * them, and this file checks the remaining gap: that the two sides still agree.
 *
 * The check reads the source rather than importing it because `main.ts` starts the
 * engine on import. That is also why the shared constant list matters: it is the
 * part a unit test *can* see, and requiring every dispatched name to appear in it
 * means a new control has to be declared rather than invented at the call site.
 */

// `import.meta.url` is not a file URL under the jsdom environment, so this is
// resolved from the package root that vitest runs in.
const SRC_ROOT = join(process.cwd(), 'src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

const ALL_SOURCE = sourceFiles(SRC_ROOT).map((f) => ({ file: f, text: readFileSync(f, 'utf8') }));

/** Constant key -> event name, so `WINDOW_EVENTS.setTime` resolves to its string. */
const KEY_TO_NAME = new Map(
  Object.entries(WINDOW_EVENTS).map(([key, name]) => [key, name as string])
);

/**
 * Both a name and a constant reference count, but only in the right position: a
 * `WINDOW_EVENTS.setWeather` on a dispatch line is a sender and the same constant on
 * an addEventListener line is a receiver. Matching the constant anywhere in the file
 * would make every event look like it had a listener, which is the exact false pass
 * this guard is supposed to prevent.
 */
function namesMatching(re: RegExp): Set<string> {
  const found = new Set<string>();
  for (const { text } of ALL_SOURCE) {
    for (const m of text.matchAll(re)) {
      const literal = m[1];
      const key = m[2];
      if (literal) found.add(literal);
      else if (key) {
        const name = KEY_TO_NAME.get(key);
        if (name) found.add(name);
      }
    }
  }
  return found;
}

const dispatched = namesMatching(
  /dispatchEvent\(\s*new CustomEvent\(\s*(?:'([^']+)'|WINDOW_EVENTS\.(\w+))/g
);
const listened = namesMatching(/addEventListener\(\s*(?:'([^']+)'|WINDOW_EVENTS\.(\w+))/g);

/**
 * Dispatched but deliberately not consumed, with the reason.
 *
 * `anomaly:triple-click` is fired by InteractionSystem on the third click of a
 * zone, and the egg table has an entry keyed `triple-click:observatory` waiting
 * for exactly that. It cannot fire, because nothing ever calls `registerZone`, so
 * `_checkClick` iterates an empty map. The upstream feature is missing rather than
 * broken -- the clickable observatory region needs a screen rect, which is a
 * product decision about where a wallpaper should accept clicks.
 *
 * It is listed rather than deleted so the gap is visible and so that wiring it up
 * means removing a line here, not discovering the problem again.
 */
const KNOWN_GAPS = new Set(['anomaly:triple-click']);

const DECLARED = new Set<string>(Object.values(WINDOW_EVENTS));

describe('window event wiring', () => {
  it('every dispatched event has a listener, or is a recorded gap', () => {
    const orphans = [...dispatched].filter((e) => !listened.has(e) && !KNOWN_GAPS.has(e)).sort();
    expect(orphans).toEqual([]);
  });

  it('records a gap that has since been closed', () => {
    // A gap entry that is no longer true is worse than no entry: it reads as a
    // permanent exemption and stops anyone looking.
    expect([...KNOWN_GAPS].filter((e) => !dispatched.has(e))).toEqual([]);
    expect([...KNOWN_GAPS].filter((e) => listened.has(e))).toEqual([]);
  });

  it('every dispatched event is declared in the shared list', () => {
    // Otherwise a new control can be invented as a bare literal, and the constant
    // list quietly stops describing reality.
    const undeclared = [...dispatched].filter((e) => !DECLARED.has(e)).sort();
    expect(undeclared).toEqual([]);
  });

  it('declares no duplicate names', () => {
    const names = Object.values(WINDOW_EVENTS);
    expect(names.length).toBe(new Set(names).size);
  });

  it('finds the events it is meant to find', () => {
    // Guards the scan itself. A regex that quietly stopped matching would make the
    // assertions above pass for the wrong reason, which is the failure mode this
    // whole file exists to prevent.
    expect(dispatched.has('anomaly:triple-click')).toBe(true);
    expect(listened.has('anomaly:pause')).toBe(true);
    expect(listened.has('anomaly:set-weather')).toBe(true);
    expect(listened.has('anomaly:screenshot')).toBe(true);
  });
});

describe('creator mode', () => {
  it('dispatches each creator control as a declared event', () => {
    const creator = new CreatorMode();
    const seen: string[] = [];
    const names = [
      WINDOW_EVENTS.setTime,
      WINDOW_EVENTS.setWeather,
      WINDOW_EVENTS.reloadWorld,
      WINDOW_EVENTS.triggerEvent,
      WINDOW_EVENTS.screenshot,
    ];
    for (const name of names) {
      window.addEventListener(name, () => seen.push(name), { once: true });
    }

    creator.setSimulatedTime(9, 30);
    creator.setSimulatedWeather('snow');
    window.dispatchEvent(new CustomEvent(WINDOW_EVENTS.reloadWorld));
    creator.triggerEvent('random.meteor');
    window.dispatchEvent(new CustomEvent(WINDOW_EVENTS.screenshot));

    expect(seen.sort()).toEqual([...names].sort());
  });

  it('honours its own feature flags', () => {
    // The gates are the only thing standing between a creator panel and a user who
    // has switched simulation off, so they get checked rather than assumed.
    const creator = new CreatorMode();
    creator.setConfig({ allowTimeSimulation: false, allowWeatherSimulation: false, allowEventTrigger: false });
    const seen: string[] = [];
    for (const name of [WINDOW_EVENTS.setTime, WINDOW_EVENTS.setWeather, WINDOW_EVENTS.triggerEvent]) {
      window.addEventListener(name, () => seen.push(name), { once: true });
    }

    creator.setSimulatedTime(9, 30);
    creator.setSimulatedWeather('snow');
    creator.triggerEvent('random.meteor');

    expect(seen).toEqual([]);
  });
});

describe('screenshot', () => {
  /**
   * jsdom has no 2D context, so the surface is stubbed. That is enough to assert the
   * thing that was wrong: `capture()` used to create its own canvas, fill it black
   * and encode that, so every screenshot was a well-formed black rectangle of the
   * right size. Nothing threw and the result had correct dimensions, which is why it
   * survived until the creator button got wired.
   */
  function stubCanvas() {
    const calls: { draw: unknown[][]; fills: unknown[][] } = { draw: [], fills: [] };
    const ctx = {
      fillStyle: '',
      drawImage: (...args: unknown[]) => calls.draw.push(args),
      fillRect: (...args: unknown[]) => calls.fills.push(args),
    };
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    const toDataURL = vi
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/png;base64,STUB');
    return { calls, getContext, toDataURL };
  }

  it('copies the live wallpaper instead of filling a blank frame', async () => {
    const stub = stubCanvas();
    const wallpaper = document.createElement('canvas');
    wallpaper.id = 'wallpaper-canvas';
    wallpaper.width = 64;
    wallpaper.height = 32;
    document.body.appendChild(wallpaper);

    try {
      const result = await new ScreenshotSystem().capture();
      // The wallpaper is the source, scaled to the capture surface.
      expect(stub.calls.draw).toEqual([[wallpaper, 0, 0, 64, 32]]);
      // And nothing painted a black rectangle over it.
      expect(stub.calls.fills).toEqual([]);
      expect([result.width, result.height]).toEqual([64, 32]);
      expect(result.dataUrl).toContain('STUB');
    } finally {
      wallpaper.remove();
      stub.getContext.mockRestore();
      stub.toDataURL.mockRestore();
    }
  });

  it('uses the wallpaper dimensions, not the screen size', async () => {
    const stub = stubCanvas();
    const wallpaper = document.createElement('canvas');
    wallpaper.id = 'wallpaper-canvas';
    wallpaper.width = 128;
    wallpaper.height = 96;
    document.body.appendChild(wallpaper);

    try {
      const result = await new ScreenshotSystem().capture();
      // The canvas is the composed framebuffer sized to the monitor layout, which on
      // a multi-display setup is not window.screen.
      expect([result.width, result.height]).toEqual([128, 96]);
    } finally {
      wallpaper.remove();
      stub.getContext.mockRestore();
      stub.toDataURL.mockRestore();
    }
  });

  it('still returns a correctly sized frame when the wallpaper is missing', async () => {
    const stub = stubCanvas();
    document.getElementById('wallpaper-canvas')?.remove();
    try {
      const result = await new ScreenshotSystem().capture();
      // A teardown race rather than a normal state, but it should not throw or hand
      // back a zero-sized frame.
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
    } finally {
      stub.getContext.mockRestore();
      stub.toDataURL.mockRestore();
    }
  });
});