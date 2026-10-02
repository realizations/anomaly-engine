/**
 * Three art directions for the same scene.
 *
 * This is the mockup laboratory: one place, one layout, rendered three very
 * different ways, so a direction can be chosen by looking at it rather than
 * arguing about it in words. Each direction is a set of full-screen passes that
 * modify how the composed scene is finished.
 *
 * They are not mere recolours. Each aims at a different theory of why the base
 * wallpaper feels flat:
 *
 *   A. depth -- the missing close foreground, and too little separation between
 *      the planes of the scene. Atmospheric perspective, light shafts, and a
 *      dark foreground band that anchors the viewer in the air.
 *   B. atmospheric -- a vacant gradient sky and too little air between the
 *      world. Structured cloud, a heavier horizon band, soft edges.
 *   C. darker/designed -- too much equal weight and a full, even glow. A
 *      darker base, negative space high in the frame, and light gathered on the
 *      one thing that earns it.
 */

import { fbm1D, mixRgb, css, shade } from '../render/noise.js';
import type { SkyGrade } from '../render/palette.js';

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

export function applyDirection(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  grade: SkyGrade,
  direction: Direction = current
): void {
  switch (direction) {
    case 'depth':
      applyDepth(g, w, h, grade);
      break;
    case 'atmospheric':
      applyAtmospheric(g, w, h, grade);
      break;
    case 'darker':
      applyDarker(g, w, h, grade);
      break;
  }
}

/* ------------------------------ shared ------------------------------ */

function horizonY(h: number): number {
  // Matches the renderer's terrain ground line, so overlays land on the same seam
  // the scene itself uses.
  return h * 0.72;
}

