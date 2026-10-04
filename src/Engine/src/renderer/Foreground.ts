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
  const strength = ctx.grade.sunAlpha > 0.05 ? 0.2 : ctx.grade.moonAlpha * 0.22;
  const lit = ctx.grade.sunAlpha > 0.05 ? ctx.grade.lightColor : { r: 172, g: 186, b: 216 };
  return mixRgb(col, lit, strength * 0.6);
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
  // Three values, and the ordering is the whole design of this plane: the mass
  // the blades grow out of is the darkest thing in the frame, the blade bodies sit
  // just above it, and a sparse second pass lifts only the *tips*. Drawing every
  // blade at its lit value — which is what the first version did — filled the band
  // with pale straw and made the nearest plane the brightest one in the picture,
  // which inverts the scene's depth cue at exactly the point it should be strongest.
  const mass = scaleValue(col, 0.55);
  const tip = tipLight(ctx, col);
  const bladeTone = (row: number) =>
    row === 0 ? mixRgb(mass, ctx.grade.haze, 0.34) : row === 1 ? col : scaleValue(col, 0.78);

  // Blades are rooted below the bottom of the frame and the base mass is a strip
  // along the lower edge, so blades are visible across the depth of the plane
  // rather than as a fringe along its top. That was the difference between "a grass
  // bank" and "a dark band with a fuzzy top".
  const rootY = h * (top + 0.26);
  // The sway is a fraction of each blade's own length, not an absolute distance.
  //
  // It used to be `swayAmp * len * 5`, where swayAmp was already in pixels and
  // len was in pixels. That is a product of two lengths: for the longest blades it
  // came out around 11,000 pixels of sideways displacement, which drew a fan of
  // long straight lines right across the frame and read as scratches on the lens.
  // It was invisible on short blades, which is why it survived.
  const sway = amplitude('environment', ctx.intensity, 0.34);
  const swayRate = rate('environment', ctx.intensity, 0.085);
  // Dense enough to read as ground cover. A blade is only a few pixels wide, so a
  // sparse scatter samples as bare ground at 1:1 no matter how long it is.
  const count = Math.round(560 * density);

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

  // A laid-out blade, so the tip pass can reuse the same geometry.
  const laid: Array<{ x: number; y: number; len: number; w: number; lean: number; row: number }> = [];
  for (let i = 0; i < count; i++) {
    // Three depths inside the plane. Only the front row carries the silhouette;
    // the rest exist to give the mass behind it some thickness.
    const row = i % 3;
    const t = Math.pow(rnd(), 0.62);
    const len = h * 0.16 * (0.5 + t * 1.15) * (0.85 + density * 0.25);
    laid.push({
      x: (rnd() * 1.1 - 0.05) * w,
      y: rootY - (1 - row) * h * 0.03 + t * h * 0.07,
      len,
      w: Math.max(1.4, h * 0.0038 * (0.45 + t)),
      lean:
        (fbm1D(i * 1.9 + 4.2, ctx.seed + 77, 3) - 0.35) * len * 0.42 +
        Math.sin(ctx.t * swayRate + i * 0.9) * len * sway,
      row,
    });
  }

  for (const b of laid) {
    g.fillStyle = css(bladeTone(b.row), b.row === 0 ? 0.6 : 0.97);
    blade(b.x, b.y, b.len, b.w, b.lean);
  }

  // Tips. A sparse pass over roughly a fifth of the blades, each shortened to its
  // top third and drawn in the lit tone. This is what a backlit bank looks like
  // from a distance: black bodies with a few bright edges, not uniformly pale
  // straw. One fill each, so it costs a fraction of the bodies.
  g.fillStyle = css(tip, 0.8);
  for (let i = 0; i < laid.length; i += 5) {
    const b = laid[i];
    blade(b.x, b.y, b.len * 0.34, b.w * 0.6, b.lean * 0.34);
  }

  // The mass the blades grow out of: a strip along the bottom of the frame.
  g.fillStyle = css(mass, 1);
  crest(ctx, top + 0.185, 0.0055, 0.04);
  g.fill();
}

