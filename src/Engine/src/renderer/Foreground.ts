/**
 * The close foreground.
 *
 * ## Why this is its own file
 *
 * The scene composes from the horizon down, and everything it drew lived on or
 * above the ground plane. That leaves the bottom third of the frame as an
 * uninterrupted gradient, which is the single most reliable way to make a
 * landscape read as wallpaper rather than as a place: there is nothing between
 * the viewer and the land, so the land is infinitely far away.
 *
 * This module draws the one plane that is genuinely close — the near-occluder
 * that every painted landscape has and this one did not. It is drawn last, it is
 * the darkest value in the frame by a wide margin, and it exists to give the
 * image a front edge.
 *
 * ## How it is drawn
 *
 * Silhouettes, not detail. Each kind is a clump of overlapping masses whose
 * outline is the only thing the viewer gets; interior detail would be wasted at
 * this value and would only reintroduce the noise the dark plane exists to
 * remove. Clumps are placed by clustered noise rather than uniformly, because
 * evenly spaced objects read as a pattern and a pattern reads as decoration.
 *
 * The sway is deliberately the slowest thing in the renderer. A foreground is
 * the largest moving mass on screen, so it is also the first thing a viewer
 * notices moving; see `motion.ts` for why it is routed rather than scaled ad hoc.
 */
import { fbm1D, mulberry32, css, mixRgb, scaleValue, shade } from '../render/noise.js';
import type { RGB } from '../render/noise.js';
import type { SkyGrade } from '../render/palette.js';
import type { ForegroundKind } from './ScenePlan.js';
import { amplitude, rate } from './motion.js';

export interface ForegroundSpec {
  kind: ForegroundKind;
  /** Top edge of the plane, as a fraction of the viewport height. */
  top: number;
  /** 0..1. Scales how much of the frame the plane occupies and how dense it is. */
  density: number;
  /** Value multiplier from the plan's ramp. This plane is always the darkest. */
  value: number;
}

export interface ForegroundContext {
  g: CanvasRenderingContext2D;
  w: number;
  h: number;
  /** Seconds since the renderer started. */
  t: number;
  /** World seed, so the silhouette is stable per world. */
  seed: number;
  grade: SkyGrade;
  /** 0..1 from the motion model. */
  intensity: number;
  windSpeed: number;
  /** Base tone of the ground the plane is standing in. */
  ground: RGB;
}

/**
 * Returns the plane's silhouette colour.
 *
 * The plane is darker than anything behind it by construction, not by
 * comparison: it is the ground colour pushed down hard and mixed toward the
 * frame's own shadow, so it holds its role at every hour without needing to
 * know what hour it is.
 *
 * `value` is the plan's ramp entry, applied with `scaleValue`. It has to be:
 * `shade` interprets a positive number as "move this far toward white", so
 * passing a depth multiplier of 0.26 to it *lightened* the nearest plane in the
 * frame to a mid grey, which is precisely the plane that has to be the darkest.
 */
function planeColor(ctx: ForegroundContext, value: number): RGB {
  const deep = mixRgb(
    mixRgb(ctx.ground, { r: 0, g: 0, b: 0 }, 0.62),
    mixRgb(ctx.grade.haze, { r: 0, g: 0, b: 0 }, 0.82),
    0.5
  );
  return scaleValue(deep, value);
}

/**
 * The faintest moonlight the tips of the near plane can catch.
 *
 * Blades are drawn as flat silhouettes against a dark mass, and two dark shapes
 * on top of each other are one shape. A slight lift on the upper half of the
 * plane is enough to separate them, and it is what a real backlit grass bank
 * looks like: the mass is black, the edges are silver.
 */
function tipLight(ctx: ForegroundContext, col: RGB): RGB {
  const strength = ctx.grade.sunAlpha > 0.05 ? 0.34 : ctx.grade.moonAlpha * 0.3;
  const lit = ctx.grade.sunAlpha > 0.05 ? ctx.grade.lightColor : { r: 172, g: 186, b: 216 };
  return mixRgb(col, lit, strength * 0.5);
}

/* ------------------------------ clumping ------------------------------ */

/**
 * Traces the plane's ground mass: the wavy line at `top` plus everything below
 * it, closed to the bottom of the frame.
 *
 * Every kind builds its body on this, so the four silhouettes read as belonging
 * to the same ground even though their outlines are completely different.
 * `amp` is deliberately small: a mass with a big wobble reads as a hill rolling
 * past the camera, which is a different (and much louder) statement than a
 * ground plane that grass is growing out of.
 */
