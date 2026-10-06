import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InteractionSystem } from '../src/platform/InteractionSystem.js';

/**
 * Dwell and triple-click.
 *
 * `InteractionSystem` is the only bridge from "the cursor is somewhere" to "a discovery
 * happened", and it shipped with `registerZone` called by nothing -- so all of this was
 * valid code with no path into it. It has one now, and these are the cases that make
 * sure the path stays open and fires the right number of times.
 *
 * ## Coordinates
 *
 * jsdom reports a zero rectangle for every element, so `_surface()` falls back to the
 * window and normalisation divides by `innerWidth`/`innerHeight`. Zones are placed well
 * inside their quadrant and addresses are taken from the window, so a rounding step in
 * the conversion cannot push a point across an edge.
 */

const WIDTH = () => window.innerWidth;
const HEIGHT = () => window.innerHeight;

function moveTo(x: number, y: number): void {
  window.dispatchEvent(
    new MouseEvent('mousemove', { clientX: Math.round(x * WIDTH()), clientY: Math.round(y * HEIGHT()) })
  );
}

function clickAt(x: number, y: number): void {
  window.dispatchEvent(
    new MouseEvent('click', { clientX: Math.round(x * WIDTH()), clientY: Math.round(y * HEIGHT()) })
  );
}

/** Inside `zone`, at the point `at` describes as a fraction of that zone. */
function inside(x: number, y: number, w: number, h: number, at = 0.5): void {
  moveTo(x + w * at, y + h * at);
}

let system: InteractionSystem | null = null;

function build(): InteractionSystem {
  system = new InteractionSystem();
  return system;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  system?.dispose();
  system = null;
  vi.useRealTimers();
});

describe('dwell', () => {
  it('fires once the cursor has rested long enough', () => {
    const s = build();
    let fired = 0;
    s.registerZone({
      id: 'forest', name: 'forest', x: 0.1, y: 0.1, width: 0.4, height: 0.4,
      dwellMs: 3_000, onDwell: () => { fired++; },
    });

    inside(0.1, 0.1, 0.4, 0.4);
    vi.advanceTimersByTime(1_000);
    expect(fired).toBe(0);

    vi.advanceTimersByTime(2_000);
    expect(fired).toBe(1);
  });

  it('does not fire again while the cursor keeps resting', () => {
    const s = build();
    let fired = 0;
    s.registerZone({
      id: 'forest', name: 'forest', x: 0.1, y: 0.1, width: 0.4, height: 0.4,
      dwellMs: 3_000, onDwell: () => { fired++; },
    });

    inside(0.1, 0.1, 0.4, 0.4);
    vi.advanceTimersByTime(30_000);
    // Documented as "called once the cursor has rested ... for dwellMs". Reaching the
    // threshold restarts the clock rather than leaving it above the line, which is what
    // used to make a long stare fire on every subsequent tick.
    expect(fired).toBe(1);
  });

  it('fires again after the cursor leaves and comes back', () => {
    const s = build();
    let fired = 0;
    s.registerZone({
      id: 'forest', name: 'forest', x: 0.1, y: 0.1, width: 0.4, height: 0.4,
      dwellMs: 2_000, onDwell: () => { fired++; },
    });

    inside(0.1, 0.1, 0.4, 0.4);
    vi.advanceTimersByTime(5_000);
    expect(fired).toBe(1);

    moveTo(0.9, 0.9);
    vi.advanceTimersByTime(5_000);
    expect(fired).toBe(1);

    inside(0.1, 0.1, 0.4, 0.4);
    vi.advanceTimersByTime(2_000);
    expect(fired).toBe(2);
  });

  it('does not inherit time spent on a zone it just left', () => {
    const s = build();
    let firedA = 0;
    let firedB = 0;
    s.registerZone({
      id: 'a', name: 'a', x: 0.0, y: 0.0, width: 0.5, height: 0.5,
      dwellMs: 5_000, onDwell: () => { firedA++; },
    });
    s.registerZone({
      id: 'b', name: 'b', x: 0.5, y: 0.5, width: 0.5, height: 0.5,
      dwellMs: 4_000, onDwell: () => { firedB++; },
    });

    inside(0.0, 0.0, 0.5, 0.5);
    vi.advanceTimersByTime(3_000);
    expect(firedA).toBe(0);
    expect(s.getDwellMs('a')).toBe(3_000);

    inside(0.5, 0.5, 0.5, 0.5);
    // Carried over, `b` would already be at 4,000 and would fire immediately.
    vi.advanceTimersByTime(1_000);
    expect(firedB).toBe(0);

    vi.advanceTimersByTime(3_000);
    expect(firedB).toBe(1);
    expect(firedA).toBe(0);
  });

  it('never fires when dwell is disabled', () => {
    const s = build();
    let zero = 0;
    let absent = 0;
    s.registerZone({ id: 'zero', name: 'z', x: 0, y: 0, width: 1, height: 1, dwellMs: 0, onDwell: () => { zero++; } });
    s.registerZone({ id: 'absent', name: 'a', x: 0, y: 0, width: 1, height: 1, onDwell: () => { absent++; } });

    moveTo(0.5, 0.5);
    vi.advanceTimersByTime(60_000);
    expect(zero).toBe(0);
    expect(absent).toBe(0);
  });

  it('stops ticking once disposed', () => {
    const s = build();
    let fired = 0;
    s.registerZone({
      id: 'forest', name: 'forest', x: 0, y: 0, width: 1, height: 1,
      dwellMs: 1_000, onDwell: () => { fired++; },
    });
    moveTo(0.5, 0.5);
    s.dispose();
    vi.advanceTimersByTime(60_000);
    expect(fired).toBe(0);
    expect(s.getZones()).toEqual([]);
  });
});