/* ------------------------------ heather ------------------------------- */

/**
 * A low mat of vegetation.
 *
 * The first version drew each clump as a handful of large overlapping ellipses
 * with a radial highlight. At wallpaper scale that is not heather, it is a row of
 * glossy black eggs: the lobes were big enough to be read individually, the
 * highlight made them look moulded, and the clumps sat at a near-constant height
 * so the band read as a row.
 *
 * What heather actually looks like from twenty metres away is a dense, uneven
 * mat with no individual plant resolvable — a texture, not a set of shapes. So
 * this draws many small tufts instead of a few large lobes, at strongly varied
 * heights, with no specular highlight: a faint top-light on each tuft and
 * nothing else. The eye reads the aggregate as ground cover, which is the point.
 */
function drawHeather(ctx: ForegroundContext, top: number, col: RGB, density: number): void {
  const { w, h } = ctx;
  const g = ctx.g;
  const rnd = mulberry32(ctx.seed ^ 0x51d3);
  const mass = scaleValue(col, 0.66);
  const tuftLight = tipLight(ctx, col);

  // Root the tufts along a line below the crest, and let them stand a little
  // proud of it, so the crest reads as vegetation rather than as an edge.
  const rootY = h * (top + 0.2);
  // Same rule as the grass: sway is a fraction of the tuft's own length. See
  // drawGrass for why multiplying two lengths here was a real defect.
  const sway = amplitude('environment', ctx.intensity, 0.3);
  const swayRate = rate('environment', ctx.intensity, 0.12);

  const count = Math.round(520 * density);
  for (let i = 0; i < count; i++) {
    const t = Math.pow(rnd(), 0.7);
    const x = (rnd() * 1.08 - 0.04) * w;
    const y = rootY + t * h * 0.09;
    const len = h * (0.035 + t * 0.085) * (0.55 + rnd() * 0.9);
    const width = Math.max(0.8, h * 0.0016 * (0.6 + t));
    // Tufts fan rather than stand: a small spread of tips from one root.
    const spread = (rnd() - 0.5) * len * 0.9;
    const lean = spread + Math.sin(ctx.t * swayRate + i * 1.3) * len * sway;

    const grd = g.createLinearGradient(x, y, x + lean, y - len);
    grd.addColorStop(0, css(mass, 1));
    grd.addColorStop(1, css(mixRgb(col, tuftLight, 0.42), 1));
    g.fillStyle = grd;

    g.beginPath();
    g.moveTo(x - width, y);
    g.quadraticCurveTo(x + lean * 0.4 - width * 0.7, y - len * 0.62, x + lean, y - len);
    g.quadraticCurveTo(x + lean * 0.4 + width * 0.7, y - len * 0.62, x + width, y);
    g.closePath();
    g.fill();
  }

  // The mat itself. Drawn last so it hides the roots, which is what stops the
  // tufts looking like blades standing on a shelf.
  const bankTop = h * (top + 0.09);
  const bank = g.createLinearGradient(0, bankTop, 0, h);
  bank.addColorStop(0, css(mass, 0));
  bank.addColorStop(0.45, css(mass, 0.94));
  bank.addColorStop(1, css(scaleValue(mass, 0.7), 1));
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

// --- the far edge ------------------------------------------------------------
// A haze wash over the top of the plane, so it meets the ground across a soft
// transition rather than a cut. A hard seam here reads as a pasted strip, and it
// is easy to get wrong: the gradient has to start at *zero* alpha at the top of
// the rect. Peaking at the top instead put a full-strength band of haze against
// an un-washed background above it, which measured as a 12-luma step across the
// full width of the frame.
const seamTop = ctx.h * (top - 0.05);
const seamH = ctx.h * 0.16;
const seam = g.createLinearGradient(0, seamTop, 0, seamTop + seamH);
seam.addColorStop(0, css(ctx.grade.haze, 0));
seam.addColorStop(0.22, css(ctx.grade.haze, 0.16));
seam.addColorStop(1, css(ctx.grade.haze, 0));
g.fillStyle = seam;
g.fillRect(0, seamTop, ctx.w, seamH);
}
