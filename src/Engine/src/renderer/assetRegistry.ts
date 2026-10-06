/**
 * Asset registry: one authoritative description of every drawable landmark.
 *
 * ## Why this exists
 *
 * Three facts about a landmark used to live in three unrelated places:
 *
 *   * `STRUCTURE_ANCHORS` in `WorldRenderer` -- where the silhouette's reference
 *     point sits inside its own untranslated geometry
 *   * `STRUCTURE_TONE` in `WorldRenderer` -- its base colour
 *   * a hardcoded pixel literal inside each `case` of `_drawStructure`, plus the
 *     width and height used to draw it
 *
 * Nothing tied them together, and nothing outside the renderer could ask where a
 * landmark was. `InteractionSystem` wanted clickable regions and had no way to get
 * them, so its zone map stayed empty and the `triple-click:observatory` egg could
 * never fire -- a valid feature with no way to be reached.
 *
 * This module is the single place that says what a landmark *is*: its anchor, its
 * tone, how big it is, and -- when the day comes -- which 3D model replaces the
 * procedural drawing. It describes assets. It does not draw them.
 *
 * ## The coordinate system, stated once
 *
 * This is the part that is genuinely surprising and was previously implicit, so it
 * is worth writing down rather than leaving to be rediscovered.
 *
 * A structure is drawn in two stages. The draw code runs inside a transform built
 * by `_drawStructures`:
 *
 *     translate(worldX * w, worldY * h)   // worldY defaults to anchor.y
 *     scale(structureScale)
 *     translate(-anchor.x * w, -anchor.y * h)
 *     draw the silhouette at its own hardcoded position
 *
 * So the silhouette is authored in "native" coordinates and then moved so its
 * anchor lands on the position the world declared. The consequence is that the
 * world data's `x` is **not** where the building ends up:
 *
 *     finalX = worldX + (nativeX - anchorX)
 *
 * Worked example, the cabin: the world places it at `x: 0.17`, its anchor is
 * `0.2`, and the drawing code authors it at `0.33`. It therefore renders at
 * `0.17 + 0.13 = 0.30`, not at `0.17`. Anyone reading a world file and expecting the
 * cabin under that number would be wrong by thirteen percent of the frame, which is
 * most of a building's width.
 *
 * The reason for the indirection is worth keeping: the anchor lets each silhouette
 * keep the proportions it was drawn with, instead of every world's `x` having to
 * mean "the left edge" for some shapes and "the centre" for others. The cost is that
 * the arithmetic above has to be honoured everywhere, and previously it was honoured
 * in exactly one place by accident.
 *
 * `resolveStructureRect` below is the only sanctioned way to turn a world entry into
 * an on-screen rectangle, and it implements precisely that formula.
 *
 * Vertically the story is simpler and worth stating so nobody has to check: no
 * built-in world sets `structures[].y`, so the vertical translate evaluates to zero
 * and landmarks sit where their drawing code puts them, measured down from the
 * horizon. That is captured as `groundDrop` and may not remain true forever.
 *
 * ## Footprints
 *
 * `footprint` returns a rectangle in the units the geometry is actually authored
 * in. Most structure widths are fractions of viewport *width* and most heights are
 * fractions of viewport *height*, and the exceptions (the lighthouse's base half
 * width is a fraction of height, the cabin's is a fraction of width) are the reason
 * this is a function of the viewport rather than a stored constant. Storing a single
 * number per axis would have baked in an aspect ratio, and the wallpapers run at
 * whatever the monitors are.
 *
 * Footprints are a hit-test description, not a promise about drawn pixels. A few are
 * deliberately generous, and the clustered kinds -- `rock-field`, `reed-bank`,
 * `pylon-run` -- describe the union of many scattered pieces rather than one object.
 * They are not clickable landmarks and are registered so the table is complete and
 * testable, not because a player is meant to click a pile of boulders.
 *
 * ## 3D assets
 *
 * `model` is the seam for a future Blender/glTF overhaul and is intentionally
 * unpopulated: there are no 3D assets in this repository, and inventing entries for
 * files that do not exist would be a lie the registry could not keep. When a model
 * does arrive it is declared here, the manifest records its licence and provenance
 * for `tools/license-gate.mjs`, and a 3D-capable renderer resolves the asset by
 * `model.src` and uses the loaded bounding box for the footprint. Nothing about the
 * world format, the world files, or the story layer has to change to accept it --
 * that is the whole point of routing every landmark through one table.
 *
 * What a 3D swap genuinely will not survive is documented in `docs/asset-pipeline.md`
 * rather than guessed at here.
 */