describe('triple click', () => {
  it('fires exactly on the third click and then restarts', () => {
    const s = build();
    s.registerZone({ id: 'obs', name: 'obs', x: 0.4, y: 0.4, width: 0.2, height: 0.2 });

    const seen: string[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail.zoneId as string);
    window.addEventListener('anomaly:triple-click', listener);
    try {
      for (let i = 1; i <= 6; i++) {
        clickAt(0.5, 0.5);
        expect(seen).toHaveLength(Math.floor(i / 3));
      }
      // Restarted at zero rather than left at three, so the next triple needs three
      // more clicks rather than one.
      expect(s.getClickCount('obs')).toBe(0);

      clickAt(0.5, 0.5);
      expect(seen).toHaveLength(2);
      expect(s.getClickCount('obs')).toBe(1);
    } finally {
      window.removeEventListener('anomaly:triple-click', listener);
    }
  });

  it('counts each zone separately', () => {
    const s = build();
    s.registerZone({ id: 'a', name: 'a', x: 0.0, y: 0.0, width: 0.5, height: 1 });
    s.registerZone({ id: 'b', name: 'b', x: 0.5, y: 0.0, width: 0.5, height: 1 });

    for (let i = 0; i < 3; i++) clickAt(0.25, 0.5);
    expect(s.getClickCount('a')).toBe(0);
    expect(s.getClickCount('b')).toBe(0);

    clickAt(0.75, 0.5);
    expect(s.getClickCount('a')).toBe(0);
    expect(s.getClickCount('b')).toBe(1);
  });

  it('does not let an unregistered zone keep counting', () => {
    const s = build();
    s.registerZone({ id: 'obs', name: 'obs', x: 0, y: 0, width: 1, height: 1 });
    clickAt(0.5, 0.5);
    clickAt(0.5, 0.5);
    expect(s.getClickCount('obs')).toBe(2);

    s.unregisterZone('obs');
    // Re-registering must not inherit two clicks, or the very first click afterwards
    // would be the one that fires.
    s.registerZone({ id: 'obs', name: 'obs', x: 0, y: 0, width: 1, height: 1 });
    expect(s.getClickCount('obs')).toBe(0);

    const seen: string[] = [];
    const listener = () => seen.push('x');
    window.addEventListener('anomaly:triple-click', listener);
    try {
      clickAt(0.5, 0.5);
      expect(seen).toEqual([]);
    } finally {
      window.removeEventListener('anomaly:triple-click', listener);
    }
  });
});
