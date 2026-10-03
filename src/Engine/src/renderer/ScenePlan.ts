/**
 * The composition plan for a scene.
 *
 * ## Why this exists
 *
 * The renderer used to draw one fixed landscape and then let each art direction
 * finish it with a handful of full-screen passes. That produced three images that
 * were recognisably the same picture in three tints, which is not three art
 * directions — it is one art direction and two colour adjustments. It also left
 * the two defects that mattered most untouched:
 *
 *   * every plane of the scene finished in the same value range, so nothing had
 *     hierarchy and nothing could be the subject;
 *   * nothing was drawn between the camera and the near treeline, so the bottom
 *     third of the frame was an empty gradient.
 *
 * Neither of those is a limitation of drawing with canvas 2D. They are a missing
 * art-direction layer. So the direction is now expressed here, *before* the scene
 * is drawn, as a plan the renderer composes to: where the horizon sits, how the
 * value falls off from far to near, what stands close to the camera, where light
 * is allowed to land, and how much of the sky is withheld.
 *
 * ## The rule the plans encode
 *
 * A landscape reads as a place when the values ladder monotonically from the
 * light (sky, or the one lit object) to the dark (the ground nearest the camera).
 * `ramp` is that ladder, one entry per depth plane, farthest first. Values above
 * 1 lift a plane toward the light; values below 1 push it down. The renderer
 * applies it after the authored palette, so an author can still choose a hue and
 * the plan still chooses the composition.
 *
 * Nothing here draws. Keeping the plan declarative is what keeps the three
 * directions comparable: they differ in numbers a reader can check, not in
 * effects that have to be taken on trust.
 */
import type { Direction } from './VisualDirection.js';

/** What stands closest to the camera, as a silhouette. */
export type ForegroundKind =
  /** Tall wind-blown grass. Busy, soft, and it moves. */
  | 'grass'
  /** Low heather and reed clumps. Quiet; lets the eye travel past. */
  | 'heather'
  /** A leaning post-and-wire fence. Angular, man-made, deliberate. */
  | 'fence'
  /** Weathered boulders and one fallen trunk. */
  | 'boulders'
  /** Nothing. The frame ends at the near treeline. */
  | 'none';

export interface ScenePlan {
  /**
   * Multiplier on the world's horizon, so the plan reframes the authored world
   * instead of overriding it. Below 1 raises the horizon and gives the sky more
   * of the frame; above 1 pushes it down and gives the ground more.
   */
  horizonScale: number;

  /**
   * The value ladder, one entry per depth plane, farthest first:
   * sky, far ridge, mid ridge, near ridge, far forest, ground, mid forest,
   * near forest, foreground.
   *
   * 1.0 leaves the authored value alone. The ladder is expected to fall as it
   * approaches the camera; a plan that does not fall is not building depth, it
   * is only adding contrast.
   */
  ramp: readonly number[];

  /**
   * How strongly each plane mixes toward the haze colour. This is aerial
   * perspective, and it is the other half of depth: a plane can be dark *and*
   * far, and the haze is what tells the eye which one it is looking at.
   */
  aerial: readonly number[];

  /** The close silhouette, and how much of the frame it occupies. */
  foreground: ForegroundKind;
  foregroundTop: number;
  foregroundDensity: number;

  /**
   * Where light is permitted.
   *
   *   diffuse -- no shaping; the sky's own gradient does the work
   *   shafts  -- soft volumes descending from the light, for air
   *   focus   -- one pool on one thing, everything else held down
   */
  light: 'diffuse' | 'shafts' | 'focus';

  /** Fraction of the sky held down for negative space. */
  skyHold: number;

  /** Multiplier on the world's authored cloudiness. */
  cloudiness: number;

  /**
   * How far the fog floor reaches into the midground, as a fraction of the
   * height between the horizon and the foreground. Separated from `aerial`
   * because a banked fog floor is a compositional element, not a per-plane tint.
   */
  fogDepth: number;
}