import type { StructureKind } from '../worlds/types.js';
import type { RGB } from '../render/noise.js';

/** Where a silhouette's reference point sits inside its own untranslated geometry. */
export interface AssetAnchor {
  x: number;
  y: number;
}

/**
 * A 3D asset that replaces the procedural drawing for a landmark.
 *
 * Unused today. Declared now so the world format and the story layer can be written
 * against a shape that already has somewhere to put a model.
 */
export interface AssetModelRef {
  /** Model location, relative to the asset root. */
  src: string;
  /** Extra uniform scale applied on top of the world structure's own `scale`. */
  scale?: number;
  /**
   * Height above the model's base, as a fraction of model height, that should sit on
   * the ground line. Defaults to 0. Exists because a Blender export's origin is
   * wherever the artist left it, and a cabin authored around its own origin will
   * otherwise sink into the terrain.
   */
  pivot?: number;
}

export interface FootprintContext {
  /** Viewport width in pixels. */
  w: number;
  /** Viewport height in pixels. */
  h: number;
  /** The world structure's declared `x`, as a fraction of viewport width. */
  worldX: number;
  /** The world structure's `scale`, defaulting to 1. */
  scale: number;
  /** Horizon position as a fraction of viewport height. */
  horizonFrac: number;
  /** Current horizontal mouse deflection, -1..1. */
  mousePx: number;
  /**
   * Normalised x positions of a `pylon-run`'s poles. Supplied by the renderer, which
   * owns them; absent means "span the frame", which is the honest answer when the
   * pole positions are unknown.
   */
  poleXs?: number[];
}

export interface FootprintRect {
  /** Centre, as a fraction of viewport width. */
  cx: number;
  /** Top edge, as a fraction of viewport height. */
  top: number;
  /** Full width, as a fraction of viewport width. */
  w: number;
  /** Full height, as a fraction of viewport height. */
  h: number;
}

export interface StructureAsset {
  kind: StructureKind;
  /**
   * Reference point inside the untranslated silhouette. Combined with `worldX` by the
   * formula documented at the top of this file.
   */
  anchor: AssetAnchor;
  /**
   * Where the drawing code authors this silhouette, before the anchor translate.
   * `nativeX - anchorX` is the offset a world's `x` is displaced by, which is why
   * this is recorded rather than left implicit in a `case` label.
   */
  native: AssetAnchor;
  /** Base colour, before ambient and haze. */
  tone: RGB;
  /**
   * Mouse parallax in CSS pixels at full deflection, applied inside the structure
   * transform and therefore also scaled by the world structure's `scale`.
   */
  parallaxPx: number;
  footprint: (ctx: FootprintContext) => FootprintRect;
  /** Set when a real model replaces the procedural drawing. None today. */
  model?: AssetModelRef;
}

/** Half-width and height helpers, to keep each footprint readable. */
const centre = (worldX: number, nativeX: number, anchorX: number, parallax: number): number =>
  worldX + nativeX - anchorX + parallax;