/** A soft shadow pushed into the top of the scene, for negative space. */
function topShadow(g: CanvasRenderingContext2D, w: number, h: number, strength: number): void {
  const grd = g.createLinearGradient(0, 0, 0, h * 0.45);
  grd.addColorStop(0, `rgba(5,8,16,${strength})`);
  grd.addColorStop(1, 'rgba(5,8,16,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h * 0.45);
}

/* ----------------------------- direction A ----------------------------- */

export function applyDepth(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  grade: SkyGrade
): void {
  const hy = horizonY(h);

  // --- atmospheric perspective -------------------------------------------
  // Far things melt toward the sky's colour.
  const sky = grade.skyHorizon;
  const haze = g.createLinearGradient(0, hy - h * 0.28, 0, hy + h * 0.05);
  haze.addColorStop(0, `rgba(${sky.r},${sky.g},${sky.b},0)`);
  haze.addColorStop(0.65, `rgba(${sky.r},${sky.g},${sky.b},0.28)`);
  haze.addColorStop(1, `rgba(${sky.r},${sky.g},${sky.b},0)`);
  g.fillStyle = haze;
  g.fillRect(0, hy - h * 0.28, w, h * 0.33);

  // --- a suggestion of light volume ----------------------------------------
  if (grade.sunAlpha > 0.05 || grade.moonAlpha > 0.05) {
    g.save();
    g.globalCompositeOperation = 'screen';
    for (let i = 0; i < 2; i++) {
      const x0 = w * (0.62 + i * 0.16);
      const tint = grade.sunAlpha > 0.05 ? grade.lightColor : { r: 190, g: 200, b: 225 };
      const a = (grade.sunAlpha > 0.05 ? grade.sunAlpha : grade.moonAlpha) * 0.10;
      const grd = g.createLinearGradient(x0, 0, x0 - w * 0.28, h * 0.9);
      grd.addColorStop(0, `rgba(${tint.r},${tint.g},${tint.b},${a})`);
      grd.addColorStop(1, `rgba(${tint.r},${tint.g},${tint.b},0)`);
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(x0, 0);
      g.lineTo(x0 + w * 0.16, 0);
      g.lineTo(x0 - w * 0.10, h);
      g.lineTo(x0 - w * 0.30, h);
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  // --- the foreground the base render lacked --------------------------------
  // A dark, close silhouette in the bottom third: tall grass along the line of
  // the ground.
  const dark = shade(grade.haze, -0.5);
  const fg = g.createLinearGradient(0, hy + h * 0.14, 0, h);
  fg.addColorStop(0, css(dark, 0.92));
  fg.addColorStop(1, css(dark, 1));

  g.fillStyle = fg;
  g.beginPath();
  g.moveTo(0, h);
  const seed = 771;
  for (let x = 0; x <= w; x += 8) {
    const t = fbm1D(x * 0.006, seed, 4);
    g.lineTo(x, h * (0.94 + (t - 0.5) * 0.09));
  }
  g.lineTo(w, h);
  g.closePath();
  g.fill();

  // Fine grass strokes rising from that ground line.
  g.strokeStyle = css(shade(dark, 0.25), 0.6);
  g.lineWidth = Math.max(1, h * 0.0016);
  const fronds = 90;
  for (let i = 0; i < fronds; i++) {
    const n = fbm1D(i * 0.73, seed + 13, 3);
    const x = n * w;
    const ground = h * (0.95 + fbm1D(x * 0.006, seed, 4) * 0.05);
    const tall = h * (0.03 + fbm1D(i * 1.31, seed + 5, 3) * 0.1);
    g.beginPath();
    g.moveTo(x, ground);
    g.quadraticCurveTo(x + (n - 0.5) * 14, ground - tall * 0.6, x + (n - 0.5) * 26, ground - tall);
    g.stroke();
  }

  topShadow(g, w, h, 0.25);
}

/* ----------------------------- direction B ----------------------------- */

export function applyAtmospheric(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  grade: SkyGrade
): void {
  const hy = horizonY(h);

  // --- cloud, tinted toward the sky's own colours --------------------------
  g.save();
  g.globalCompositeOperation = 'screen';
  for (let i = 0; i < 5; i++) {
    const n = fbm1D(i * 3.1, 42, 4);
    const cy = h * (0.10 + n * 0.22);
    const cx = ((n * 6.1 + i * 0.19) % 1) * w;
    const cloudW = w * (0.22 + fbm1D(i * 2.3, 7, 4) * 0.3);
    const cloudH = h * (0.045 + fbm1D(i * 1.1, 9, 4) * 0.05);
    const tint = mixRgb(grade.skyTop, grade.skyHorizon, 0.55 + fbm1D(i * 4.7, 3, 3) * 0.3);
    const alpha = 0.10 + grade.ambient * 0.10;
    const grd = g.createRadialGradient(cx, cy, 0, cx, cy, cloudW);
    grd.addColorStop(0, css(tint, alpha));
    grd.addColorStop(1, css(tint, 0));
    g.save();
    g.translate(cx, cy);
    g.scale(1, cloudH / cloudW);
    g.translate(-cx, -cy);
    g.fillStyle = grd;
    g.beginPath();
    g.arc(cx, cy, cloudW, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  g.restore();

  // --- horizon band --------------------------------------------------------
  const hz = grade.skyHorizon;
  const band = g.createLinearGradient(0, hy - h * 0.16, 0, hy + h * 0.08);
  band.addColorStop(0, `rgba(${hz.r},${hz.g},${hz.b},0)`);
  band.addColorStop(0.7, `rgba(${hz.r},${hz.g},${hz.b},0.30)`);
  band.addColorStop(1, `rgba(${hz.r},${hz.g},${hz.b},0)`);
  g.fillStyle = band;
  g.fillRect(0, hy - h * 0.16, w, h * 0.24);

  // The clouds are low, so the very top darkens a little to seat them.
  topShadow(g, w, h, 0.16);
}

/* ----------------------------- direction C ----------------------------- */

export function applyDarker(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  grade: SkyGrade
): void {
  const hy = horizonY(h);

  // Hold the sky down; let darkness supply the negative space.
  topShadow(g, w, h, 0.55);

  // Gather the light low in the frame, around the one thing that earns it.
  g.save();
  g.globalCompositeOperation = 'screen';
  const lx = w * 0.48;
  const ly = hy + h * 0.03;
  const tint = grade.sunAlpha > 0.05 ? grade.lightColor : { r: 235, g: 185, b: 120 };
  const a = 0.16 + (grade.sunAlpha > 0.05 ? grade.sunAlpha : 0.25) * 0.2;
  const grd = g.createRadialGradient(lx, ly, 0, lx, ly, w * 0.42);
  grd.addColorStop(0, `rgba(${tint.r},${tint.g},${tint.b},${a})`);
  grd.addColorStop(0.4, `rgba(${tint.r},${tint.g},${tint.b},${a * 0.35})`);
  grd.addColorStop(1, `rgba(${tint.r},${tint.g},${tint.b},0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  g.restore();

  // Push the outlying ground back, so the light reads as a place, not a gradient.
  const focus = g.createRadialGradient(lx, hy + h * 0.1, 0, lx, hy + h * 0.1, w * 0.5);
  focus.addColorStop(0, 'rgba(0,0,0,0)');
  focus.addColorStop(1, 'rgba(3,6,12,0.42)');
  g.fillStyle = focus;
  g.fillRect(0, 0, w, h);

  // Hold every light down so the one lit thing carries the frame.
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = 'rgba(96,106,128,0.22)';
  g.fillRect(0, 0, w, h);
  g.restore();
}