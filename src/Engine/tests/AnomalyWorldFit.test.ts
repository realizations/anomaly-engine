import { describe, it, expect, beforeEach } from 'vitest';
import { AnomalySystem } from '../src/anomalies/AnomalyRegistry.js';
import { flavorFor } from '../src/anomalies/worldFlavor.js';
import { BUILT_IN_WORLDS } from '../src/worlds/registry.js';
import type { WorldDefinition } from '../src/worlds/types.js';

/** Mirrors the definitions registered by the engine. */
function registerBuiltIns(sys: AnomalySystem): void {
  sys.register({ id: 'second-moon', name: 'Second Moon', description: '', category: 'cosmic', rarity: 'very_rare', cooldown: 0, duration: 8, effects: [] });
  sys.register({ id: 'red-moon', name: 'Red Moon', description: '', category: 'cosmic', rarity: 'legendary', cooldown: 0, duration: 300, effects: [] });
  sys.register({ id: 'meteor', name: 'Meteor', description: '', category: 'visual', rarity: 'common', cooldown: 0, duration: 4, effects: [] });
  sys.register({ id: 'forest-watcher', name: 'Watcher', description: '', category: 'behavioral', rarity: 'very_rare', cooldown: 0, duration: 12, biomes: ['temperate-forest'], effects: [] });
  sys.register({ id: 'observatory-signal', name: 'Observatory Signal', description: '', category: 'cosmic', rarity: 'rare', cooldown: 0, duration: 30, requiresStructure: 'observatory', effects: [] });
  sys.register({ id: 'lights-out', name: 'Lights Out', description: '', category: 'behavioral', rarity: 'rare', cooldown: 0, duration: 10, biomes: ['temperate-forest', 'salt-marsh', 'coast'], effects: [] });
}

function world(id: string): WorldDefinition {
  const w = BUILT_IN_WORLDS.find((x) => x.id === id);
  if (!w) throw new Error(`missing world ${id}`);
  return w;
}

describe('Anomaly world-fit', () => {
  let sys: AnomalySystem;
  beforeEach(() => {
    sys = new AnomalySystem();
    registerBuiltIns(sys);
  });

  it('keeps cosmic anomalies eligible everywhere', () => {
    for (const id of ['second-moon', 'red-moon', 'meteor']) {
      for (const w of BUILT_IN_WORLDS) {
        expect(sys.fitsWorld(sys.getDefinitions().find((d) => d.id === id)!, w)).toBe(true);
      }
    }
  });

  it('does not put a forest-watcher in a world with no trees', () => {
    const def = sys.getDefinitions().find((d) => d.id === 'forest-watcher')!;
    expect(sys.fitsWorld(def, world('the-town-that-wasnt-there'))).toBe(true);
    expect(sys.fitsWorld(def, world('saltwick'))).toBe(false);
    expect(sys.fitsWorld(def, world('the-dry-mere'))).toBe(false);
    expect(sys.fitsWorld(def, world('the-long-head'))).toBe(false);
  });

  it('only fires an observatory-signal where an observatory exists', () => {
    const def = sys.getDefinitions().find((d) => d.id === 'observatory-signal')!;
    expect(sys.fitsWorld(def, world('the-town-that-wasnt-there'))).toBe(true);
    expect(sys.fitsWorld(def, world('the-long-fell'))).toBe(true);
    expect(sys.fitsWorld(def, world('saltwick'))).toBe(false);
    expect(sys.fitsWorld(def, world('the-dry-mere'))).toBe(false);
    expect(sys.fitsWorld(def, world('the-long-head'))).toBe(false);
  });

  it('keeps lights-out away from worlds with no lit settlement', () => {
    const def = sys.getDefinitions().find((d) => d.id === 'lights-out')!;
    expect(sys.fitsWorld(def, world('the-town-that-wasnt-there'))).toBe(true);
    expect(sys.fitsWorld(def, world('saltwick'))).toBe(true);
    expect(sys.fitsWorld(def, world('the-long-head'))).toBe(true);
    // No settlement and no lit structures.
    expect(sys.fitsWorld(def, world('the-dry-mere'))).toBe(false);
    expect(sys.fitsWorld(def, world('the-long-fell'))).toBe(false);
  });

  it('chooses the preferred anomaly when it fits', () => {
    const chosen = sys.chooseForWorld(world('the-town-that-wasnt-there'), 'forest-watcher');
    expect(chosen?.id).toBe('forest-watcher');
  });

  it('substitutes a fitting anomaly when the preferred one does not fit', () => {
    // The desert has no observatory, so an observatory-signal must not fire.
    const chosen = sys.chooseForWorld(world('the-dry-mere'), 'observatory-signal');
    expect(chosen).not.toBeNull();
    expect(chosen?.id).not.toBe('observatory-signal');
    // Whatever it picks must actually fit the world.
    expect(sys.fitsWorld(chosen!, world('the-dry-mere'))).toBe(true);
  });

  it('always leaves every world with at least one eligible anomaly', () => {
    for (const w of BUILT_IN_WORLDS) {
      const fitting = sys.getDefinitions().filter((d) => sys.fitsWorld(d, w));
      expect(fitting.length).toBeGreaterThan(0);
    }
  });

  it('returns null only when nothing fits', () => {
    const empty = new AnomalySystem();
    expect(empty.chooseForWorld(world('saltwick'), 'meteor')).toBeNull();
  });
});

describe('Anomaly world flavour', () => {
  it('names the same anomaly differently per world', () => {
    const inTown = flavorFor(world('the-town-that-wasnt-there'), 'lights-out');
    const onHead = flavorFor(world('the-long-head'), 'lights-out');
    expect(inTown.name).not.toBe(onHead.name);
  });

  it('always supplies a deniability so a sighting can be dismissed', () => {
    for (const w of BUILT_IN_WORLDS) {
      for (const id of ['second-moon', 'red-moon', 'meteor', 'forest-watcher', 'observatory-signal', 'lights-out']) {
        const f = flavorFor(w, id);
        expect(f.deniability.length).toBeGreaterThan(0);
        expect(f.note.length).toBeGreaterThan(0);
        expect(f.name.length).toBeGreaterThan(0);
      }
    }
  });

  it('falls back to a generic flavour for an unknown anomaly', () => {
    const f = flavorFor(world('saltwick'), 'not-a-real-anomaly');
    expect(f.name).toBe('not-a-real-anomaly');
    expect(f.deniability.length).toBeGreaterThan(0);
  });
});
