import { describe, it, expect } from 'vitest';
import {
  STRUCTURE_ASSETS,
  registeredKinds,
  resolveStructureRect,
  structureAsset,
  type FootprintContext,
} from '../src/renderer/assetRegistry.js';
import { STRUCTURE_KINDS } from '../src/worlds/types.js';
import { BUILT_IN_WORLDS } from '../src/worlds/registry.js';

/**
 * The asset registry is the one place that describes what a landmark is.
 *
 * Before it existed, an anchor table, a tone table and a hardcoded pixel literal
 * inside each `case` of `_drawStructure` all described the same buildings, in the same
 * file, with nothing tying them together. That is a table rot problem, and the only
 * defence is to assert the table.
 *
 * These tests deliberately assert *structure* rather than exact numbers. Pinning
 * every coordinate would mean editing this file every time a building is nudged, and
 * a test that is annoying to update is a test that gets deleted. What is worth
 * pinning is the parts that are load-bearing or easy to get wrong:
 *
 *   * every kind the world format allows has an asset, and no invented extras
 *   * every entry is internally consistent
 *   * footprints stay finite and sane across aspect ratios, because the geometry is
 *     authored in mixed units and that is where a bad conversion would hide
 *   * the anchor formula in the module docs is what the code actually does
 */

/** A spread of viewports, including the extremes a multi-monitor setup produces. */
const VIEWPORTS = [
  { w: 1280, h: 720 },
  { w: 1920, h: 1080 },
  { w: 2560, h: 1080 },
  { w: 1080, h: 1920 },
  { w: 3840, h: 1080 },
  { w: 640, h: 480 },
];

function ctx(over: Partial<FootprintContext> = {}): FootprintContext {
  return { w: 1920, h: 1080, worldX: 0.5, scale: 1, horizonFrac: 0.7, mousePx: 0, ...over };
}

describe('asset registry completeness', () => {
  it('covers every structure kind the world format allows', () => {
    // Checked against the exported union rather than a list pasted here, because a
    // pasted list is a copy that goes stale the moment a fifteenth kind is added.
    expect(registeredKinds().sort()).toEqual([...STRUCTURE_KINDS].sort());
  });

  it('has no entries for kinds the world format does not allow', () => {
    const allowed = new Set<string>(STRUCTURE_KINDS);
    expect(Object.keys(STRUCTURE_ASSETS).filter((k) => !allowed.has(k))).toEqual([]);
  });

  it('records the same kind as its key', () => {
    // A copy-paste slip here is invisible until someone renames a kind and the
    // registry keeps answering under the old name.
    const mismatched = registeredKinds().filter((k) => STRUCTURE_ASSETS[k].kind !== k);
    expect(mismatched).toEqual([]);
  });

  it('is reachable by lookup, and unknown kinds resolve to undefined rather than throwing', () => {
    for (const kind of STRUCTURE_KINDS) {
      expect(structureAsset(kind)?.kind).toBe(kind);
    }
    // The renderer skips anything without an asset. Throwing instead would take the
    // user's whole desktop down over one malformed world file.
    expect(structureAsset('bunker')).toBeUndefined();
    expect(structureAsset('')).toBeUndefined();
  });
});

