/**
 * Three art directions for the same scene.
 *
 * This is the mockup laboratory: one place, one layout, rendered three very
 * different ways, so a direction can be chosen by looking at it rather than
 * arguing about it in words.
 *
 * ## Where a direction actually lives
 *
 * An earlier version of this file did all three directions here, as full-screen
 * passes over the finished scene. That produced three images that were
 * recognisably the same picture in three tints, and it could not fix either of
 * the two things that actually made the wallpaper look flat: every plane ended
 * in the same value range, and nothing was drawn between the camera and the near
 * treeline. Neither of those is a post-process problem.
 *
 * So a direction now has two halves, and this file holds only the cheap one:
 *
 *   `ScenePlan.ts`  the composition — framing, the value ladder, aerial
 *                   perspective, what stands close to the camera, where light
 *                   lands. Applied while the scene is drawn.
 *   this file       the finish — a small unifying grade so the three still look
 *                   like one product.
 *
 * The finish is deliberately restrained. Its job is to bind the planes together,
 * not to repaint them; a direction whose identity lives in a filter will always
 * collapse into the next one, which is precisely what the previous version did.
 *
 * ## The theory behind each
 *
 *   A. depth      the viewer is standing in the valley. Air above the land,
 *                 unambiguous distance, a dark close plane to give the image a
 *                 front edge, light arriving in soft volumes off the moon.
 *   B. atmospheric the subject is the weather. Raised horizon, banked cloud, hard
 *                 aerial perspective, and a low soft foreground so the eye is
 *                 handed off into haze instead of stopped by a shape.
 *   C. darker     the world withholds. Fewest elements, each worth looking at,
 *                 strong negative space, and one pool of light so the subject is
 *                 unambiguous.
 */

import { css, mixRgb } from '../render/noise.js';
import type { SkyGrade } from '../render/palette.js';
import type { ScenePlan } from './ScenePlan.js';

export const DIRECTIONS = ['depth', 'atmospheric', 'darker'] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** The active direction. */
let current: Direction = 'depth';

export function setDirection(d: Direction): void {
  current = d;
}

export function getDirection(): Direction {
  return current;
}

/**
 * Everything the finish needs to know about the frame it is finishing.
 *
 * A single object rather than five positional parameters, because the horizon in
 * particular has to be the *resolved* one. The earlier version of this file
 * hardcoded `h * 0.72` to line its overlays up with the landscape, which is a
 * comment admitting the seam exists; now the landscape's horizon is itself
 * plan-driven, so the finish has to be told rather than guessing.
 */
export interface FinishContext {
  g: CanvasRenderingContext2D;
  w: number;
  h: number;
  grade: SkyGrade;
  plan: ScenePlan;
  /** Sky meets land, as a fraction of height. */
  horizon: number;
}

export function applyDirection(ctx: FinishContext, direction: Direction = current): void {
  switch (direction) {
    case 'depth':
      applyDepth(ctx);
      break;
    case 'atmospheric':
      applyAtmospheric(ctx);
      break;
    case 'darker':
      applyDarker(ctx);
      break;
  }
}

/* ------------------------------ shared ------------------------------ */

/**
 * Negative space, held down at the top of the frame.
 *
 * The one shared device. A frame whose top edge is the brightest thing in it has
 * nowhere for the eye to rest, which is a large part of why a wallpaper reads as
 * busy even when nothing in it is actually moving. The strength comes from the
 * plan rather than from here, because how much sky should be given away is a
 * compositional decision and not a per-direction effect.
 */
