/**
 * Cloud.
 *
 * ## What was wrong, twice
 *
 * The first version drew each cloud as one horizontally squashed radial gradient.
 * A screen of those at a single alpha summed into a single wide horizontal smear
 * — the mockups showed it plainly, and no amount of tuning the alpha fixed it.
 *
 * The second version traced a real cumulus silhouette: a crown of piled lobes
 * over a flat base, filled as one path. It produced something worse. A hard
 * silhouette with evenly spaced quadratic bumps does not read as weather, it
 * reads as a cartoon; and the three-pass "softening" was a no-op, because all
 * three passes were clipped to the same path, so the outermost one still set a
 * hard edge at exactly the shape being softened.
 *
 * ## What this version does instead
 *
 * A bank is a *population* of soft lobes, not one shape:
 *
 *   * many lobes per bank, with strongly varied radii, so the outline is
 *     irregular rather than scalloped;
 *   * lobe centres on a jittered arc, so the bank piles up in the middle and
 *     tapers at both ends;
 *   * a per-lobe alpha, so overlapping lobes accumulate into visible internal
 *     density instead of painting over each other at one flat value — this was
 *     the actual root cause of the original smear;
 *   * per-lobe colour driven by height within the bank, so the crown catches the
 *     light and the underside stays shaded;
 *   * lateral bias, so the bank is brighter on the side the light is coming from.
 *
 * The silhouette is never drawn. That is deliberate: in Canvas 2D a silhouette is
 * a hard edge, and hard edges are the one thing weather does not have. Softness
 * comes from the radial falloff of overlapping lobes, which is free.
 */
import { mulberry32, css, mixRgb, shade } from '../render/noise.js';
import type { RGB } from '../render/noise.js';
import type { SkyGrade } from '../render/palette.js';

export interface CloudFieldOptions {
  w: number;
  h: number;
  /** Top of the sky, where clouds may begin. */
  skyTop: number;
  /** The horizon. Clouds do not cross it. */
  horizon: number;
  grade: SkyGrade;
  /** 0..1 from the world's authored cloudiness, times the plan's multiplier. */
  cloudiness: number;
  /** Horizontal offset in 0..1, for drift. */
  drift: number;
  /** Wind shear. */
  windSpeed: number;
  /** Direction the light arrives from, 0..1 across the width. */
  lightX: number;
  seed: number;
}

interface Lobe {
  /** Centre, in pixels. */
  x: number;
  y: number;
  rx: number;
  ry: number;
  alpha: number;
  /** 0 at the base of the bank, 1 at the crown. Drives the shading. */
  lift: number;
}

interface Bank {
  x: number;
  y: number;
  /** Half-width. */
  w: number;
  h: number;
  alpha: number;
  depth: number;
  /** Overall brightness of the bank, before per-lobe shading. */
  lift: number;
  jitter: number;
}

/**
 * Lays out the banks.
 *
 * Heights are quantised into a few levels rather than scattered continuously: real
 * skies are banded, and a continuous distribution reads as noise. Banks also get
 * closer together toward the horizon, because perspective does that to a flat
 * sky and a uniform vertical spacing looks like a mistake.
 */
function layout(opts: CloudFieldOptions): Bank[] {
  const { w, skyTop, horizon, cloudiness, drift, seed } = opts;
  const usable = horizon - skyTop;
  if (usable <= 0 || cloudiness <= 0.001) return [];

  const rnd = mulberry32(seed);
  const rows = 3 + Math.round(cloudiness * 2.5);
  const out: Bank[] = [];

  for (let r = 0; r < rows; r++) {
    const t = (r + 0.5) / rows;
    const squashed = t * t;
    const level = skyTop + usable * (0.06 + squashed * 0.9);
    const nearness = squashed;
    const perRow = 1 + Math.round(cloudiness * (0.5 + nearness * 1.8));

    for (let i = 0; i < perRow; i++) {
      const raw = (i / perRow + r * 0.41 + drift * (0.3 + nearness * 1.6)) % 1;
      const half = w * (0.14 + rnd() * 0.22) * (0.7 + nearness * 0.6);
      out.push({
        x: (raw * 1.4 - 0.2) * w,
        y: level + (rnd() - 0.5) * usable * 0.05,
        w: half,
        // Wide and shallow: a bank seen from the ground is far wider than tall,
        // and a four-to-one ratio is the ratio of a cartoon cloud.
        h: half * (0.16 + rnd() * 0.13) * (1 - nearness * 0.3),
        // Thin. Alpha accumulates, so a bank of individually faint lobes reads as
        // a soft mass; the same lobes at higher alpha read as a solid one.
        alpha: (0.05 + rnd() * 0.05) * (0.4 + nearness * 0.9),
        // Far banks are paler and hazier.
        lift: 0.3 + rnd() * 0.5 + nearness * 0.25,
        depth: 1 - nearness,
        jitter: rnd(),
      });
    }
  }
  return out;
}

