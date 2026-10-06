import { describe, it, expect } from 'vitest';
import {
  amplitude,
  rate,
  clamp01,
  RESPONSE,
  DEFAULT_MOTION_INTENSITY,
  REDUCED_MOTION_INTENSITY,
  SCAN_BAR,
  BEACON,
  TWINKLE,
  type MotionCategory,
} from '../src/renderer/motion.js';

/**
 * The motion model.
 *
 * This is the accessibility feature. Someone who finds a moving background
 * uncomfortable sets this to zero, and the contract is that the scene gets calmer
 * rather than broken -- still moving, no longer pulsing. That contract is entirely
 * in this file, and it had no tests at all.
 *
 * It matters more than a typical tuning module because the constants encode a
 * judgement about what tires the eye. `glow` at 0.18 is deliberate: ambient
 * *brightness* oscillation is what peripheral vision picks up, and it is the thing
 * a wallpaper gets blamed for. Somebody tidying these numbers later would break
 * that without any test objecting.
 */
const CATEGORIES = Object.keys(RESPONSE) as MotionCategory[];

describe('motion model', () => {
  it('damps every category as intensity falls, and never reverses it', () => {
    // `interface` is exempt by design and is asserted separately below.
    for (const category of CATEGORIES.filter((c) => c !== 'interface')) {
      const full = amplitude(category, 1, 1);
      const half = amplitude(category, 0.5, 1);
      const none = amplitude(category, 0, 1);
      expect({ category, monotonic: half < full && none < half }).toEqual({
        category,
        monotonic: true,
      });
    }
  });

  it('slows every category as intensity falls', () => {
    for (const category of CATEGORIES.filter((c) => c !== 'interface')) {
      const full = rate(category, 1, 1);
      const none = rate(category, 0, 1);
      expect({ category, slowerWhenCalm: none < full }).toEqual({
        category,
        slowerWhenCalm: true,
      });
    }
  });

  it('damps rather than stops, so a calm scene is not a screenshot', () => {
    // Zero intensity must not pin the clock. This is the distinction that a frozen
    // renderer gets wrong, and it is the reason reduced motion exists as a dial
    // rather than a switch.
    for (const category of CATEGORIES) {
      if (category === 'interface') continue; // deliberately exempt
      expect(amplitude(category, 0, 1)).toBeGreaterThan(0);
      expect(rate(category, 0, 1)).toBeGreaterThan(0);
    }
  });

  it('leaves instrumentation completely alone', () => {
    // A readout that changes brightness is a broken readout, not an effect.
    expect(RESPONSE.interface).toBe(0);
    for (const intensity of [0, 0.35, 1]) {
      expect(amplitude('interface', intensity, 0.4)).toBeCloseTo(0.4, 10);
    }
  });

  it('damps brightness least, because brightness is what tires the eye', () => {
    // The ordering is the whole design. Environment motion can afford to be cut
    // hard; ambient brightness cannot, and the comment in motion.ts says why.
    expect(RESPONSE.glow).toBeLessThan(RESPONSE.twinkle);
    expect(RESPONSE.twinkle).toBeLessThan(RESPONSE.particles);
    expect(RESPONSE.particles).toBeLessThan(RESPONSE.environment);
  });

  it('keeps reduced motion below the default, and both inside 0..1', () => {
    expect(REDUCED_MOTION_INTENSITY).toBeLessThan(DEFAULT_MOTION_INTENSITY);
    for (const v of [DEFAULT_MOTION_INTENSITY, REDUCED_MOTION_INTENSITY]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('clamps out-of-range input, and only falls back for NaN', () => {
    expect(clamp01(-5)).toBe(0);
    expect(clamp01(5)).toBe(1);
    // NaN is "no idea", so the default is the only sensible answer.
    expect(clamp01(NaN)).toBe(DEFAULT_MOTION_INTENSITY);
    // An infinity is "more than the maximum", and clamping it to the maximum is
    // what clamp means. Returning the default here would quietly turn somebody's
    // setting down, which is the wrong way for an accessibility control to fail.
    expect(clamp01(Infinity)).toBe(1);
    expect(clamp01(-Infinity)).toBe(0);
    // And the amplitude functions must not produce NaN from any of it, which is
    // what would actually show up as an invisible scene.
    for (const category of CATEGORIES) {
      for (const v of [NaN, Infinity, -Infinity, -1, 2]) {
        expect(Number.isFinite(amplitude(category, v, 1))).toBe(true);
        expect(Number.isFinite(rate(category, v, 1))).toBe(true);
      }
    }
  });

  it('scales linearly with the base amplitude', () => {
    for (const category of CATEGORIES) {
      expect(amplitude(category, 0.35, 2)).toBeCloseTo(amplitude(category, 0.35, 1) * 2, 10);
    }
  });

  it('keeps the tuning constants inside plausible bounds', () => {
    // These are the numbers that were tuned against reports of a tiring
    // wallpaper. A refactor that multiplies one of them by ten should fail here
    // rather than in somebody's eyes.
    expect(BEACON.breathRate).toBeLessThan(0.3); // below conscious notice
    expect(TWINKLE.rate).toBeLessThan(1); // not sensor noise
    expect(TWINKLE.amplitude).toBeLessThan(0.2); // a garnish
    expect(SCAN_BAR.enabled).toBe(false); // opt-in only
    expect(SCAN_BAR.peakAlpha).toBeLessThan(0.1);
    expect(SCAN_BAR.periodSeconds).toBeGreaterThan(5);
  });
});