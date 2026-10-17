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
  conclusionId,
  correlationFor,
  CORRELATIONS,
  resolvedIn,
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

  it('a conclusion takes attention out of the place', () => {
    let s = observe(emptyAttention(), 'town', 'forest', 'd1', T0).state;
    s = observe(s, 'town', 'observatory', 'd2', T0 + DAY).state;
    expect(s.worlds.town.attention).toBe(2);
    s = conclude(s, 'forest|observatory', 'town');
    expect(s.worlds.town.attention).toBe(1);
  });

  it('relief cannot drive attention below zero', () => {
    const seen = observe(emptyAttention(), 'town', 'forest', 'd1', T0).state;
    const after = conclude(seen, 'a', 'town');
    expect(after.worlds.town.attention).toBe(0);
  });

  it('relief is not repeatable for the same pair', () => {
    let s = observe(emptyAttention(), 'town', 'forest', 'd1', T0).state;
    s = conclude(s, 'a|b', 'town');
    expect(s.worlds.town.attention).toBe(0);
    // The state is returned unchanged, so there is nothing to farm.
    expect(conclude(s, 'a|b', 'town')).toBe(s);
  });

  it('a conclusion does not lower escalation', () => {
    // Neglect drove this place loud. Working one thing out does not make it forget.
    const seen = observe(emptyAttention(), 'town', 'forest', 'd1', T0).state;
    const loud = settle(seen, 'town', T0 + 20 * DAY);
    const earned = escalationOf(loud, 'town');
    const after = conclude(loud, 'a|b', 'town');
    expect(escalationOf(after, 'town')).toBe(earned);
  });

  it('a conclusion for an unknown place is still recorded', () => {
    const s = conclude(emptyAttention(), 'a|b', 'never-visited');
    expect(s.conclusions).toEqual(['a|b']);
    expect(s.worlds['never-visited']).toBeUndefined();
  });
});

describe('conclusionId', () => {
  it('is the same pair whichever order it is drawn in', () => {
    expect(conclusionId('forest', 'observatory')).toBe(conclusionId('observatory', 'forest'));
  });

  it('distinguishes different pairs', () => {
    expect(conclusionId('a', 'b')).not.toBe(conclusionId('a', 'c'));
  });
});

describe('correlations', () => {
  it('a curated pair means something, in either order', () => {
    expect(correlationFor('cabin', 'forest')).toBeTruthy();
    expect(correlationFor('forest', 'cabin')).toBe(correlationFor('cabin', 'forest'));
  });

  it('an unrelated pair means nothing', () => {
    expect(correlationFor('cabin', 'lighthouse')).toBeNull();
  });

  it('every curated key is a sorted pair of two zones that exist', () => {
    // A typo in a key would be an insight that could never fire, which is a secret
    // written and never reachable -- the exact failure this table is here to avoid.
    const ZONES = new Set(['observatory', 'radio-tower', 'cabin', 'lighthouse', 'moon', 'forest']);
    for (const key of Object.keys(CORRELATIONS)) {
      const parts = key.split('|');
      expect(parts).toHaveLength(2);
      expect([...parts]).toEqual([...parts].sort());
      for (const p of parts) expect(ZONES.has(p), `${key} names unknown zone ${p}`).toBe(true);
    }
  });

  it('every pair of zones that correlates is discoverable from the zone list', () => {
    // Four pairs out of fifteen is the whole point: a mechanic where almost
    // everything links is a mechanic with nothing to find.
    expect(Object.keys(CORRELATIONS).length).toBeGreaterThan(0);
    expect(Object.keys(CORRELATIONS).length).toBeLessThan(15);
  });

  it('a resolved correlation takes twice the relief of a bare link', () => {
    const base = observe(emptyAttention(), 'town', 'cabin', 'd1', T0).state;
    const paid = observe(base, 'town', 'forest', 'd2', T0 + DAY).state;
    expect(paid.worlds.town.attention).toBe(2);

    const bare = conclude(paid, 'x|y', 'town', null);
    const resolved = conclude(paid, 'x|y', 'town', correlationFor('cabin', 'forest'));
    expect(bare.worlds.town.attention).toBe(1);
    expect(resolved.worlds.town.attention).toBe(0);
  });
});

describe('the permanent mark', () => {
  it('a real correlation marks its structure; a bare link marks nothing', () => {
    const bare = conclude(emptyAttention(), 'cabin|forest', 'town', null);
    const real = conclude(
      emptyAttention(),
      'cabin|forest',
      'town',
      correlationFor('cabin', 'forest'),
    );
    expect(bare.resolved).toEqual([]);
    expect(real.resolved).toEqual(['town/cabin|forest']);
  });

  it('every correlation marks a landmark the player can actually click', () => {
    // A mark on a landmark that does not exist is a reward with no picture, which is
    // the failure mode this assertion exists to catch.
    const KINDS = new Set(['cabin', 'lighthouse', 'observatory', 'radio-tower']);
    for (const key of Object.keys(CORRELATIONS)) {
      const mark = CORRELATIONS[key].mark;
      expect(KINDS.has(mark), `${key} marks "${mark}", which is not a structure`).toBe(true);
    }
  });

  it('a mark belongs to the place where it was found', () => {
    // Resolving the dish and the moon is something that happened in this valley.
    // It must not follow the player to a salt flat that has never heard of it.
    const s = conclude(
      emptyAttention(),
      'moon|observatory',
      'town',
      correlationFor('moon', 'observatory'),
    );
    expect(resolvedIn(s, 'town')).toEqual(['town/moon|observatory']);
    expect(resolvedIn(s, 'coast')).toEqual([]);
  });

  it('survives a save and load', () => {
    // The whole point of a permanent consequence is that it is still there tomorrow.
    const s = conclude(
      emptyAttention(),
      'cabin|forest',
      'town',
      correlationFor('cabin', 'forest'),
    );
    expect(resolvedIn(reconcileAttention(s as never), 'town')).toEqual(['town/cabin|forest']);
  });

  it('a repeated correlation does not stack marks', () => {
    let s = emptyAttention();
    s = conclude(s, 'cabin|forest', 'town', correlationFor('cabin', 'forest'));
    s = conclude(s, 'cabin|forest', 'town', correlationFor('cabin', 'forest'));
    expect(resolvedIn(s, 'town')).toHaveLength(1);
  });

  it('a saved file with no resolved field loads instead of failing', () => {
    // State written before this existed has no `resolved` key at all.
    const old = { ...emptyAttention() } as Record<string, unknown>;
    delete old.resolved;
    expect(reconcileAttention(old as never).resolved).toEqual([]);
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