/**
 * Scatters one bank's lobes.
 *
 * Centres follow a jittered arc rather than a line, which is what gives a bank its
 * pile-up. Radius varies by more than 3x across the bank, because uniform lobes
 * are what produce a scalloped edge.
 */
function lobes(bank: Bank, seed: number): Lobe[] {
  const rnd = mulberry32(seed);
  const out: Lobe[] = [];
  const count = 9 + Math.floor(rnd() * 7);

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    // Arc: highest near the middle, falling to the ends.
    const arc = Math.sin(Math.PI * t);
    // Jitter both ways, so the arc is a suggestion rather than a template.
    const jx = (rnd() - 0.5) * 0.14;
    const jy = (rnd() - 0.5) * 0.5;
    const size = (0.3 + Math.pow(rnd(), 1.5) * 1.5) * (0.45 + arc * 0.8);

    const cx = bank.x + (t + jx) * bank.w * 2 - bank.w;
    const cy = bank.y - bank.h * (0.15 + arc * 0.7 + jy * 0.5);

    out.push({
      x: cx,
      y: cy,
      rx: bank.w * size * (0.34 + rnd() * 0.3),
      ry: bank.h * size * (0.5 + rnd() * 0.45),
      // Denser toward the middle of the bank, so the mass has a core.
      alpha: bank.alpha * (0.55 + arc * 0.75) * (0.6 + rnd() * 0.8),
      lift: Math.max(0, Math.min(1, 0.3 + arc * 0.5 + (rnd() - 0.5) * 0.4)),
    });
  }
  return out;
}

/** One soft lobe. */
function drawLobe(
  g: CanvasRenderingContext2D,
  l: Lobe,
  crown: RGB,
  base: RGB,
  lit: RGB,
  litFromLeft: boolean
): void {
  g.save();
  g.translate(l.x, l.y);
  g.scale(1, l.ry / l.rx);

  // Height within the bank decides the tone: crowns catch the light, undersides
  // stay in shadow. Without this the bank is one flat value no matter how soft
  // its edges are, and soft grey blobs are not clouds either.
  const col = mixRgb(base, crown, l.lift);
  const warm = litFromLeft ? lit : mixRgb(lit, base, 0.35);
  const tint = mixRgb(col, warm, l.lift * (litFromLeft ? 0.5 : 0.18));

  const grd = g.createRadialGradient(0, 0, 0, 0, 0, l.rx);
  grd.addColorStop(0, css(tint, l.alpha));
  grd.addColorStop(0.35, css(tint, l.alpha * 0.72));
  grd.addColorStop(0.72, css(tint, l.alpha * 0.22));
  grd.addColorStop(1, css(tint, 0));
  g.fillStyle = grd;
  g.beginPath();
  g.arc(0, 0, l.rx, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/**
 * Draws the cloud field.
 *
 * One pass, no silhouette, no clip. A `screen` composite for the lit banks would
 * blow out at sunset, so this draws over — the lobes are thin enough that
 * accumulation alone carries the mass.
 */
export function renderClouds(g: CanvasRenderingContext2D, opts: CloudFieldOptions): void {
  const { w, grade } = opts;
  const banks = layout(opts);
  if (banks.length === 0) return;

  const litColour = grade.sunAlpha > 0.05 ? grade.lightColor : { r: 188, g: 200, b: 228 };
  // Back to front, so nearer banks overlap farther ones.
  banks.sort((a, b) => a.y - b.y);

  g.save();
  for (const bank of banks) {
    // Far banks are pushed toward the haze and lifted; near ones keep their own
    // value. That separation is aerial perspective doing its job.
    const tone = mixRgb(grade.haze, litColour, 0.14 + grade.ambient * 0.34);
    const hazed = mixRgb(tone, grade.skyHorizon, bank.depth * 0.45);
    const crown = shade(mixRgb(hazed, litColour, bank.lift * 0.4), 0.06);
    const base = shade(mixRgb(hazed, { r: 0, g: 0, b: 0 }, 0.42), -0.05);
    const litFromLeft = opts.lightX < bank.x / w;

    for (const l of lobes(bank, (bank.jitter * 100000) | 0)) {
      drawLobe(g, l, crown, base, litColour, litFromLeft);
    }
  }
  g.restore();

  // --- air under the deck -----------------------------------------------------
  // The band of haze immediately below a cloud deck is brighter than the air above
  // it. Without it the bottom edge of the field ends in nothing, which is what
  // made the sky read as a gradient with a smear on it.
  const deck = banks.reduce((a, b) => Math.max(a, b.y), 0);
  if (deck > opts.skyTop) {
    const under = g.createLinearGradient(0, deck - opts.h * 0.14, 0, opts.horizon);
    const air = mixRgb(grade.haze, litColour, 0.32);
    under.addColorStop(0, css(air, 0));
    under.addColorStop(1, css(air, 0.11 * (0.45 + grade.ambient)));
    g.fillStyle = under;
    g.fillRect(0, deck - opts.h * 0.14, w, opts.horizon - deck + opts.h * 0.14);
  }
}