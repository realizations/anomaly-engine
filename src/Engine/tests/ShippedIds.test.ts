import { describe, it, expect } from 'vitest';
import { BUILTIN_SECRETS, SecretSystem } from '../src/systems/SecretSystem.js';
import { BUILT_IN_ANOMALIES } from '../src/anomalies/builtin.js';
import { BUILT_IN_WORLDS, findBuiltInWorld } from '../src/worlds/registry.js';
import { RANDOM_EVENT_TYPES } from '../src/events/RandomSource.js';

/**
 * Every identifier the data files name, checked against what actually ships.
 *
 * This file exists because the same mistake was made four times in a week, in four
 * places, and each one was invisible:
 *
 *   * MomentSystem named `anomaly.red_moon`, `anomaly.meteor`,
 *     `anomaly.forest_watcher` and `anomaly.radio_signal` -- none emitted
 *   * worldFlavor could be keyed on a world or anomaly that does not exist
 *   * the locale keys named `settings.audio` and `settings.secrets`, which are not
 *     settings pages
 *   * SecretSystem named `constellation-shift` and `time-0333` as anomalies
 *
 * Nothing crashed in any of those cases. A wrong id in this codebase produces a
 * lookup that misses and a fallback that looks fine, so the only defence is to
 * assert the names themselves.
 *
 * The cost of that pattern is a name that reads as a link and is not one. A player
 * following "the red moon is not an anomaly" has been told to look for something the
 * engine cannot produce.
 */
const ANOMALY_IDS = new Set(BUILT_IN_ANOMALIES.map((a) => a.id));
const WORLD_IDS = new Set(BUILT_IN_WORLDS.map((w) => w.id));
const EMITTABLE = new Set<string>([
  ...RANDOM_EVENT_TYPES,
  'time.hourly',
  'time.midnight',
  'time.0333',
  'weather.rain',
]);

describe('shipped identifiers', () => {
  it('anomaly ids are unique', () => {
    const ids = BUILT_IN_ANOMALIES.map((a) => a.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it('world ids are unique', () => {
    const ids = BUILT_IN_WORLDS.map((w) => w.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it('anomaly seeds are unique, or two worlds would share a look', () => {
    // The world format documentation makes this a rule; nothing enforced it.
    const seeds = BUILT_IN_WORLDS.map((w) => w.terrain.seed);
    expect(seeds.filter((s, i) => seeds.indexOf(s) !== i)).toEqual([]);
  });

  it('every secret relates only to anomalies that ship', () => {
    const unknown = BUILTIN_SECRETS.flatMap((s) =>
      s.relatedAnomalies.filter((id) => !ANOMALY_IDS.has(id)).map((id) => `${s.id}/${id}`)
    );
    expect(unknown).toEqual([]);
  });

  it('every secret offers clues to find it by', () => {
    // A secret with no clues is not findable, which defeats the point of shipping it.
    for (const s of BUILTIN_SECRETS) {
      expect(s.clues.length).toBeGreaterThan(0);
      expect(s.hints.length).toBeGreaterThan(0);
    }
  });

  it('every world has lore, because the premise is what the journal is about', () => {
    for (const w of BUILT_IN_WORLDS) {
      expect(w.lore.premise.length).toBeGreaterThan(0);
      // Deniability is the whole ARG premise: every anomaly is paired with a
      // plausible reason nothing is happening.
      expect(w.lore.deniability.length).toBeGreaterThan(0);
    }
  });

  it('every world either has structures or is the one drawn by a separate constructor', () => {
    // The interior world has no structures key at all -- `structures` is optional,
    // and WorldRenderer dispatches that biome to LiminalInterior before the terrain
    // path ever runs. Every other world is a landscape, and a landscape with nothing
    // standing in it is almost certainly a world whose structures were dropped rather
    // than one that meant to be empty.
    const empty = BUILT_IN_WORLDS.filter((w) => !w.structures || w.structures.length === 0).map((w) => w.id);
    expect(empty).toEqual(['the-long-corridor']);
  });

  it('every structure names a kind and sits inside the frame', () => {
    for (const w of BUILT_IN_WORLDS) {
      for (const s of w.structures ?? []) {
        expect({ world: w.id, kind: s.kind.length > 0 }).toEqual({ world: w.id, kind: true });
        // A structure placed off the edge is invisible, and x is the only axis the
        // renderer reads for placement.
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.x).toBeLessThanOrEqual(1);
      }
    }
  });

  it('the liminal world is the one built by a separate constructor', () => {
    // It has no terrain in the usual sense, so it is the odd one out and is expected
    // to be; this asserts the exception is deliberate rather than accidental, and
    // that it is still reachable by id.
    const corridor = BUILT_IN_WORLDS.find((w) => w.id === 'the-long-corridor');
    expect(corridor).toBeDefined();
    expect(corridor!.biome).toBe('liminal-interior');
    expect(findBuiltInWorld('the-long-corridor')).toBeDefined();
    expect(findBuiltInWorld('no-such-world')).toBeNull();
  });

  it('discovery refuses an id it does not have, rather than recording a blank', () => {
    const s = new SecretSystem();
    expect(s.discover('no-such-secret')).toBe(false);
    expect(s.discover(BUILTIN_SECRETS[0].id)).toBe(true);
    expect(s.discover(BUILTIN_SECRETS[0].id)).toBe(false);
  });

  it('world and anomaly ids contain no whitespace, since they travel through the bridge', () => {
    for (const w of BUILT_IN_WORLDS) expect(w.id).toMatch(/^[a-z0-9-]+$/);
    for (const a of BUILT_IN_ANOMALIES) expect(a.id).toMatch(/^[a-z0-9-]+$/);
  });

  it('every emitted event type is namespaced, so a random event cannot collide with a clock one', () => {
    for (const type of EMITTABLE) expect(type).toMatch(/^(time|random|weather)\.[a-z0-9_.]+$/);
  });
});