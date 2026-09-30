/**
 * Tests for the world integrity digest.
 *
 * The property that matters is not "produces a hex string" but "changes when the
 * world changes, and does not when it does not". Everything below follows from
 * that: a digest that ignored a field would let a world be edited in exactly the
 * place that matters while reporting nothing.
 */
import { describe, it, expect } from 'vitest';
import { canonicalJson, digestWorld, verifyWorld } from '../src/worlds/digest.js';

const world = () => ({
  id: 'test-world',
  name: 'Test World',
  biome: 'coast',
  terrain: { seed: 42, groundY: 0.7 },
  structures: [{ kind: 'lighthouse', x: 0.5 }],
  lore: { premise: 'a test', deniability: ['wind'] },
});

describe('canonicalJson', () => {
  it('is stable regardless of key order', () => {
    const a = { id: 'x', name: 'y', biome: 'coast' };
    const b = { biome: 'coast', name: 'y', id: 'x' };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('distinguishes values that differ', () => {
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
  });

  it('preserves array order, which is meaningful in a structure list', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('sorts nested objects too', () => {
    const a = { outer: { b: 1, a: 2 } };
    const b = { outer: { a: 2, b: 1 } };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });
});

describe('digestWorld', () => {
  it('is deterministic', () => {
    expect(digestWorld(world())).toBe(digestWorld(world()));
  });

  it('is unaffected by key order', () => {
    const w = world();
    const reordered = { lore: w.lore, structures: w.structures, terrain: w.terrain, biome: w.biome, name: w.name, id: w.id };
    expect(digestWorld(w)).toBe(digestWorld(reordered));
  });

  it('changes when the seed changes', () => {
    const a = world();
    const b = { ...world(), terrain: { ...a.terrain, seed: 43 } };
    expect(digestWorld(a)).not.toBe(digestWorld(b));
  });

  it('changes when a structure is added', () => {
    const a = world();
    const b = { ...a, structures: [...a.structures, { kind: 'tower', x: 0.2 }] };
    expect(digestWorld(a)).not.toBe(digestWorld(b));
  });

  it('changes when the biome changes', () => {
    expect(digestWorld(world())).not.toBe(digestWorld({ ...world(), biome: 'alpine' }));
  });

  it('changes when the name changes, since a name is user-visible content', () => {
    expect(digestWorld(world())).not.toBe(digestWorld({ ...world(), name: 'Renamed' }));
  });

  it('records the algorithm in the digest', () => {
    expect(digestWorld(world())).toMatch(/^fnv128:[0-9a-f]{32}$/);
  });
});

describe('verifyWorld', () => {
  it('accepts a world that matches its recorded digest', () => {
    const w = world();
    expect(verifyWorld(w, digestWorld(w))).toBe(true);
  });

  it('rejects a world that was edited after the digest was taken', () => {
    const recorded = digestWorld(world());
    const edited = { ...world(), name: 'Edited behind the user’s back' };
    expect(verifyWorld(edited, recorded)).toBe(false);
  });

  it('treats a world with no recorded digest as unchanged', () => {
    // Worlds imported before digests existed have no digest. Refusing them would
    // be a worse failure than accepting one that predates the check.
    expect(verifyWorld(world(), undefined)).toBe(true);
    expect(verifyWorld(world(), null)).toBe(true);
    expect(verifyWorld(world(), '')).toBe(true);
  });

  it('does not accept a digest recorded for a different world', () => {
    const other = { ...world(), id: 'other-world' };
    expect(verifyWorld(world(), digestWorld(other))).toBe(false);
  });
});
