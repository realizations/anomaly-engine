import { describe, it, expect } from 'vitest';
import { validateWorld } from '../src/worlds/types.js';
import { BUILT_IN_WORLDS, findBuiltInWorld } from '../src/worlds/registry.js';
import { WorldLoader } from '../src/worlds/WorldLoader.js';

function world(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'test-world',
    name: 'Test World',
    author: 'tester',
    version: '0.1.0',
    engine: '0.1',
    description: 'A world for testing.',
    biome: 'temperate-forest',
    terrain: { seed: 42 },
    structures: [{ kind: 'cabin', x: 0.5 }],
    ...over,
  };
}

describe('validateWorld', () => {
  it('accepts a minimal valid world', () => {
    const r = validateWorld(world());
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('rejects non-objects', () => {
    for (const bad of [null, undefined, 42, 'world', []]) {
      expect(validateWorld(bad).valid).toBe(false);
    }
  });

  it('requires every mandatory string field', () => {
    for (const field of ['id', 'name', 'version', 'engine', 'description', 'biome']) {
      const r = validateWorld(world({ [field]: undefined }));
      expect(r.valid).toBe(false);
      expect(r.errors.join(' ')).toContain(field);
    }
  });

  it('requires kebab-case ids', () => {
    for (const id of ['Bad Id', 'UPPER', 'trailing-', '-leading', 'has_underscore', '']) {
      expect(validateWorld(world({ id })).valid).toBe(false);
    }
    for (const id of ['ok', 'two-words', 'a1-b2']) {
      expect(validateWorld(world({ id })).valid).toBe(true);
    }
  });

  it('rejects unknown biomes', () => {
    expect(validateWorld(world({ biome: 'volcano' })).valid).toBe(false);
  });

  it('accepts every declared biome', () => {
    for (const biome of ['temperate-forest', 'alpine', 'coast', 'high-desert', 'salt-marsh']) {
      expect(validateWorld(world({ biome })).valid).toBe(true);
    }
  });

  it('requires a numeric terrain seed', () => {
    expect(validateWorld(world({ terrain: {} })).valid).toBe(false);
    expect(validateWorld(world({ terrain: { seed: NaN } })).valid).toBe(false);
    expect(validateWorld(world({ terrain: { seed: 'x' } })).valid).toBe(false);
  });

  it('rejects terrain arrays that are not three finite numbers', () => {
    for (const key of ['ridgeBaseY', 'ridgeAmp', 'ridgeFreq', 'ridgePresence', 'forestDensity']) {
      expect(validateWorld(world({ terrain: { seed: 1, [key]: [1, 2] } })).valid).toBe(false);
      expect(validateWorld(world({ terrain: { seed: 1, [key]: [1, 2, 3, 4] } })).valid).toBe(false);
      expect(validateWorld(world({ terrain: { seed: 1, [key]: [1, 2, 'x'] } })).valid).toBe(false);
      expect(validateWorld(world({ terrain: { seed: 1, [key]: [1, 2, 3] } })).valid).toBe(true);
    }
  });

  it('constrains groundY to strictly between 0 and 1', () => {
    for (const v of [0, 1, -0.1, 1.1, 0.7]) {
      expect(validateWorld(world({ terrain: { seed: 1, groundY: v } })).valid).toBe(v === 0.7);
    }
  });

  it('rejects out-of-range saturation', () => {
    expect(validateWorld(world({ palette: { saturation: -0.1 } })).valid).toBe(false);
    expect(validateWorld(world({ palette: { saturation: 2.1 } })).valid).toBe(false);
    expect(validateWorld(world({ palette: { saturation: 1 } })).valid).toBe(true);
  });

  it('rejects unknown structure kinds and out-of-range positions', () => {
    expect(validateWorld(world({ structures: [{ kind: 'spaceship', x: 0.5 }] })).valid).toBe(false);
    expect(validateWorld(world({ structures: [{ kind: 'cabin', x: 5 }] })).valid).toBe(false);
    expect(validateWorld(world({ structures: [{ kind: 'cabin', x: -5 }] })).valid).toBe(false);
    expect(validateWorld(world({ structures: [{ kind: 'cabin', x: 1.1 }] })).valid).toBe(true);
  });

  it('warns rather than fails on a world with no structures', () => {
    const r = validateWorld(world({ structures: [] }));
    expect(r.valid).toBe(true);
    expect(r.warnings.join(' ')).toContain('structures');
  });

  it('warns when lore has no deniability', () => {
    const r = validateWorld(world({ lore: { premise: 'x' } }));
    expect(r.valid).toBe(true);
    expect(r.warnings.join(' ')).toContain('deniability');
  });
});

describe('built-in worlds', () => {
  it('all pass validation', () => {
    expect(BUILT_IN_WORLDS.length).toBeGreaterThanOrEqual(4);
    for (const w of BUILT_IN_WORLDS) {
      const r = validateWorld(w);
      expect(r.errors, `${w.id}: ${r.errors.join('; ')}`).toHaveLength(0);
      expect(r.valid).toBe(true);
    }
  });

  it('have unique ids and distinct seeds', () => {
    const ids = BUILT_IN_WORLDS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    const seeds = BUILT_IN_WORLDS.map((w) => w.terrain.seed);
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  it('cover at least four distinct biomes', () => {
    const biomes = new Set(BUILT_IN_WORLDS.map((w) => w.biome));
    expect(biomes.size).toBeGreaterThanOrEqual(4);
  });

  it('every structure kind used is renderable', () => {
    const known = new Set([
      'cabin', 'radio-tower', 'observatory', 'lighthouse', 'ruin', 'well',
      'dishes', 'cairn', 'pylon-run', 'fence-line', 'rock-field',
      'reed-bank', 'snowbank', 'butte',
    ]);
    for (const w of BUILT_IN_WORLDS) {
      for (const s of w.structures ?? []) {
        expect(known.has(s.kind), `${w.id} uses unknown structure ${s.kind}`).toBe(true);
      }
    }
  });

  it('looks up by id', () => {
    expect(findBuiltInWorld('saltwick')?.biome).toBe('salt-marsh');
    expect(findBuiltInWorld('nope')).toBeNull();
  });
});

describe('WorldLoader', () => {
  it('starts with the built-in worlds registered', () => {
    const l = new WorldLoader();
    expect(l.getAll().length).toBe(BUILT_IN_WORLDS.length);
    expect(l.getActive()).toBeNull();
  });

  it('activates a world and notifies listeners', () => {
    const l = new WorldLoader();
    const seen: Array<string | null> = [];
    l.onChange((id) => seen.push(id));
    const w = l.activate('the-long-fell');
    expect(w?.id).toBe('the-long-fell');
    expect(l.getActiveId()).toBe('the-long-fell');
    expect(seen).toEqual(['the-long-fell']);
  });

  it('falls back to the default world for an unknown id', () => {
    const l = new WorldLoader();
    const w = l.activate('does-not-exist');
    expect(w?.id).toBe(BUILT_IN_WORLDS[0].id);
  });

  it('cycles forwards and wraps', () => {
    const l = new WorldLoader();
    const all = l.getAll();
    l.activate(all[0].id);
    expect(l.next()?.id).toBe(all[1].id);
    expect(l.next()?.id).toBe(all[2].id);
    l.activate(all[all.length - 1].id);
    expect(l.next()?.id).toBe(all[0].id);
  });

  it('cycles backwards and wraps', () => {
    const l = new WorldLoader();
    const all = l.getAll();
    l.activate(all[0].id);
    expect(l.previous()?.id).toBe(all[all.length - 1].id);
  });

  it('registers a valid external world and rejects an invalid one', () => {
    const l = new WorldLoader();
    const before = l.getAll().length;
    expect(l.register(world({ id: 'external' })).valid).toBe(true);
    expect(l.getAll().length).toBe(before + 1);
    expect(l.register(world({ id: 'BAD' })).valid).toBe(false);
    expect(l.getAll().length).toBe(before + 1);
  });

  it('registerAll aggregates errors with the offending id', () => {
    const l = new WorldLoader();
    const r = l.registerAll([world({ id: 'ok-one' }), world({ id: 'BAD' })]);
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toContain('BAD');
    expect(l.has('ok-one')).toBe(true);
    expect(l.has('BAD')).toBe(false);
  });

  it('unsubscribes listeners', () => {
    const l = new WorldLoader();
    let count = 0;
    const off = l.onChange(() => { count++; });
    l.activate(BUILT_IN_WORLDS[0].id);
    off();
    l.activate(BUILT_IN_WORLDS[1].id);
    expect(count).toBe(1);
  });

  it('refuses to remove the fallback world', () => {
    const l = new WorldLoader();
    expect(l.remove(BUILT_IN_WORLDS[0].id)).toBe(false);
    expect(l.has(BUILT_IN_WORLDS[0].id)).toBe(true);
  });
});
