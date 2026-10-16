import { describe, it, expect } from 'vitest';
import {
  emptyAttention,
  observe,
  settle,
  settleAll,
  escalationOf,
  anomalyRateMultiplier,
  conclude,
  observationId,
  observationCount,
  reconcileAttention,
  ATTENTION_CEILING,
  MAX_ESCALATION,
  NEGLECT_DAYS,
} from '../src/systems/Attention.js';

const DAY = 86_400_000;
const T0 = 1_700_000_000_000;

describe('attention', () => {
  it('a place nobody has looked at starts at nothing', () => {
    const s = emptyAttention();
    expect(escalationOf(s, 'the-town-that-wasnt-there')).toBe(0);
    expect(observationCount(s, 'the-town-that-wasnt-there')).toBe(0);
  });

  it('one observation raises attention and records it', () => {
    const r = observe(emptyAttention(), 'town', 'observatory', '2024-05-01', T0);
    expect(r.paid).toBe(true);
    expect(observationCount(r.state, 'town')).toBe(1);
  });

  it('looking twice at the same thing on the same day does not pay twice', () => {
    const first = observe(emptyAttention(), 'town', 'observatory', '2024-05-01', T0);
    const second = observe(first.state, 'town', 'observatory', '2024-05-01', T0 + 1000);
    expect(second.paid).toBe(false);
    expect(observationCount(second.state, 'town')).toBe(1);
  });

  it('the same look on a later day does pay again', () => {
    const first = observe(emptyAttention(), 'town', 'observatory', '2024-05-01', T0);
    const second = observe(first.state, 'town', 'observatory', '2024-05-02', T0 + DAY);
    expect(second.paid).toBe(true);
    expect(observationCount(second.state, 'town')).toBe(2);
  });

  it('attention is capped, so holding still cannot farm it', () => {
    let s = emptyAttention();
    for (let d = 0; d < 20; d++) {
      s = observe(s, 'town', 'observatory', `2024-05-${String(d + 1).padStart(2, '0')}`, T0).state;
    }
    expect(s.worlds.town.attention).toBe(ATTENTION_CEILING);
  });

  it('observation ids are stable and include the day', () => {
    expect(observationId('town', 'forest', '2024-05-01')).toBe('town/forest/2024-05-01');
    expect(observationId('town', 'forest', '2024-05-02')).not.toBe(
      observationId('town', 'forest', '2024-05-01'),
    );
  });
});

describe('decay and neglect', () => {
  it('attention halves over the half life', () => {
    // Two days' worth of attention, measured inside the neglect grace window so this
    // is decay alone. At three days the two rules cancel, which is asserted separately.
    let seen = observe(emptyAttention(), 'town', 'forest', 'd1', T0).state;
    seen = observe(seen, 'town', 'observatory', 'd2', T0 + DAY).state;
    expect(seen.worlds.town.attention).toBe(2);

    const later = settle(seen, 'town', T0 + 2 * DAY);
    expect(later.worlds.town.attention).toBeCloseTo(1.5874, 3);
  });

  it('decay and neglect cancel at three days, which is the design', () => {
    const seen = observe(emptyAttention(), 'town', 'forest', 'd1', T0).state;
    // One attention, three days: decayed to 0.5 by the half life, then pushed back up
    // by one day of neglect pressure. The net is unchanged, which is deliberate --
    // a place left for three days neither fades nor calms down.
    const later = settle(seen, 'town', T0 + 3 * DAY);
    expect(later.worlds.town.attention).toBeCloseTo(1.0, 5);
  });

  it('a place left alone gets louder rather than quieter', () => {
    const seen = observe(emptyAttention(), 'town', 'forest', 'd1', T0).state;
    // A long absence: decay alone would have driven this to nothing.
    const ignored = settle(seen, 'town', T0 + 30 * DAY);
    expect(escalationOf(ignored, 'town')).toBeGreaterThan(escalationOf(seen, 'town'));
  });

  it('neglect does not apply inside the grace period', () => {
    const seen = observe(emptyAttention(), 'town', 'forest', 'd1', T0).state;
    const soon = settle(seen, 'town', T0 + (NEGLECT_DAYS - 1) * DAY);
    // Within the grace window this is decay only, so a single look cannot escalate.
    expect(escalationOf(soon, 'town')).toBe(0);
  });

  it('escalation never falls once earned', () => {
    const seen = observe(emptyAttention(), 'town', 'forest', 'd1', T0).state;
    const loud = settle(seen, 'town', T0 + 20 * DAY);
    const earned = escalationOf(loud, 'town');
    expect(earned).toBeGreaterThan(0);
    // Coming back and settling again must not take it away.
    const after = settle(loud, 'town', T0 + 21 * DAY);
    expect(escalationOf(after, 'town')).toBeGreaterThanOrEqual(earned);
  });

  it('escalation is clamped at the top', () => {
    const seen = observe(emptyAttention(), 'town', 'forest', 'd1', T0).state;
    const ancient = settle(seen, 'town', T0 + 3650 * DAY);
    expect(escalationOf(ancient, 'town')).toBeLessThanOrEqual(MAX_ESCALATION);
  });

  it('settle leaves an unknown place alone rather than inventing one', () => {
    const s = emptyAttention();
    expect(settle(s, 'nowhere', T0)).toBe(s);
  });

  it('settleAll settles every place it knows about', () => {
    let s = emptyAttention();
    s = observe(s, 'town', 'forest', 'd1', T0).state;
    s = observe(s, 'salt', 'lighthouse', 'd1', T0).state;
    const all = settleAll(s, T0 + 30 * DAY);
    expect(escalationOf(all, 'town')).toBeGreaterThan(0);
    expect(escalationOf(all, 'salt')).toBeGreaterThan(0);
  });
});