export const STRUCTURE_ASSETS: Record<StructureKind, StructureAsset> = {
  // ---- Landmarks. These are the ones a player might plausibly interact with. ----

  cabin: {
    kind: 'cabin',
    anchor: { x: 0.2, y: 0.748 },
    native: { x: 0.33, y: 0.748 },
    tone: { r: 74, g: 52, b: 40 },
    parallaxPx: 8,
    // _drawCabin: baseY = horizon + 0.05h, w = 0.062w, h = 0.042h.
    footprint: (c) => {
      const sc = c.scale;
      return {
        cx: centre(c.worldX, 0.33, 0.2, (c.mousePx * 8 * sc) / c.w),
        top: c.horizonFrac + 0.05 - 0.042 * sc,
        w: 0.062 * sc,
        h: 0.042 * sc,
      };
    },
  },

  observatory: {
    kind: 'observatory',
    anchor: { x: 0.565, y: 0.715 },
    native: { x: 0.565, y: 0.715 },
    tone: { r: 92, g: 94, b: 102 },
    parallaxPx: 6,
    // _drawObservatory: baseY = horizon + 0.03h, w = 0.05w, h = 0.062h. The dome
    // sits on a base slightly wider than w, and the shadow gradient reaches 1.3w,
    // so the footprint is widened a little to cover the building rather than the
    // dome alone.
    footprint: (c) => {
      const sc = c.scale;
      return {
        cx: centre(c.worldX, 0.565, 0.565, (c.mousePx * 6 * sc) / c.w),
        top: c.horizonFrac + 0.03 - 0.062 * sc,
        w: 0.05 * 1.3 * sc,
        h: 0.062 * sc,
      };
    },
  },

  'radio-tower': {
    kind: 'radio-tower',
    anchor: { x: 0.775, y: 0.715 },
    native: { x: 0.775, y: 0.715 },
    tone: { r: 118, g: 118, b: 122 },
    parallaxPx: 5,
    // _drawRadioTower: baseY = horizon + 0.03h, h = 0.2h, halfBase = 0.017h. The
    // half-width is a fraction of height, so it only converts to a width fraction via
    // the viewport -- which is precisely why footprint is a function.
    footprint: (c) => {
      const sc = c.scale;
      return {
        cx: centre(c.worldX, 0.775, 0.775, (c.mousePx * 5 * sc) / c.w),
        top: c.horizonFrac + 0.03 - 0.2 * sc,
        w: (0.017 * 2 * c.h * sc) / c.w,
        h: 0.2 * sc,
      };
    },
  },

  lighthouse: {
    kind: 'lighthouse',
    anchor: { x: 0.82, y: 0.7 },
    native: { x: 0.82, y: 0.7 },
    tone: { r: 96, g: 92, b: 88 },
    parallaxPx: 0,
    // Base half-width 0.019h, top half-width 0.011h, height 0.19h, drawn from
    // groundY + 0.01h. The lantern sits above the shaft and the glow reaches 0.075h
    // further, so the top is extended to include the lamp rather than stopping at the
    // roofline.
    footprint: (c) => {
      const sc = c.scale;
      const lamp = 0.008;
      return {
        cx: centre(c.worldX, 0.82, 0.82, 0),
        top: c.horizonFrac + 0.01 - 0.19 * sc - lamp * sc,
        w: (0.019 * 2 * c.h * sc) / c.w,
        h: (0.19 + lamp) * sc,
      };
    },
  },

  // ---- Generic structures. Complete, but not landmarks. ----

  well: {
    kind: 'well',
    anchor: { x: 0.36, y: 0.72 },
    native: { x: 0.36, y: 0.72 },
    tone: { r: 88, g: 76, b: 64 },
    parallaxPx: 0,
    // _drawStructure 'well': x = 0.36w, y = groundY + 0.055h, w = 0.016w, h = 0.026h.
    // The roof widens to 1.3w and the finial adds 0.8h above the shaft.
    footprint: (c) => {
      const sc = c.scale;
      return {
        cx: centre(c.worldX, 0.36, 0.36, 0),
        top: c.horizonFrac + 0.055 - 0.026 * 1.8 * sc,
        w: 0.016 * 2 * 1.3 * sc,
        h: 0.026 * 1.8 * sc,
      };
    },
  },

  ruin: {
    kind: 'ruin',
    anchor: { x: 0.24, y: 0.75 },
    native: { x: 0.24, y: 0.75 },
    tone: { r: 128, g: 112, b: 92 },
    parallaxPx: 0,
    // 'ruin': x = 0.24w, y = groundY + 0.05h, h = 0.05h, half-width 0.022w.
    footprint: (c) => {
      const sc = c.scale;
      return {
        cx: centre(c.worldX, 0.24, 0.24, 0),
        top: c.horizonFrac + 0.05 - 0.05 * sc,
        w: 0.044 * sc,
        h: 0.05 * sc,
      };
    },
  },

  dishes: {
    kind: 'dishes',
    anchor: { x: 0.78, y: 0.755 },
    native: { x: 0.78, y: 0.755 },
    tone: { r: 168, g: 166, b: 160 },
    parallaxPx: 0,
    // Three dishes at 0.752 / 0.786 / 0.812, each radius 0.028h scaled by
    // 1 / 0.74 / 0.52, standing on masts that rise 1.5r. The footprint is the union.
    footprint: (c) => {
      const sc = c.scale;
      const offsets = [0.752, 0.786, 0.812];
      const scales = [1, 0.74, 0.52];
      const minX = Math.min(...offsets.map((o, i) => o - (0.028 * c.h * scales[i]) / c.w));
      const maxX = Math.max(...offsets.map((o, i) => o + (0.028 * c.h * scales[i]) / c.w));
      const tallest = 0.028 * 2.5;
      return {
        cx: centre(c.worldX, 0.78, 0.78, 0) + (minX + maxX) / 2 - 0.78,
        top: c.horizonFrac + 0.055 - tallest * sc,
        w: (maxX - minX) * sc,
        h: tallest * sc,
      };
    },
  },

  cairn: {
    kind: 'cairn',
    anchor: { x: 0.26, y: 0.79 },
    native: { x: 0.26, y: 0.79 },
    tone: { r: 108, g: 104, b: 98 },
    parallaxPx: 0,
    // Six stones from base width 0.026h shrinking by 0.82 each, heights
    // 0.008h - i*0.0007h, stacked from groundY + 0.045h.
    footprint: (c) => {
      const sc = c.scale;
      const height = Array.from({ length: 6 }, (_, i) => 0.008 - i * 0.0007).reduce((a, b) => a + b, 0);
      return {
        cx: centre(c.worldX, 0.26, 0.26, 0),
        top: c.horizonFrac + 0.045 - height * sc,
        w: (0.026 * 2 * c.h * sc) / c.w,
        h: height * sc,
      };
    },
  },

  butte: {
    kind: 'butte',
    anchor: { x: 0.08, y: 0.74 },
    native: { x: 0.08, y: 0.74 },
    tone: { r: 132, g: 104, b: 80 },
    parallaxPx: 0,
    // x = 0.08w, y = groundY + 0.04h, h = 0.13h, half-width 0.055w, cap 0.82 of it.
    // The talus skirt spreads to +/-1.25w, so the footprint covers the skirt.
    footprint: (c) => {
      const sc = c.scale;
      return {
        cx: centre(c.worldX, 0.08, 0.08, 0),
        top: c.horizonFrac + 0.04 - 0.13 * sc,
        w: 0.055 * 2.5 * sc,
        h: 0.13 * sc,
      };
    },
  },

  // ---- Scattered clusters. Registered for completeness, not as click targets. ----

  'rock-field': {
    kind: 'rock-field',
    anchor: { x: 0.45, y: 0.76 },
    native: { x: 0.45, y: 0.76 },
    tone: { r: 92, g: 82, b: 70 },
    parallaxPx: 0,
    // Eleven boulders spread +/-0.09 of the frame around worldX, sorted back to front,
    // each at radius 0.013h * (0.45 + depth) between groundY + 0.008h and +0.063h.
    footprint: (c) => {
      const sc = c.scale;
      return {
        cx: centre(c.worldX, 0.45, 0.45, 0),
        top: c.horizonFrac + 0.008 - 0.013 * 1.45 * sc,
        w: (0.18 + (0.013 * 2 * c.h * sc) / c.w) * sc,
        h: 0.055 * sc,
      };
    },
  },

  snowbank: {
    kind: 'snowbank',
    anchor: { x: 0.3, y: 0.76 },
    native: { x: 0.3, y: 0.76 },
    tone: { r: 210, g: 216, b: 222 },
    parallaxPx: 0,
    // Same scatter as rock-field but radius 0.007h and squashed to 0.4, so it is both
    // smaller and flatter.
    footprint: (c) => {
      const sc = c.scale;
      return {
        cx: centre(c.worldX, 0.3, 0.3, 0),
        top: c.horizonFrac + 0.008 - 0.007 * 1.45 * sc,
        w: (0.18 + (0.007 * 2 * c.h * sc) / c.w) * sc,
        h: 0.055 * sc,
      };
    },
  },

  'reed-bank': {
    kind: 'reed-bank',
    anchor: { x: 0.12, y: 0.69 },
    native: { x: 0.12, y: 0.69 },
    tone: { r: 96, g: 92, b: 66 },
    parallaxPx: 0,
    // Seventy strokes spread +/-0.11 around worldX, heights 0.014h..0.036h, bases
    // between groundY + 0.005h and +0.035h.
    footprint: (c) => {
      const sc = c.scale;
      return {
        cx: centre(c.worldX, 0.12, 0.12, 0),
        top: c.horizonFrac + 0.005 - 0.036 * sc,
        w: 0.22 * sc,
        h: 0.065 * sc,
      };
    },
  },

  'fence-line': {
    kind: 'fence-line',
    anchor: { x: 0.5, y: 0.735 },
    native: { x: 0.5, y: 0.735 },
    tone: { r: 74, g: 66, b: 56 },
    parallaxPx: 0,
    // A run of eight posts from worldX - 0.09 to +0.09, leaning up 0.006h over
    // 0.18w, posts 0.016h tall, based at groundY + 0.035h.
    footprint: (c) => {
      const sc = c.scale;
      return {
        cx: centre(c.worldX, 0.5, 0.5, 0),
        top: c.horizonFrac + 0.035 - 0.022 * sc,
        w: 0.18 * sc,
        h: 0.022 * sc,
      };
    },
  },

  'pylon-run': {
    kind: 'pylon-run',
    anchor: { x: 0.0, y: 0.7 },
    native: { x: 0.0, y: 0.7 },
    tone: { r: 40, g: 38, b: 40 },
    parallaxPx: 0,
    // Poles are seeded per world and spread across the frame rather than placed at
    // `worldX`, so this is genuinely a run and not a point. The renderer supplies
    // their positions; without them the honest answer is "the whole frame", which is
    // what a pole run does span.
    footprint: (c) => {
      const sc = c.scale;
      if (!c.poleXs || c.poleXs.length === 0) {
        return { cx: 0.5, top: c.horizonFrac - 0.14 * sc, w: 1, h: 0.19 * sc };
      }
      const minX = Math.min(...c.poleXs);
      const maxX = Math.max(...c.poleXs);
      return {
        cx: (minX + maxX) / 2,
        top: c.horizonFrac - 0.14 * sc,
        w: (maxX - minX) + 0.04 * sc,
        h: 0.19 * sc,
      };
    },
  },
};

