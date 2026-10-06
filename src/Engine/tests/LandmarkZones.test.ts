import { describe, it, expect } from 'vitest';
import { describeZones, overlappingZones, DEFAULT_DWELL_MS } from '../src/systems/landmarkZones.js';
import { BUILTIN_EASTER_EGGS } from '../src/systems/EasterEggSystem.js';
import type { InteractionSurfaces, LandmarkRect, ScreenRect } from '../src/renderer/WorldRenderer.js';

/**
 * The zone table, and the two properties it exists to guarantee.
 *
 * Zones were the missing link in M2: `InteractionSystem.registerZone` had no callers, so
 * the zone map was empty and every trigger that depended on one was unreachable. This
 * covers the decision layer directly -- which regions become zones, and whether each
 * zone's trigger is something the egg table can actually hear.
 *
 * The renderer's own geometry is deliberately *not* rebuilt here. The anchor trap is the
 * reason: `structures[].x` is authored in one coordinate system and rendered in another,
 * so a test that constructed rects from world data would be asserting a number the
 * renderer never draws. `getLandmarkRects()` is the authority, and it is exercised
 * against real output by `tools/story-beats.mjs`.
 */

function landmark(
  kind: LandmarkRect['kind'],
  x: number,
  y = 0.5,
  id = `${kind}@${x}`
): LandmarkRect {
  return { id, kind, x, y, width: 0.06, height: 0.07 };
}

const FOREST: ScreenRect = { x: 0, y: 0.63, width: 1, height: 0.13 };

function surfaces(partial: Partial<InteractionSurfaces> = {}): InteractionSurfaces {
  return { landmarks: [], moon: null, forest: FOREST, ...partial };
}

const MOON: ScreenRect = { x: 0.7, y: 0.2, width: 0.06, height: 0.1 };

describe('zone selection', () => {
  it('finds nothing to point at in an empty scene', () => {
    // An interior world is a normal state, not a failure. The treeline is a band of
    // ground rather than a landmark, so it survives a scene with no structures in it;
    // what an empty scene has none of is anywhere the cursor could be aimed.
    const out = describeZones(surfaces());
    expect(out.filter((z) => z.id !== 'forest')).toEqual([]);
  });

  it('is curated: scenery landmarks do not become zones', () => {
    // Every landmark here is registered in M1 and none of them is worth a click. A zone
    // on a rock pile is a dead pixel that eats the hover state, so the table is an
    // argument about which four are interesting rather than a map over the registry.
    const scenery = ['rock-field', 'reed-bank', 'fence-line', 'cairn'] as const;
    const out = describeZones(
      surfaces({ landmarks: scenery.map((k) => landmark(k, 0.4)) })
    );
    // Only the treeline band, which comes from the ground rather than from a landmark.
    expect(out.map((z) => z.id)).toEqual(['forest']);
  });

  it('builds the landmarks that have something to say', () => {
    const out = describeZones(
      surfaces({
        landmarks: [
          landmark('observatory', 0.44),
          landmark('radio-tower', 0.72),
          landmark('cabin', 0.3),
          landmark('lighthouse', 0.14),
        ],
        moon: MOON,
      })
    );
    expect(out.map((z) => z.id).sort()).toEqual([
      'cabin',
      'forest',
      'lighthouse',
      'moon',
      'observatory',
      'radio-tower',
    ]);
  });

  it('takes the landmark rect verbatim rather than re-deriving it', () => {
    // The rect is what the renderer reported. Rebuilding it from world data here would
    // encode the anchor-system mismatch this whole layer exists to avoid.
    const obs = landmark('observatory', 0.44);
    const out = describeZones(surfaces({ landmarks: [obs] }));
    const zone = out.find((z) => z.id === 'observatory');
    expect(zone?.rect).toEqual({ x: obs.x, y: obs.y, width: obs.width, height: obs.height });
  });

  it('omits the moon when it is below the horizon', () => {
    const out = describeZones(surfaces({ moon: null }));
    expect(out.map((z) => z.id)).not.toContain('moon');
  });

  it('omits a forest band too thin to hit', () => {
    // A zero-height band would still swallow the hover state at exactly one row.
    const out = describeZones(surfaces({ forest: { ...FOREST, height: 0.004 } }));
    expect(out.map((z) => z.id)).not.toContain('forest');
  });

  it('only the forest zone dwells', () => {
    const out = describeZones(
      surfaces({ landmarks: [landmark('observatory', 0.44)], moon: MOON })
    );
    for (const z of out) {
      expect(z.dwellMs).toBe(z.id === 'forest' ? DEFAULT_DWELL_MS : 0);
    }
  });

  it('gives the observatory a pointer, because it is clickable', () => {
    const out = describeZones(surfaces({ landmarks: [landmark('observatory', 0.44)] }));
    expect(out.find((z) => z.id === 'observatory')?.cursor).toBe('pointer');
  });
});

describe('zone triggers reach the egg table', () => {
  it('every zone that declares a trigger has an egg listening for it', () => {
    // The failure this guards against is a trigger that is dispatched into nothing: the
    // zone fires, `EasterEggSystem.trigger` finds no match, and discovery silently
    // fails. It is invisible in every other check because nothing throws.
    const triggers = new Set(BUILTIN_EASTER_EGGS.map((e) => e.trigger));
    const scenes = describeZones(
      surfaces({
        landmarks: [
          landmark('observatory', 0.44),
          landmark('radio-tower', 0.72),
          landmark('cabin', 0.3),
          landmark('lighthouse', 0.14),
        ],
        moon: MOON,
      })
    );
    const orphaned = scenes.filter((z) => z.trigger !== null && !triggers.has(z.trigger));
    expect(orphaned.map((z) => `${z.id} -> ${z.trigger}`)).toEqual([]);
  });

  it('the zones cover the eggs that are reached by pointing', () => {
    // The other direction: an egg whose trigger looks like a zone's but has no zone can
    // never be found. These three are pointed-at discoveries; the rest arrive by key
    // code, a build flag or the clock.
    const zoneTriggers = new Set(
      describeZones(
        surfaces({
          landmarks: [landmark('observatory', 0.44)],
          moon: MOON,
        })
      )
        .map((z) => z.trigger)
        .filter((t): t is string => t !== null)
    );
    for (const t of ['triple-click:observatory', 'hover:moon@midnight', 'idle:forest:30s']) {
      expect(zoneTriggers).toContain(t);
    }
  });
});

describe('overlappingZones', () => {
  it('reports the forest band crossing a midground landmark', () => {
    // The band spans the full width, so this is a real condition rather than a
    // hypothetical one, and the first zone registered wins the hover state silently.
    // The landmark is placed low enough to sit inside the band -- at the midground
    // height the two never touch and the check would pass by not testing anything.
    const out = describeZones(surfaces({ landmarks: [landmark('cabin', 0.3, 0.66)] }));
    expect(overlappingZones(out)).toEqual([['cabin', 'forest']]);
  });

  it('stays quiet when the scene has no overlaps', () => {
    const out = describeZones(
      surfaces({ landmarks: [landmark('lighthouse', 0.14)], moon: MOON })
    );
    expect(overlappingZones(out)).toEqual([]);
  });

  it('finds nothing to compare in an empty scene', () => {
    expect(overlappingZones([])).toEqual([]);
  });
});