describe('escalation consequences', () => {
  it('a quiet place fires at full rate and a loud one much slower', () => {
    expect(anomalyRateMultiplier(0)).toBe(1);
    expect(anomalyRateMultiplier(MAX_ESCALATION)).toBeLessThan(0.5);
  });

  it('the multiplier never reaches zero, so a loud place is quiet rather than dead', () => {
    expect(anomalyRateMultiplier(999)).toBeGreaterThanOrEqual(0.2);
    expect(anomalyRateMultiplier(-5)).toBe(1);
  });

  it('the multiplier falls monotonically with escalation', () => {
    let previous = Infinity;
    for (let level = 0; level <= MAX_ESCALATION; level++) {
      const now = anomalyRateMultiplier(level);
      expect(now).toBeLessThanOrEqual(previous);
      previous = now;
    }
  });
});

describe('conclusions', () => {
  it('a conclusion is recorded once', () => {
    const first = conclude(emptyAttention(), 'observatory/traffic/link');
    expect(first.conclusions).toHaveLength(1);
    const second = conclude(first, 'observatory/traffic/link');
    expect(second.conclusions).toHaveLength(1);
  });

  it('distinct conclusions accumulate', () => {
    let s = emptyAttention();
    s = conclude(s, 'a');
    s = conclude(s, 'b');
    expect(s.conclusions).toEqual(['a', 'b']);
  });
});

describe('reconcileAttention', () => {
  it('an absent record produces an empty state', () => {
    expect(reconcileAttention(undefined).worlds).toEqual({});
    expect(reconcileAttention(null).worlds).toEqual({});
    expect(reconcileAttention('nonsense').worlds).toEqual({});
  });

  it('clamps an escalation written by hand', () => {
    const r = reconcileAttention({ worlds: { town: { escalation: 9999, attention: 1e9 } } });
    expect(escalationOf(r, 'town')).toBe(MAX_ESCALATION);
    expect(r.worlds.town.attention).toBe(ATTENTION_CEILING);
  });

  it('rejects a negative escalation', () => {
    const r = reconcileAttention({ worlds: { town: { escalation: -4 } } });
    expect(escalationOf(r, 'town')).toBe(0);
  });

  it('drops malformed observations and keeps the good ones', () => {
    const r = reconcileAttention({
      worlds: { town: { observations: ['a', 7, null, 'b'] } },
    });
    expect(r.worlds.town.observations).toEqual(['a', 'b']);
  });

  it('survives a world entry that is not an object', () => {
    const r = reconcileAttention({ worlds: { town: 'broken', salt: { escalation: 2 } } });
    expect(r.worlds.town).toBeUndefined();
    expect(escalationOf(r, 'salt')).toBe(2);
  });

  it('keeps only string conclusions', () => {
    const r = reconcileAttention({ conclusions: ['ok', 3, null] });
    expect(r.conclusions).toEqual(['ok']);
  });
});