function crest(ctx: ForegroundContext, top: number, freq: number, amp: number): void {
  const g = ctx.g;
  g.beginPath();
  g.moveTo(0, ctx.h);
  for (let px = 0; px <= ctx.w; px += 8) {
    const n = fbm1D(px * freq, ctx.seed + 3, 4);
    g.lineTo(px, ctx.h * top + (n - 0.5) * ctx.h * amp);
  }
  g.lineTo(ctx.w, ctx.h);
  g.closePath();
}

/**
 * Places n clumps across the width with irregular spacing.
 *
 * Uniform spacing is the failure mode here: a row of evenly sized masses reads as
 * a border pattern, and the eye finds and rejects the rhythm immediately. Each
 * clump's position comes from clustered noise rather than from a uniform draw, so
 * the silhouette has both gaps and bunches, and open ground between the bunches
 * is what makes the occupied ground read as occupied.
 */
function clumps(count: number, seed: number): Array<{ x: number; s: number; k: number }> {
  const rnd = mulberry32(seed);
  const out: Array<{ x: number; s: number; k: number }> = [];
  for (let i = 0; i < count; i++) {
    const centre = fbm1D(i * 0.83 + 11.3, seed, 3);
    out.push({
      // Slightly wider than 0..1 so the leftmost and rightmost clumps are not
      // clipped into half-masses at the frame edge.
      x: (centre + (rnd() - 0.5) * 0.34) * 1.12 - 0.06,
      s: 0.55 + rnd() * 0.9,
      k: Math.floor(rnd() * 4),
    });
  }
  out.sort((a, b) => a.x - b.x);
  return out;
}

/* ------------------------------- grass -------------------------------- */

function drawGrass(ctx: ForegroundContext, top: number, col: RGB, density: number): void {
  const { w, h } = ctx;
  const g = ctx.g;
const rnd = mulberry32(ctx.seed ^ 0x2b71);
  const mass = scaleValue(col, 0.78);
  const tip = tipLight(ctx, col);
  // Blades are rooted low and reach well past the crest. This is the whole point
  // of the plane: the silhouette the viewer reads has to be the *tallest blades*,
  // and if the mass fills up to the crest then the blades are hidden behind it
  // and the foreground is just a dark band.
  const rootY = h * (top + 0.24);
  const swayAmp = amplitude('environment', ctx.intensity, h * 0.016);
  const swayRate = rate('environment', ctx.intensity, 0.085);
  const count = Math.round(260 * density);

  const blade = (x: number, y: number, len: number, width: number, lean: number) => {
    // Quadratic blade with the control point offset along the lean, so a leaning
    // blade curves instead of hinging at the tip.
    g.beginPath();
    g.moveTo(x - width * 0.5, y);
    g.quadraticCurveTo(x + lean * 0.35 - width * 0.3, y - len * 0.6, x + lean, y - len);
    g.quadraticCurveTo(x + lean * 0.35 + width * 0.3, y - len * 0.6, x + width * 0.5, y);
    g.closePath();
    g.fill();
  };

  for (let i = 0; i < count; i++) {
    // Three depths inside the plane. Only the front row carries the silhouette;
    // the rest exist to give the mass behind it some thickness.
    const row = i % 3;
    const back = row === 0;
    const t = Math.pow(rnd(), 0.62);
    const x = (rnd() * 1.1 - 0.05) * w;
    const y = rootY - (1 - row) * h * 0.02 + t * h * 0.06;
    // Long enough that a good number of blades clear the crest by a wide margin.
    const len = h * (back ? 0.16 : 0.21) * (0.5 + t * 1.05) * (0.85 + density * 0.25);
    const lean = (fbm1D(i * 1.9 + 4.2, ctx.seed + 77, 3) - 0.35) * len * 0.42
      + Math.sin(ctx.t * swayRate + i * 0.9) * swayAmp * len * 5;
    const width = Math.max(0.9, h * 0.0024 * (0.6 + t));

    // Back blades sit in the haze and get no tip light; front blades catch it.
    g.fillStyle = back
      ? css(mixRgb(mass, ctx.grade.haze, 0.4), 0.5)
      : css(row === 2 ? mass : mixRgb(mass, tip, 0.4), 0.96);
    blade(x, y, len, width, lean);
  }

  // The mass the blades grow out of, well below the crest so the blades stand
  // clear of it.
  g.fillStyle = css(mass, 1);
  crest(ctx, top + 0.11, 0.0055, 0.05);
  g.fill();
}

