import { describe, it, expect } from 'vitest';
import {
  EFFECT_IDS,
  REGISTERED_EFFECTS,
  effectInfo,
  effectName,
  isAnomalyKind,
} from '../src/anomalies/effects.js';
import { BUILT_IN_ANOMALIES } from '../src/anomalies/builtin.js';

/**
 * The effect registry is a security boundary, so it gets its own test.
 *
 * A feed may only cause one of these effects. That claim is only true if the registry is
 * the single list every other module derives from, and the way it silently stops being
 * true is a second list drifting away from it. `effects.ts` was written to collapse the
 * five lists that used to exist; this file is what keeps the collapse from quietly
 * coming undone.
 *
 * The sharpest check is the last one: the registry's names and durations must agree with
 * the journal's own definitions. They are deliberately separate modules -- one is the
 * rule editor's vocabulary and the other is what the journal records -- so nothing but a
 * test stops them from diverging.
 */
describe('the effect registry', () => {
  it('names exactly the six shipped effects, in presentation order', () => {
    expect([...EFFECT_IDS]).toEqual([
      'second-moon',
      'red-moon',
      'meteor',
      'observatory-signal',
      'forest-watcher',
      'lights-out',
    ]);
  });

  it('has no duplicate ids', () => {
    expect(new Set(EFFECT_IDS).size).toBe(EFFECT_IDS.length);
  });

  it('describes every id exactly once, in the same order', () => {
    expect(REGISTERED_EFFECTS.map((e) => e.id)).toEqual([...EFFECT_IDS]);
  });

  it('gives every effect a name and a description, because the editor shows both', () => {
    for (const effect of REGISTERED_EFFECTS) {
      expect(effect.name.trim(), `${effect.id} name`).not.toBe('');
      expect(effect.description.trim(), `${effect.id} description`).not.toBe('');
    }
  });

  it('gives every effect a positive, finite duration', () => {
    // The duration is what a manual trigger runs for; a zero or NaN here is an effect
    // that fires and is gone before a frame is drawn.
    for (const effect of REGISTERED_EFFECTS) {
      expect(Number.isFinite(effect.durationSeconds), `${effect.id}`).toBe(true);
      expect(effect.durationSeconds, `${effect.id}`).toBeGreaterThan(0);
    }
  });

  it('resolves a registered id, and refuses anything else by throwing', () => {
    for (const id of EFFECT_IDS) {
      expect(effectInfo(id).id).toBe(id);
    }
    // Throwing rather than returning a placeholder is deliberate: a silent fallback would
    // render a plausible-looking effect the engine cannot actually draw.
    expect(() => effectInfo('no-such-effect' as never)).toThrow();
  });

  it('names an effect for display, and falls back to the id rather than throwing', () => {
    // `effectName` is the tolerant one, for log lines and state read back from an older
    // file. The distinction matters: the mapper uses `isAnomalyKind` and can never reach
    // this with an unregistered value; a log line can.
    expect(effectName('red-moon')).toBe('Red Moon');
    expect(effectName('from-the-future')).toBe('from-the-future');
  });

  it('agrees with `isAnomalyKind` on every id', () => {
    for (const id of EFFECT_IDS) expect(isAnomalyKind(id)).toBe(true);
  });

  it('declares a landscape requirement exactly when the journal scopes it to one', () => {
    // `AnomalySystem.fitsWorld` is what actually refuses an effect in the wrong place;
    // this is the rule editor's honest label for that, and a label that disagrees with
    // the runtime check would tell a user a mapping is fine and then never fire it.
    for (const effect of REGISTERED_EFFECTS) {
      const def = BUILT_IN_ANOMALIES.find((a) => a.id === effect.id)!;
      const scoped = (def.biomes?.length ?? 0) > 0 || !!def.requiresStructure;
      expect(!!effect.needsLandscape, `${effect.id} needsLandscape`).toBe(scoped);
    }
  });

  it('agrees with the journal on every id, name and duration', () => {
    expect(BUILT_IN_ANOMALIES.map((a) => a.id).sort()).toEqual([...EFFECT_IDS].sort());
    for (const effect of REGISTERED_EFFECTS) {
      const def = BUILT_IN_ANOMALIES.find((a) => a.id === effect.id);
      expect(def, effect.id).toBeDefined();
      expect(def!.name, `${effect.id} name`).toBe(effect.name);
      expect(def!.duration, `${effect.id} duration`).toBe(effect.durationSeconds);
    }
  });
});