describe('asset registry entries', () => {
  it('has a finite, in-range anchor and native position for every kind', () => {
    for (const kind of STRUCTURE_KINDS) {
      const a = STRUCTURE_ASSETS[kind];
      for (const [label, p] of [['anchor', a.anchor], ['native', a.native]] as const) {
        expect(Number.isFinite(p.x), `${kind}.${label}.x`).toBe(true);
        expect(Number.isFinite(p.y), `${kind}.${label}.y`).toBe(true);
        expect(p.x, `${kind}.${label}.x range`).toBeGreaterThanOrEqual(0);
        expect(p.x, `${kind}.${label}.x range`).toBeLessThanOrEqual(1);
        expect(p.y, `${kind}.${label}.y range`).toBeGreaterThanOrEqual(0);
        expect(p.y, `${kind}.${label}.y range`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('has a finite tone for every kind', () => {
    for (const kind of STRUCTURE_KINDS) {
      const { r, g, b } = STRUCTURE_ASSETS[kind].tone;
      for (const [label, v] of [['r', r], ['g', g], ['b', b]] as const) {
        expect(Number.isFinite(v), `${kind}.tone.${label}`).toBe(true);
        expect(v, `${kind}.tone.${label} range`).toBeGreaterThanOrEqual(0);
        expect(v, `${kind}.tone.${label} range`).toBeLessThanOrEqual(255);
      }
    }
  });

  it('has a finite, non-negative parallax for every kind', () => {
    for (const kind of STRUCTURE_KINDS) {
      expect(Number.isFinite(STRUCTURE_ASSETS[kind].parallaxPx), kind).toBe(true);
      expect(STRUCTURE_ASSETS[kind].parallaxPx, kind).toBeGreaterThanOrEqual(0);
    }
  });

  it('declares no 3D model that does not exist', () => {
    // `model` is the seam for a future Blender overhaul and is intentionally empty.
    // An entry pointing at a file that is not in the repository would be a promise the
    // registry cannot keep, and it would pass every other check here.
    for (const kind of STRUCTURE_KINDS) {
      expect(STRUCTURE_ASSETS[kind].model, kind).toBeUndefined();
    }
  });
});

describe('footprints', () => {
  it('stays finite and positive at every aspect ratio tested', () => {
    // The geometry is authored in mixed units -- the cabin's width is a fraction of
    // viewport width while the lighthouse's is a fraction of height -- so a footprint
    // has to be resolved against a real viewport rather than stored as one number per
    // axis. This is the check that catches a bad conversion.
    for (const kind of STRUCTURE_KINDS) {
      const asset = STRUCTURE_ASSETS[kind];
      for (const vp of VIEWPORTS) {
        const f = asset.footprint(ctx({ w: vp.w, h: vp.h }));
        for (const [label, v] of Object.entries(f)) {
          expect(Number.isFinite(v), `${kind} @ ${vp.w}x${vp.h} ${label}`).toBe(true);
        }
        expect(f.w, `${kind} @ ${vp.w}x${vp.h} width`).toBeGreaterThan(0);
        expect(f.h, `${kind} @ ${vp.w}x${vp.h} height`).toBeGreaterThan(0);
      }
    }
  });

  it('grows with the world structure scale', () => {
    // `pylon-run` is excluded from the width half, and deliberately so rather than by
    // accident: it is a run of poles spread across the whole frame, so its width is
    // already the frame and doubling the scale cannot make it wider. Its height still
    // scales, and that is asserted below. Encoding this exception is the point -- a
    // formula invented to satisfy "everything scales" would have reported a pole run
    // twice as wide as the screen, which is a lie about where the thing is.
    const fullWidthRuns = new Set(['pylon-run']);
    for (const kind of STRUCTURE_KINDS) {
      const asset = STRUCTURE_ASSETS[kind];
      const small = asset.footprint(ctx({ scale: 1 }));
      const large = asset.footprint(ctx({ scale: 2 }));
      expect(large.h, `${kind} height should scale`).toBeGreaterThan(small.h);
      if (!fullWidthRuns.has(kind)) {
        expect(large.w, `${kind} width should scale`).toBeGreaterThan(small.w);
      }
    }
  });

  it('never reports a full-width run as wider than the frame', () => {
    const small = STRUCTURE_ASSETS['pylon-run'].footprint(ctx({ scale: 0.5, poleXs: undefined }));
    const large = STRUCTURE_ASSETS['pylon-run'].footprint(ctx({ scale: 3, poleXs: undefined }));
    expect(small.w).toBe(1);
    expect(large.w).toBe(1);
  });

  it('keeps landmarks near the horizon at the horizon they were given', () => {
    // Every footprint is defined relative to the horizon, so moving the horizon must
    // move the landmark by the same amount. A footprint computed against a fixed
    // fraction of the frame instead would slide off the ground at other hours.
    for (const kind of STRUCTURE_KINDS) {
      const asset = STRUCTURE_ASSETS[kind];
      const a = asset.footprint(ctx({ horizonFrac: 0.6 }));
      const b = asset.footprint(ctx({ horizonFrac: 0.8 }));
      expect(b.top - a.top, `${kind} should follow the horizon`).toBeCloseTo(0.2, 10);
    }
  });

  it('shifts with mouse parallax only for the kinds that have it', () => {
    // Parallax is applied inside the structure transform for the three landmark
    // methods and not at all for the rest, which is a real asymmetry in the drawing
    // code rather than an oversight. Asserting it here means a future 3D swap cannot
    // silently add or drop it.
    const withParallax = new Set(['cabin', 'observatory', 'radio-tower']);
    for (const kind of STRUCTURE_KINDS) {
      const asset = STRUCTURE_ASSETS[kind];
      const left = asset.footprint(ctx({ mousePx: -1 }));
      const right = asset.footprint(ctx({ mousePx: 1 }));
      const moved = Math.abs(right.cx - left.cx);
      if (withParallax.has(kind)) expect(moved, `${kind} should parallax`).toBeGreaterThan(0);
      else expect(moved, `${kind} should not parallax`).toBe(0);
    }
  });

  it('reports a full-width run for a pylon-run with no known pole positions', () => {
    // A pole run genuinely does span the frame, so "I do not know where the poles are"
    // has an honest answer rather than a zero-width one.
    const f = STRUCTURE_ASSETS['pylon-run'].footprint(ctx({ poleXs: undefined }));
    expect(f.w).toBe(1);
    expect(f.cx).toBe(0.5);
  });

  it('narrows a pylon-run to its poles when they are known', () => {
    const f = STRUCTURE_ASSETS['pylon-run'].footprint(ctx({ poleXs: [0.2, 0.4, 0.6] }));
    expect(f.w).toBeGreaterThan(0);
    expect(f.w).toBeLessThan(1);
    expect(f.cx).toBeCloseTo(0.4, 10);
  });
});

describe('the anchor coordinate system', () => {
  it('places a landmark at worldX + native - anchor, not at worldX', () => {
    // This is the formula documented at the top of assetRegistry.ts, and it is
    // surprising: the cabin is authored at 0.33 with an anchor of 0.2, so a world that
    // places it at 0.17 renders it at 0.30. Anyone reading a world file and expecting
    // the building under that number would be wrong by most of its width.
    const cabin = STRUCTURE_ASSETS.cabin;
    expect(resolveStructureRect(cabin, { w: 1920, h: 1080, horizonFrac: 0.7, mousePx: 0 }, 0.17).x)
      .toBeCloseTo(0.17 + 0.33 - 0.2 - 0.062 / 2, 10);
  });

  it('leaves a landmark unmoved when its world position equals its anchor', () => {
    // The case that makes the formula checkable: native and anchor agreeing means
    // worldX is the drawn position, which is what an author would assume.
    const observatory = STRUCTURE_ASSETS.observatory;
    expect(observatory.native.x).toBe(observatory.anchor.x);
    const r = resolveStructureRect(observatory, { w: 1920, h: 1080, horizonFrac: 0.7, mousePx: 0 }, 0.62);
    expect(r.x + r.width / 2).toBeCloseTo(0.62, 10);
  });

  it('returns top-left plus size, matching how InteractionSystem hit-tests', () => {
    const asset = STRUCTURE_ASSETS.cairn;
    const r = resolveStructureRect(asset, { w: 1920, h: 1080, horizonFrac: 0.7, mousePx: 0 }, 0.26);
    const f = asset.footprint(ctx({ worldX: 0.26 }));
    expect(r.x).toBeCloseTo(f.cx - f.w / 2, 10);
    expect(r.y).toBeCloseTo(f.top, 10);
    expect(r.width).toBeCloseTo(f.w, 10);
    expect(r.height).toBeCloseTo(f.h, 10);
  });
});

describe('built-in worlds', () => {
  it('resolves a positive region for every structure every built-in world declares', () => {
    // The end-to-end check: the numbers above are unit-level, this runs the real world
    // data through the real conversion. A world placing a structure off the left edge
    // is legal (the validator allows -0.2..1.2), so only the size is asserted.
    for (const world of BUILT_IN_WORLDS) {
      for (const s of world.structures ?? []) {
        const asset = structureAsset(s.kind);
        expect(asset, `${world.id}: ${s.kind}`).toBeDefined();
        const r = resolveStructureRect(
          asset!,
          { w: 1920, h: 1080, horizonFrac: 0.7, mousePx: 0 },
          s.x,
          s.scale ?? 1
        );
        expect(r.width, `${world.id}: ${s.kind} width`).toBeGreaterThan(0);
        expect(r.height, `${world.id}: ${s.kind} height`).toBeGreaterThan(0);
        expect(Number.isFinite(r.x), `${world.id}: ${s.kind} x`).toBe(true);
        expect(Number.isFinite(r.y), `${world.id}: ${s.kind} y`).toBe(true);
      }
    }
  });

  it('gives every built-in world a landmark, except the one with no landscape', () => {
    // The interior has no structures by design and returns an empty list, which is why
    // the renderer guards on biome rather than trusting the world file.
    const withStructures = BUILT_IN_WORLDS.filter((w) => (w.structures ?? []).length > 0);
    const without = BUILT_IN_WORLDS.filter((w) => (w.structures ?? []).length === 0);
    expect(without.every((w) => w.biome === 'liminal-interior')).toBe(true);
    expect(withStructures.length).toBeGreaterThan(0);
  });
});