import { describe, it, expect } from 'vitest';
import { hash, mulberry32, valueNoise1D, fbm1D, ridged1D, mixRgb, shade, css } from '../src/render/noise.js';
import { gradeForHour, sunPosition, moonPosition, moonPhase, type SkyGrade } from '../src/render/palette.js';

describe('hash', () => {
  it('is deterministic for a seed', () => {
    expect(hash(7)).toBe(hash(7));
  });

  it('differs across seeds', () => {
    expect(hash(7)).not.toBe(hash(8));
  });

  it('returns a value in [0,1)', () => {
    for (let s = 0; s < 200; s++) {
      const v = hash(s);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('mulberry32', () => {
  it('is deterministic and reproducible', () => {
    const a = mulberry32(99);
    const b = mulberry32(99);
    const first = Array.from({ length: 32 }, () => a());
    const second = Array.from({ length: 32 }, () => b());
    expect(first).toEqual(second);
  });

  it('produces values in [0,1)', () => {
    const r = mulberry32(5);
    for (let i = 0; i < 500; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('does not immediately repeat', () => {
    const r = mulberry32(1234);
    const vals = Array.from({ length: 200 }, () => r());
    expect(new Set(vals).size).toBe(vals.length);
  });
});

describe('noise functions', () => {
  it('valueNoise1D is bounded and continuous', () => {
    for (let x = 0; x < 50; x += 0.37) {
      const v = valueNoise1D(x, 11);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('valueNoise1D changes smoothly across small steps', () => {
    const a = valueNoise1D(10.0, 3);
    const b = valueNoise1D(10.001, 3);
    expect(Math.abs(a - b)).toBeLessThan(0.05);
  });

  it('fbm1D stays bounded across octave counts', () => {
    for (const oct of [1, 3, 5, 8]) {
      for (let x = 0; x < 30; x += 1.7) {
        const v = fbm1D(x, 21, oct);
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(-0.001);
        expect(v).toBeLessThanOrEqual(1.001);
      }
    }
  });

  it('ridged1D is non-negative, since it models ridges', () => {
    for (let x = 0; x < 40; x += 0.9) {
      expect(ridged1D(x, 33, 5)).toBeGreaterThanOrEqual(0);
    }
  });

  it('is reproducible for a given seed', () => {
    expect(ridged1D(5.5, 77, 4)).toBe(ridged1D(5.5, 77, 4));
    expect(fbm1D(5.5, 77, 4)).toBe(fbm1D(5.5, 77, 4));
  });

  it('different seeds produce different terrain', () => {
    let diff = 0;
    for (let x = 0; x < 20; x += 1) {
      if (ridged1D(x, 1, 5) !== ridged1D(x, 2, 5)) diff++;
    }
    expect(diff).toBeGreaterThan(15);
  });
});

describe('colour helpers', () => {
  it('mixRgb interpolates endpoints exactly', () => {
    const a = { r: 0, g: 0, b: 0 };
    const b = { r: 100, g: 200, b: 50 };
    expect(mixRgb(a, b, 0)).toEqual(a);
    expect(mixRgb(a, b, 1)).toEqual(b);
  });

  it('mixRgb midpoint is the average', () => {
    const m = mixRgb({ r: 0, g: 0, b: 0 }, { r: 100, g: 100, b: 100 }, 0.5);
    expect(m.r).toBeCloseTo(50, 0);
  });

  it('shade brightens and darkens without changing hue direction', () => {
    const c = { r: 100, g: 100, b: 100 };
    expect(shade(c, 0.2).r).toBeGreaterThan(c.r);
    expect(shade(c, -0.2).r).toBeLessThan(c.r);
  });

  it('shade clamps to the byte range', () => {
    const white = { r: 250, g: 250, b: 250 };
    const up = shade(white, 0.9);
    expect(up.r).toBeLessThanOrEqual(255);
    const down = shade({ r: 2, g: 2, b: 2 }, -0.9);
    expect(down.r).toBeGreaterThanOrEqual(0);
  });

  it('css emits a valid rgb string', () => {
    expect(css({ r: 1, g: 2, b: 3 })).toMatch(/^rgba?\(\s*\d+,\s*\d+,\s*\d+(,\s*[\d.]+)?\s*\)$/);
  });

  it('css honours alpha', () => {
    expect(css({ r: 1, g: 2, b: 3 }, 0.5)).toContain('0.5');
  });
});

describe('gradeForHour', () => {
  const hours = [0, 1, 4.5, 6.5, 9, 12, 15, 16.8, 19, 21, 23.5];

  it('returns a structurally valid grade for every hour', () => {
    for (const h of hours) {
      const g = gradeForHour(h);
      expect(g).toBeTruthy();
      expect(typeof g.name).toBe('string');
      for (const ch of ['skyTop', 'skyHorizon', 'lightColor', 'haze'] as const) {
        for (const v of Object.values(g[ch])) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(255);
        }
      }
      expect(g.ambient).toBeGreaterThanOrEqual(0);
      expect(g.ambient).toBeLessThanOrEqual(1);
    }
  });

  it('wraps across midnight', () => {
    expect(gradeForHour(0).name).toBe(gradeForHour(24).name);
    expect(gradeForHour(23.9).name).toBe(gradeForHour(-0.1).name);
  });

  it('is continuous across the day, so the sky does not jump', () => {
    let maxJump = 0;
    let prev = gradeForHour(0);
    for (let t = 0.05; t < 24; t += 0.05) {
      const cur = gradeForHour(t);
      maxJump = Math.max(
        maxJump,
        Math.abs(cur.skyTop.r - prev.skyTop.r),
        Math.abs(cur.skyHorizon.b - prev.skyHorizon.b),
        Math.abs(cur.ambient - prev.ambient)
      );
      prev = cur;
    }
    // A 3 minute step should never move a channel by a large amount.
    expect(maxJump).toBeLessThan(12);
  });

  it('is darkest around 2am and brightest near midday', () => {
    const night = gradeForHour(2);
    const noon = gradeForHour(12);
    expect(night.ambient).toBeLessThan(noon.ambient);
    const lum = (g: SkyGrade) => g.skyTop.r + g.skyTop.g + g.skyTop.b;
    expect(lum(night)).toBeLessThan(lum(noon));
  });

  it('shows stars at night and not at midday', () => {
    expect(gradeForHour(1).starAlpha).toBeGreaterThan(0.5);
    expect(gradeForHour(12).starAlpha).toBeLessThan(0.1);
  });

  it('shows the sun by day and not at midnight', () => {
    expect(gradeForHour(12).sunAlpha).toBeGreaterThan(0.5);
    expect(gradeForHour(0).sunAlpha).toBeLessThan(0.1);
  });
});

describe('sun and moon positions', () => {
  it('sun is visible around midday and hidden at night', () => {
    expect(sunPosition(12, 1920, 1080).visible).toBe(true);
    expect(sunPosition(0, 1920, 1080).visible).toBe(false);
  });

  it('sun x is within the viewport when visible', () => {
    for (const h of [7, 9, 12, 15, 17]) {
      const p = sunPosition(h, 1920, 1080);
      if (p.visible) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(1920);
      }
    }
  });

  it('sun rises on one side and sets on the other', () => {
    const morning = sunPosition(8, 1920, 1080);
    const evening = sunPosition(16, 1920, 1080);
    expect(morning.x).toBeLessThan(evening.x);
  });

  it('moon is visible at night', () => {
    expect(moonPosition(1, 1920, 1080).visible).toBe(true);
  });

  it('moon position stays in the viewport when visible', () => {
    for (const h of [21, 23, 1, 3]) {
      const p = moonPosition(h, 1920, 1080);
      if (p.visible) {
        expect(p.x).toBeGreaterThanOrEqual(-1);
        expect(p.x).toBeLessThanOrEqual(1921);
      }
    }
  });
});

describe('moonPhase', () => {
  it('is always a fraction', () => {
    for (let d = 0; d < 40; d++) {
      const p = moonPhase(new Date(2026, 0, 1 + d));
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it('cycles over roughly a synodic month rather than daily', () => {
    const a = moonPhase(new Date(2026, 0, 1));
    const b = moonPhase(new Date(2026, 0, 15));
    expect(Math.abs(a - b)).toBeGreaterThan(0.1);
  });

  it('shows the opposite phase about half a synodic month later', () => {
    const a = moonPhase(new Date(2026, 0, 1));
    const b = moonPhase(new Date(2026, 0, 15));
    const diff = Math.abs(a - b);
    expect(diff).toBeGreaterThan(0.4);
    expect(diff).toBeLessThan(0.6);
  });

  it('returns to the same phase after one full synodic month', () => {
    const a = moonPhase(new Date(2026, 0, 1));
    // 29.53 days is the synodic month, so day 30 is close to a full cycle.
    const b = moonPhase(new Date(2026, 0, 31));
    const diff = Math.min(Math.abs(a - b), 1 - Math.abs(a - b));
    expect(diff).toBeLessThan(0.05);
  });
});
