import { describe, it, expect } from 'vitest';
import { BUILT_IN_WORLDS, findBuiltInWorld } from '../src/worlds/registry.js';
import { validateWorld } from '../src/worlds/types.js';

const LIMINAL = findBuiltInWorld('the-long-corridor');

describe('Liminal interior world', () => {
  it('ships as a built-in world', () => {
    expect(LIMINAL).not.toBeNull();
    expect(BUILT_IN_WORLDS.some((w) => w.id === 'the-long-corridor')).toBe(true);
  });

  it('validates cleanly as a liminal interior', () => {
    const result = validateWorld(LIMINAL);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('uses the liminal-interior biome', () => {
    expect(LIMINAL!.biome).toBe('liminal-interior');
  });

  it('declares the geometry that makes the space liminal', () => {
    const l = LIMINAL!.liminal;
    expect(l).toBeDefined();
    // Off-centre vanishing point: a centred one reads as a diagram.
    expect(l!.vanishingX).toBeGreaterThan(0.1);
    expect(l!.vanishingX).toBeLessThan(0.9);
    expect(l!.vanishingX).not.toBe(0.5);
    // Enough bays that the repetition is felt.
    expect(l!.bays).toBeGreaterThanOrEqual(4);
    // Institutional tile size.
    expect(l!.tile).toBeGreaterThan(12);
    // Enclosed and lit by the building, not by the sky.
    expect(l!.ceiling).toBe(1);
    expect(l!.lightLevel).toBeGreaterThan(0);
  });

  it('gives every anomaly a deniability so a sighting can be dismissed', () => {
    expect(LIMINAL!.lore?.deniability?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('disables sky features an interior cannot have', () => {
    expect(LIMINAL!.features?.weather).toBe(false);
    expect(LIMINAL!.features?.astronomy).toBe(false);
  });

  it('gives the interior a distinct seed so it never shares landform data', () => {
    const seeds = BUILT_IN_WORLDS.map((w) => w.terrain.seed);
    expect(new Set(seeds).size).toBe(seeds.length);
  });
});

describe('Liminal profile validation', () => {
  const base = () => JSON.parse(JSON.stringify(LIMINAL));

  it('rejects a bay count outside the sane range', () => {
    const w = base();
    w.liminal.bays = 500;
    expect(validateWorld(w).errors.some((e) => e.includes('bays'))).toBe(true);
    w.liminal.bays = 0;
    expect(validateWorld(w).errors.some((e) => e.includes('bays'))).toBe(true);
  });

  it('rejects a vanishing point at the frame edge', () => {
    const w = base();
    w.liminal.vanishingX = 0.99;
    expect(validateWorld(w).errors.some((e) => e.includes('vanishingX'))).toBe(true);
  });

  it('rejects out-of-range light and ceiling values', () => {
    const w = base();
    w.liminal.lightLevel = 4;
    expect(validateWorld(w).errors.some((e) => e.includes('lightLevel'))).toBe(true);
    w.liminal.lightLevel = 0.8;
    w.liminal.ceiling = -1;
    expect(validateWorld(w).errors.some((e) => e.includes('ceiling'))).toBe(true);
  });

  it('warns when a liminal profile is attached to a non-liminal world', () => {
    const w = base();
    w.biome = 'temperate-forest';
    const result = validateWorld(w);
    expect(result.warnings.some((x) => x.includes('liminal profile'))).toBe(true);
  });

  it('warns when a liminal world omits its profile', () => {
    const w = base();
    delete w.liminal;
    const result = validateWorld(w);
    expect(result.warnings.some((x) => x.includes('no liminal profile'))).toBe(true);
    // Still valid, because the engine has defaults.
    expect(result.valid).toBe(true);
  });
});