/** Depth-plane indices, so the renderer and the plans cannot drift apart. */
export const PLANE = {
  sky: 0,
  ridgeFar: 1,
  ridgeMid: 2,
  ridgeNear: 3,
  forestFar: 4,
  ground: 5,
  forestMid: 6,
  forestNear: 7,
  foreground: 8,
} as const;

export const PLANE_COUNT = 9;

function ramp(...values: number[]): readonly number[] {
  if (values.length !== PLANE_COUNT) {
    throw new Error(`ramp needs ${PLANE_COUNT} entries, got ${values.length}`);
  }
  return values;
}

function aerial(...values: number[]): readonly number[] {
  if (values.length !== PLANE_COUNT) {
    throw new Error(`aerial needs ${PLANE_COUNT} entries, got ${values.length}`);
  }
  return values;
}

/**
 * A. depth — the camera is standing in the valley.
 *
 * Low horizon, so there is air above the land and the sky has room to do
 * something. Strong aerial perspective on the far planes, so distance is
 * unambiguous. A tall grass foreground that is genuinely the darkest thing in
 * the frame, because it is genuinely the closest. Light arrives as soft volumes
 * off the moon rather than as a wash.
 */
const DEPTH: ScenePlan = {
  horizonScale: 0.92,
  ramp: ramp(1.0, 1.02, 0.9, 0.8, 0.86, 0.74, 0.6, 0.42, 0.26),
  aerial: aerial(0, 0.72, 0.55, 0.34, 0.4, 0.16, 0.1, 0.04, 0),
  foreground: 'grass',
  foregroundTop: 0.76,
  foregroundDensity: 1,
  light: 'shafts',
  skyHold: 0.2,
  cloudiness: 0.85,
  fogDepth: 0.5,
};

/**
 * B. atmospheric — the subject is the weather.
 *
 * Raised horizon, which compresses the land and gives the sky the frame. Heavier
 * cloud, because a sky with structure in it is the whole point. Aerial
 * perspective pushed hard on everything distant, and a low, soft foreground, so
 * the eye is handed off into the haze instead of being stopped by a shape.
 */
const ATMOSPHERIC: ScenePlan = {
  horizonScale: 1.04,
  ramp: ramp(1.06, 1.12, 1.0, 0.94, 1.0, 0.86, 0.72, 0.5, 0.34),
  aerial: aerial(0.06, 0.86, 0.74, 0.6, 0.62, 0.3, 0.18, 0.06, 0.02),
  foreground: 'heather',
  foregroundTop: 0.82,
  foregroundDensity: 0.75,
  light: 'diffuse',
  skyHold: 0.1,
  cloudiness: 1.9,
  fogDepth: 0.86,
};

/**
 * C. darker — the world withholds.
 *
 * Fewer things, and each one worth looking at. The strongest value separation in
 * the set: the sky is held well down so the one lit object has something to be
 * lit against. The foreground is man-made and sparse rather than organic and
 * busy, which is what makes it read as a decision instead of as scenery. Light
 * is a single pool, not an atmosphere.
 */
const DARKER: ScenePlan = {
  horizonScale: 0.98,
  ramp: ramp(0.78, 0.7, 0.56, 0.44, 0.5, 0.4, 0.3, 0.2, 0.12),
  aerial: aerial(0, 0.5, 0.36, 0.22, 0.26, 0.1, 0.06, 0.02, 0),
  foreground: 'fence',
  foregroundTop: 0.8,
  foregroundDensity: 0.8,
  light: 'focus',
  skyHold: 0.62,
  cloudiness: 0.45,
  fogDepth: 0.22,
};

const PLANS: Record<Direction, ScenePlan> = {
  depth: DEPTH,
  atmospheric: ATMOSPHERIC,
  darker: DARKER,
};

export function planFor(direction: Direction): ScenePlan {
  return PLANS[direction] ?? DEPTH;
}