/* ------------------------------ heather ------------------------------- */

function drawHeather(ctx: ForegroundContext, top: number, col: RGB, density: number): void {
  const { w, h } = ctx;
  const g = ctx.g;
  const list = clumps(Math.round(30 * density), ctx.seed + 5);
  const baseY = h * (top + 0.1);

  for (const c of list) {
    const cx = c.x * w;
    const rx = w * (0.022 + c.s * 0.038);
    const ry = h * (0.022 + c.s * 0.05) * (0.75 + density * 0.35);
    const y = baseY + fbm1D(c.x * 9, ctx.seed, 3) * h * 0.03;

    // A clump is several overlapping lobes, not one ellipse. The lobes break the
    // outline, which is the only thing that makes a soft mass read as a plant
    // instead of as a smudge.
    for (let l = 0; l < 5; l++) {
      const a = (l / 5) * Math.PI * 2 + c.k;
      const lx = cx + Math.cos(a) * rx * 0.42;
      const ly = y - Math.abs(Math.sin(a)) * ry * 0.62;
      const lrx = rx * (0.42 + ((l * 37) % 11) / 30);
      const lry = ry * (0.44 + ((l * 53) % 13) / 34);

      g.save();
      g.translate(lx, ly);
      g.scale(1, lry / lrx);
      const grd = g.createRadialGradient(-lrx * 0.24, -lrx * 0.3, 0, 0, 0, lrx);
      grd.addColorStop(0, css(shade(col, 0.12), 0.96));
      grd.addColorStop(1, css(col, 0.96));
      g.fillStyle = grd;
      g.beginPath();
      g.arc(0, 0, lrx, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }

  // A soft bank rather than a hard edge, so the plane dissolves into the ground
  // instead of sitting on it.
  const bankTop = h * (top + 0.06);
  const bank = g.createLinearGradient(0, bankTop, 0, h);
  bank.addColorStop(0, css(col, 0));
  bank.addColorStop(0.5, css(col, 0.82));
  bank.addColorStop(1, css(shade(col, -0.28), 1));
  g.fillStyle = bank;
  g.fillRect(0, bankTop, w, h - bankTop);
}

/* ------------------------------- fence -------------------------------- */

/**
 * A post-and-wire fence, leaning.
 *
 * Man-made geometry in the near foreground is the strongest available signal
 * that the viewer is standing somewhere rather than looking at somewhere, and it
 * does the job that organic clutter cannot: it gives the eye a straight line to
 * read perspective against. Every post is off-plumb by a different amount, and
 * the wires sag between them, because a fence built by a machine is the one
 * thing in this renderer that would otherwise look drawn rather than found.
 */
function drawFence(ctx: ForegroundContext, top: number, col: RGB, density: number): void {
  const { w, h } = ctx;
  const g = ctx.g;
  const count = Math.max(5, Math.round(10 * density));
  const gap = w / count;
  const groundY = h * (top + 0.2);
  const rnd = mulberry32(ctx.seed ^ 0x77c3);

  type Post = { x: number; top: number; lean: number; hw: number };
  const posts: Post[] = [];
  for (let i = 0; i <= count; i++) {
    // Posts on the right sit further back, so the fence recedes rather than
    // running flat across the frame.
    const depth = i / count;
    const scale = 1 - depth * 0.3;
    posts.push({
      x: (i + 0.5) * gap + (rnd() - 0.5) * gap * 0.3,
      top: h * top + (rnd() - 0.35) * h * 0.05 + scale * h * 0.03,
      lean: (rnd() - 0.5) * h * 0.016,
      hw: Math.max(1.4, h * 0.0048 * scale),
    });
  }

  // Ground the posts stand on.
  g.fillStyle = css(shade(col, -0.32), 1);
  crest(ctx, top + 0.09, 0.006, 0.045);
  g.fill();

  // Wires behind the posts, sagging between each pair.
  for (let wire = 0; wire < 3; wire++) {
    const drop = 0.22 + wire * 0.28;
    const sag = h * (0.014 + wire * 0.007);
    g.strokeStyle = css(col, 0.94 - wire * 0.14);
    g.lineWidth = Math.max(0.9, h * 0.0014 - wire * 0.0002);
    g.beginPath();
    for (let i = 0; i < posts.length - 1; i++) {
      const a = posts[i];
      const b = posts[i + 1];
      const ay = a.top + (groundY - a.top) * drop;
      const by = b.top + (groundY - b.top) * drop;
      g.moveTo(a.x + a.lean * drop, ay);
      g.quadraticCurveTo((a.x + b.x) / 2, (ay + by) / 2 + sag, b.x + b.lean * drop, by);
    }
    g.stroke();
  }

  for (const p of posts) {
    g.fillStyle = css(col, 1);
    g.beginPath();
    g.moveTo(p.x - p.hw, groundY + h * 0.03);
    g.lineTo(p.x + p.lean - p.hw * 0.72, p.top);
    g.lineTo(p.x + p.lean + p.hw * 0.72, p.top);
    g.lineTo(p.x + p.hw, groundY + h * 0.03);
    g.closePath();
    g.fill();
    // A cap, so the post has a top rather than a point.
    g.fillRect(p.x + p.lean - p.hw * 0.86, p.top - h * 0.005, p.hw * 1.72, h * 0.006);
  }
}

/* ------------------------------ boulders ------------------------------ */

function drawBoulders(ctx: ForegroundContext, top: number, col: RGB, density: number): void {
  const { w, h } = ctx;
  const g = ctx.g;
  const list = clumps(Math.round(10 * density), ctx.seed + 13);

  g.fillStyle = css(shade(col, -0.28), 1);
  crest(ctx, top + 0.1, 0.007, 0.05);
  g.fill();

  for (const c of list) {
    const cx = c.x * w + w * 0.03;
    const rx = w * (0.028 + c.s * 0.055);
    const ry = h * (0.055 + c.s * 0.075) * (0.8 + density * 0.3);
    const y = h * (top + 0.14) + fbm1D(c.x * 7, ctx.seed, 3) * h * 0.03;

    // A boulder is a faceted mass: a flat base, an uneven crown, and one lit
    // edge. An ellipse would read as a pebble-shaped balloon.
    const pts: Array<[number, number]> = [];
    const facets = 9;
    for (let i = 0; i < facets; i++) {
      const a = Math.PI + (i / (facets - 1)) * Math.PI;
      const jitter = 0.78 + fbm1D(i * 2.7 + c.k, ctx.seed + 31, 3) * 0.44;
      pts.push([cx + Math.cos(a) * rx * jitter, y + Math.sin(a) * ry * jitter]);
    }

    g.beginPath();
    g.moveTo(cx - rx * 1.02, y);
    for (const [px, py] of pts) g.lineTo(px, py);
    g.lineTo(cx + rx * 1.02, y);
    g.closePath();

    const grd = g.createLinearGradient(cx - rx * 0.6, y - ry, cx + rx * 0.5, y);
    grd.addColorStop(0, css(shade(col, 0.18), 1));
    grd.addColorStop(0.55, css(col, 1));
    grd.addColorStop(1, css(shade(col, -0.34), 1));
    g.fillStyle = grd;
    g.fill();

    // The lit edge, from whichever side the sky is brightest.
    g.strokeStyle = css(shade(col, 0.32), 0.5);
    g.lineWidth = Math.max(1, h * 0.0018);
    g.beginPath();
    pts.forEach(([px, py], i) => (i === 0 ? g.moveTo(px, py) : g.lineTo(px, py)));
    g.stroke();
  }
}

/* ------------------------------- entry -------------------------------- */

export function renderForeground(ctx: ForegroundContext, spec: ForegroundSpec): void {
  if (spec.kind === 'none') return;

  const g = ctx.g;
  const col = planeColor(ctx, spec.value);
  const top = spec.top;
  const density = Math.max(0.1, spec.density);

  g.save();
  switch (spec.kind) {
    case 'grass':
      drawGrass(ctx, top, col, density);
      break;
    case 'heather':
      drawHeather(ctx, top, col, density);
      break;
    case 'fence':
      drawFence(ctx, top, col, density);
      break;
    case 'boulders':
      drawBoulders(ctx, top, col, density);
      break;
  }
  g.restore();

  // A haze wash back over the plane's far edge. The foreground is the closest
  // thing in the scene, so it should be the *least* hazy — but it meets the
  // ground across a soft transition rather than a cut, and a hard seam there
  // reads as a pasted strip.
  const seam = g.createLinearGradient(0, ctx.h * (top - 0.03), 0, ctx.h * (top + 0.09));
  seam.addColorStop(0, css(ctx.grade.haze, 0.14));
  seam.addColorStop(1, css(ctx.grade.haze, 0));
  g.fillStyle = seam;
  g.fillRect(0, ctx.h * (top - 0.03), ctx.w, ctx.h * 0.12);
}
