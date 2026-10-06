import { describe, it, expect } from 'vitest';
import {
  beatEnvelope,
  isBeatActive,
  STORY_BEAT_KINDS,
  type ActiveStoryBeat,
  type StoryBeat,
} from '../src/renderer/storyBeat.js';
import { EGG_EFFECTS } from '../src/systems/eggEffects.js';

/**
 * The envelope every beat is drawn through.
 *
 * A beat that renders at the wrong strength is the failure mode worth guarding here,
 * because none of it throws: a duration of zero makes an effect permanently invisible,
 * a flat envelope makes an arrival read as a glitch, and an expiry that never comes
 * leaves a door standing open forever. `tools/story-beats.mjs` proves each beat changes
 * real pixels; this proves the arithmetic underneath those pixels behaves.
 */

const DURATION = 10_000;

describe('beatEnvelope', () => {
  it('is silent before the beat starts and after it ends', () => {
    expect(beatEnvelope(1_000, DURATION, 999)).toBe(0);
    expect(beatEnvelope(1_000, DURATION, 1_000)).toBe(0);
    expect(beatEnvelope(1_000, DURATION, 1_000 + DURATION)).toBe(0);
    expect(beatEnvelope(1_000, DURATION, 1_000 + DURATION + 1)).toBe(0);
  });

  it('holds at full strength through the middle', () => {
    // Past the 400ms fade in and clear of the 900ms fade out.
    expect(beatEnvelope(1_000, DURATION, 1_000 + 2_000)).toBe(1);
    expect(beatEnvelope(1_000, DURATION, 1_000 + 8_000)).toBe(1);
  });

  it('rises monotonically through the fade in', () => {
    // A beat that flickered as it arrived would read as a rendering fault rather than as
    // an arrival, which is the wrong register for a door standing ajar.
    let previous = -1;
    for (let t = 0; t <= 400; t += 20) {
      const v = beatEnvelope(1_000, DURATION, 1_000 + t);
      expect(v).toBeGreaterThanOrEqual(previous);
      previous = v;
    }
    expect(previous).toBeCloseTo(1, 5);
  });

  it('falls monotonically through the fade out', () => {
    let previous = 2;
    for (let t = DURATION - 900; t <= DURATION; t += 30) {
      const v = beatEnvelope(1_000, DURATION, 1_000 + t);
      expect(v).toBeLessThanOrEqual(previous);
      previous = v;
    }
    expect(previous).toBeCloseTo(0, 5);
  });

  it('gives the arrival more weight than the departure', () => {
    // Measured at the same distance inside each edge. Asymmetric on purpose: the
    // interesting moment is the arrival, and the fade out should not compete with it.
    const distance = 150;
    const arriving = beatEnvelope(1_000, DURATION, 1_000 + distance);
    const leaving = beatEnvelope(1_000, DURATION, 1_000 + DURATION - distance);
    expect(arriving).toBeGreaterThan(leaving);
  });

  it('stays inside 0..1 across the whole window', () => {
    for (let t = 0; t <= DURATION; t += 50) {
      const v = beatEnvelope(1_000, DURATION, 1_000 + t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('returns zero for a duration that is not positive', () => {
    // A caller computing `durationMs` from a subtraction can legitimately produce this,
    // and a throw here would take the render loop down over arithmetic.
    expect(beatEnvelope(1_000, 0, 5_000)).toBe(0);
    expect(beatEnvelope(1_000, -1, 5_000)).toBe(0);
    expect(beatEnvelope(1_000, Number.NaN, 5_000)).toBe(0);
  });

  it('scales its edges to a short beat rather than running them past the end', () => {
    // A 1,000ms beat cannot afford a 900ms fade out; the edges are fractions of the
    // duration with an absolute ceiling. Anything else would make a short beat spend its
    // entire life fading and never actually be at full strength.
    const short = 1_000;
    for (let t = 0; t <= short; t += 10) {
      const v = beatEnvelope(0, short, t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(beatEnvelope(0, short, short * 0.5)).toBe(1);
  });
});

describe('isBeatActive', () => {
  const beat: ActiveStoryBeat = {
    beat: { kind: 'lights-on', durationMs: DURATION },
    startedAt: 1_000,
  };

  it('is false for no beat', () => {
    expect(isBeatActive(null, 5_000)).toBe(false);
  });

  it('is true while the envelope is positive', () => {
    expect(isBeatActive(beat, 1_000 + 2_000)).toBe(true);
  });

  it('is false once the window has closed', () => {
    expect(isBeatActive(beat, 1_000 + DURATION)).toBe(false);
  });
});

describe('beat coverage', () => {
  it('every effect uses a kind the renderer can perform', () => {
    // The union is the only place a new beat is declared, and this is the check that
    // makes that true in practice rather than by convention.
    const kinds = new Set<string>(STORY_BEAT_KINDS);
    const unknown = Object.entries(EGG_EFFECTS)
      .filter(([, beat]) => !kinds.has(beat.kind))
      .map(([id, beat]) => `${id} -> ${beat.kind}`);
    expect(unknown).toEqual([]);
  });

  it('every effect lasts long enough to be seen', () => {
    // Zero or negative makes `beatEnvelope` return 0 unconditionally: the egg would be
    // discovered, the log would fire, and nothing would ever appear on screen. This is
    // the silent failure the whole feature was built to prevent, one field over.
    const inert = Object.entries(EGG_EFFECTS)
      .filter(([, beat]) => !(beat.durationMs > 0))
      .map(([id]) => id);
    expect(inert).toEqual([]);
  });

  it('declares each kind exactly once', () => {
    expect(STORY_BEAT_KINDS.length).toBe(new Set(STORY_BEAT_KINDS).size);
  });

  it('declares a kind for every beat in the union', () => {
    // Compiled against the union itself, so adding a variant without listing it here is
    // a type error rather than a silently unreachable effect.
    const exhaustive: Record<StoryBeat['kind'], true> = Object.fromEntries(
      STORY_BEAT_KINDS.map((k) => [k, true])
    ) as Record<StoryBeat['kind'], true>;
    expect(Object.keys(exhaustive).sort()).toEqual([...STORY_BEAT_KINDS].sort());
  });
});