/**
 * Look up a landmark asset.
 *
 * A `kind` outside the table is a world-file error, and the world validator already
 * rejects unknown kinds, so this cannot normally return undefined. It is typed to
 * allow for that anyway: `_drawStructures` skips anything without an anchor, and a
 * renderer that threw on a malformed world file would take the user's desktop with
 * it rather than drawing one fewer building.
 */
export function structureAsset(kind: string): StructureAsset | undefined {
  return STRUCTURE_ASSETS[kind as StructureKind];
}

/** Every registered kind, for tests and for tooling that enumerates assets. */
export function registeredKinds(): StructureKind[] {
  return Object.keys(STRUCTURE_ASSETS) as StructureKind[];
}

/**
 * The on-screen rectangle of one world structure, as top-left plus size, all
 * normalised to the viewport.
 *
 * This is the only sanctioned conversion from a world entry to a screen region.
 * It applies the anchor formula documented at the top of this file, so a caller
 * cannot accidentally believe the world's `x` is the drawn position.
 */
export function resolveStructureRect(
  asset: StructureAsset,
  ctx: Omit<FootprintContext, 'worldX' | 'scale'>,
  worldX: number,
  scale = 1
): { x: number; y: number; width: number; height: number } {
  const f = asset.footprint({ ...ctx, worldX, scale });
  return { x: f.cx - f.w / 2, y: f.top, width: f.w, height: f.h };
}