function topShadow(g: CanvasRenderingContext2D, w: number, h: number, strength: number): void {
  if (strength <= 0.001) return;
  const grd = g.createLinearGradient(0, 0, 0, h * 0.52);
  grd.addColorStop(0, `rgba(5,8,16,${strength.toFixed(3)})`);
  grd.addColorStop(0.55, `rgba(5,8,16,${(strength * 0.28).toFixed(3)})`);
  grd.addColorStop(1, 'rgba(5,8,16,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h * 0.52);
}

/**
 * Light gathered at one place.
 *
 * Used by `darker` only. This is not "a glow over the middle" — it is the single
 * place the frame is allowed to be bright, which is the whole mechanism that
 * direction is built on.
 */
function lightPool(
  { g, grade }: FinishContext,
  cx: number,
  cy: number,
  radius: number,
  alpha: number
): void {
  const tint = grade.sunAlpha > 0.05 ? grade.lightColor : { r: 236, g: 196, b: 140 };
  g.save();
  g.globalCompositeOperation = 'screen';
  const grd = g.createRadialGradient(cx, cy, 0, cx, cy, radius);
  grd.addColorStop(0, css(tint, alpha));
  grd.addColorStop(0.35, css(tint, alpha * 0.34));
  grd.addColorStop(1, css(tint, 0));
  g.fillStyle = grd;
  g.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  g.restore();
}

/* ----------------------------- direction A ----------------------------- */

/**
 * Depth: air, and a front edge.
 *
 * Almost nothing is added. The plan has already pushed the far planes toward the
 * haze and dropped the foreground to the darkest value in the frame; the only
 * thing left to do here is bind the planes with a thin band of horizon light, so
 * the distance reads as air rather than as a colour change between two shapes.
 */
function applyDepth({ g, w, h, grade, plan, horizon }: FinishContext): void {
  const hy = h * horizon;
  const lit = grade.sunAlpha > 0.05 ? grade.lightColor : { r: 200, g: 212, b: 238 };

  // A thin, wide band of light sitting on the horizon. The old pass filled a
  // quarter of the frame with this; a band that large is a lit rectangle, not
  // air, and it was the reason the sky looked like a gradient with fog on it.
  const band = g.createLinearGradient(0, hy - h * 0.1, 0, hy + h * 0.06);
  band.addColorStop(0, css(lit, 0));
  band.addColorStop(0.62, css(lit, 0.075));
  band.addColorStop(1, css(lit, 0));
  g.fillStyle = band;
  g.fillRect(0, hy - h * 0.1, w, h * 0.16);

  topShadow(g, w, h, plan.skyHold);
}

/* ----------------------------- direction B ----------------------------- */

/**
 * Atmospheric: unify the air.
 *
 * The plan already banked the fog and raised the horizon. All that is left is a
 * single wash of haze across the whole frame, which is what makes the planes
 * feel like they are in the same volume of air rather than stacked on top of one
 * another.
 */
function applyAtmospheric({ g, w, h, grade, plan }: FinishContext): void {
  const lit = mixRgb(grade.haze, grade.skyHorizon, 0.55);
  const wash = g.createLinearGradient(0, 0, 0, h);
  wash.addColorStop(0, css(lit, 0.03));
  wash.addColorStop(0.55, css(lit, 0.1));
  wash.addColorStop(1, css(lit, 0.02));
  g.fillStyle = wash;
  g.fillRect(0, 0, w, h);

  topShadow(g, w, h, plan.skyHold);
}

/* ----------------------------- direction C ----------------------------- */

/**
 * Darker: one lit thing, and the frame held down around it.
 *
 * Everything expensive here already happened in the plan — the ramp is steeper,
 * the foreground is sparse and man-made, the sky is given away. This adds the
 * pool and a matching falloff, and then multiplies the whole frame toward a cool
 * neutral so that nothing in it can be warmer or brighter than the subject by
 * accident.
 */
function applyDarker(ctx: FinishContext): void {
  const { g, w, h, grade, plan, horizon } = ctx;
  const hy = h * horizon;
  const lx = w * 0.48;
  const ly = hy + h * 0.02;

  lightPool(ctx, lx, ly, w * 0.38, 0.15 + grade.ambient * 0.12);

  // The counter-shape: everything outside the pool is pushed down, so the light
  // reads as a place rather than as a gradient.
  const focus = g.createRadialGradient(lx, ly, 0, lx, ly, w * 0.52);
  focus.addColorStop(0, 'rgba(0,0,0,0)');
  focus.addColorStop(1, 'rgba(3,6,12,0.5)');
  g.fillStyle = focus;
  g.fillRect(0, 0, w, h);

  // A cool multiply. Small, but it is what stops every warm element in the
  // world — the road, the cabin window, the tower lamp — from competing with the
  // subject for attention.
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = 'rgba(122,132,152,0.3)';
  g.fillRect(0, 0, w, h);
  g.restore();

  topShadow(g, w, h, plan.skyHold);
}