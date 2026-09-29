/**
 * The liminal interior.
 *
 * A liminal space is not a landscape and it does not want to be treated as
 * one. It is an ordinary place with the life taken out of it: a corridor, a
 * lobby, a car park, a stairwell that leads nowhere in particular. The unease
 * is not darkness and not threat. It is the almost-correct — the geometry is
 * mundane, the lighting is institutional, and every single thing is slightly
 * off in a way you cannot name.
 *
 * Four rules govern everything here, taken from what actually makes liminal
 * imagery work:
 *
 *  1. No people, ever. The absence is the subject. A figure in the frame turns
 *     the space from somewhere you are alone into somewhere something is
 *     watching, and that is horror, not liminality.
 *  2. Low entropy. Repetition, symmetry and a small palette. The eye has
 *     nothing to rest on, so it starts hunting for the thing that changed.
 *  3. Mundane geometry. Institutional tile, panelled walls, ceiling grids,
 *     fluorescent tubes. Nothing dramatic ever happens here, on purpose.
 *  4. One wrong thing, small. The space is almost right. If more than one
 *     detail is off it becomes a haunted house instead of a place that feels
 *     like a memory.
 *
 * The technical construction is a one-point perspective corridor. Perspective
 * is what makes the repetition legible, so the bay spacing is derived from true
 * projective division rather than drawn by hand: equal bays in the world become
 * compressions toward the vanishing point, which is exactly what the eye
 * expects and rarely gets to see.
 */

import { css, mixRgb, mulberry32, type RGB } from '../render/noise.js';
import type { SkyGrade } from '../render/palette.js';
import type { WorldDefinition } from '../worlds/types.js';

const WALL_HI = { r: 172, g: 168, b: 152 };
const WALL_LO = { r: 96, g: 94, b: 86 };
const FLOOR_HI = { r: 118, g: 114, b: 104 };
const CEIL_HI = { r: 140, g: 138, b: 128 };

/** The one detail allowed to be wrong, chosen per world seed. */
type Wrongness = 'door' | 'length' | 'light' | 'floor' | 'none';

export class LiminalInterior {
  private _seed: number;
  /** Which single detail is subtly wrong in this space. */
  private _wrong: Wrongness = 'none';
  /** Slight per-frame shimmer for the fluorescent tubes. */
  private _t = 0;
  /** A door that is very slightly ajar, in the far bays. */
  private _ajar: Array<{ bay: number; side: number }> = [];

  constructor(world: WorldDefinition) {
    this._seed = world.terrain.seed;
    const rnd = mulberry32(this._seed ^ 0x11aa);
    // One wrong thing per space, and it is a real architectural choice rather
    // than a random effect, so the same world always produces the same wrong
    // detail. That consistency is what makes a place feel like a place.
    const pool: Wrongness[] = ['door', 'length', 'light', 'floor'];
    this._wrong = pool[Math.floor(rnd() * pool.length)];

    // A couple of doors not quite closed.
    const doorCount = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < doorCount; i++) {
      this._ajar.push({
        bay: 3 + Math.floor(rnd() * 8),
        side: rnd() > 0.5 ? 1 : -1,
      });
    }
  }

  render(
    g: CanvasRenderingContext2D, w: number, h: number, world: WorldDefinition, grade: SkyGrade, dt: number
  ): void {
    this._t += dt;
    const p = world.liminal ?? {};
    const vpX = (p.vanishingX ?? 0.5) * w;
    const vpY = h * 0.47;
    const bays = Math.round(p.bays ?? 9);
    const tile = p.tile ?? 54;
    // The building runs its own lighting, so the sky grade is not what lights
    // this room. It still matters: an interior with a window would leak the
    // hour, and even without one the eye expects the light outside to change
    // what it is doing to the surfaces. Ambient is used only as a slow drift.
    const drift = 0.82 + grade.ambient * 0.18;
    const light = (p.lightLevel ?? 0.8) * drift;
    const ceiling = p.ceiling ?? 1;
    const uniform = p.uniformity ?? 0.8;
    const tint = p.lightTint ?? { r: 206, g: 214, b: 196 };
    const wall = world.palette?.ground ?? WALL_LO;
    const haze = world.palette?.haze ?? { r: 18, g: 20, b: 26 };

    // The base. Not black: a liminal space is lit, it is just lit wrongly, and
    // a black frame reads as "dark level" rather than as an interior.
    g.fillStyle = css(mixRgb(haze, tint, 0.16 * light));
    g.fillRect(0, 0, w, h);

    this._drawDepth(g, w, h, vpX, vpY, wall, haze, uniform);
    if (ceiling > 0.02) this._drawCeiling(g, w, h, vpX, vpY, bays, ceiling, tint, light);
    this._drawFloor(g, w, h, vpX, vpY, bays, tile, wall, tint, light, uniform);
    this._drawWalls(g, w, h, vpX, vpY, bays, wall, tint, light, uniform);
    this._drawDoors(g, w, h, vpX, vpY, bays, wall, tint, light);
    this._drawLights(g, w, h, vpX, vpY, bays, ceiling, tint, light);
    this._drawAir(g, w, h, vpX, vpY, bays, haze, tint, light);
  }

  /**
   * Perspective depth. A soft wall of light behind the vanishing point, so the
   * corridor recedes into something rather than into a hard edge. This is the
   * single most important element: without visible depth the space reads as a
   * flat wall with lines drawn on it.
   */
  private _drawDepth(
    g: CanvasRenderingContext2D, w: number, h: number, vpX: number, vpY: number,
    wall: RGB, haze: RGB, uniform: number
  ): void {
    const grd = g.createRadialGradient(vpX, vpY, 0, vpX, vpY, Math.max(w, h) * 0.5);
    grd.addColorStop(0, css(mixRgb(haze, wall, 0.34)));
    grd.addColorStop(0.16, css(mixRgb(haze, wall, 0.14)));
    grd.addColorStop(1, css(haze));
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);

    // Ambient occlusion into the corners. Interiors are darkest where two
    // surfaces meet, and skipping this is most of why procedural rooms look
    // like cardboard.
    const corners: Array<[number, number]> = [[0, 0], [w, 0], [0, h], [w, h]];
    for (const [cx, cy] of corners) {
      const cg = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.42);
      cg.addColorStop(0, `rgba(0,0,0,${0.4 * (1 - uniform * 0.4)})`);
      cg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = cg;
      g.fillRect(0, 0, w, h);
    }
  }

  /**
   * The far end of the corridor, with the bays compressing toward it. Equal
   * spacing in the world becomes equal *fractions* here, which is what real
   * perspective does and what a hand-drawn version always gets wrong.
   */
  private _bayScale(bay: number, bays: number, far: number): number {
    // s = far + (1-far) * n/(n+d) — projective compression toward the far end.
    const d = bay + 1;
    return far + (1 - far) * (bays / (bays + d * 0.9));
  }

  private _drawCeiling(
    g: CanvasRenderingContext2D, w: number, _h: number, vpX: number, vpY: number,
    bays: number, ceiling: number, tint: RGB, light: number
  ): void {
    const far = 0.055 + (this._wrong === 'length' ? 0.03 : 0);
    g.save();
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(w, 0);
    g.lineTo(vpX, vpY);
    g.closePath();
    g.clip();

    g.fillStyle = css(mixRgb(mixRgb(CEIL_HI, tint, 0.22 * light), { r: 0, g: 0, b: 0 }, (1 - light) * 0.5), ceiling);
    g.fillRect(0, 0, w, vpY);

    // Ceiling grid: the strongest repetition cue in the space.
    g.strokeStyle = css(mixRgb(CEIL_HI, { r: 0, g: 0, b: 0 }, 0.45), 0.5 * ceiling);
    g.lineWidth = 1;
    for (let i = 1; i < bays; i++) {
      const s0 = this._bayScale(i - 1, bays, far);
      const s1 = this._bayScale(i, bays, far);
      g.beginPath();
      g.moveTo(vpX - s0 * w * 0.5, vpY - s0 * vpY);
      g.lineTo(vpX - s1 * w * 0.5, vpY - s1 * vpY);
      g.moveTo(vpX + s0 * w * 0.5, vpY - s0 * vpY);
      g.lineTo(vpX + s1 * w * 0.5, vpY - s1 * vpY);
      g.stroke();
    }
    g.restore();
  }

  private _drawFloor(
    g: CanvasRenderingContext2D, w: number, h: number, vpX: number, vpY: number,
    _bays: number, tile: number, wall: RGB, tint: RGB, light: number, uniform: number
  ): void {
    const far = 0.055 + (this._wrong === 'length' ? 0.03 : 0);

    g.save();
    g.beginPath();
    g.moveTo(0, h);
    g.lineTo(w, h);
    g.lineTo(vpX, vpY);
    g.closePath();
    g.clip();

    // Floor: brighter near the viewer, falling away toward the far end, so the
    // ground plane actually recedes instead of sitting flat under the walls.
    // Tinted by the tube light, because vinyl under fluorescents is never the
    // colour of the vinyl.
    const grd = g.createLinearGradient(0, vpY, 0, h);
    grd.addColorStop(0, css(mixRgb(mixRgb(FLOOR_HI, wall, 0.45), tint, 0.12 * light)));
    grd.addColorStop(0.35, css(mixRgb(mixRgb(FLOOR_HI, wall, 0.2), tint, 0.2 * light)));
    grd.addColorStop(1, css(mixRgb(mixRgb(FLOOR_HI, wall, 0.05), tint, 0.24 * light)));
    g.fillStyle = grd;
    g.fillRect(0, vpY - 1, w, h - vpY + 1);

    // Transverse tile seams. The tile grid is the main cue that the floor is a
    // surface with a size, which is what makes the space feel institutional.
    const tileT = this._wrong === 'floor' ? tile * 1.06 : tile;
    g.strokeStyle = css(mixRgb(FLOOR_HI, { r: 0, g: 0, b: 0 }, 0.5), 0.42);
    g.lineWidth = 1;
    for (let i = 1; i < 26; i++) {
      const y = vpY + (h - vpY) * Math.pow(i / 26, 1.9);
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }

    // Longitudinal seams converging on the vanishing point.
    g.strokeStyle = css(mixRgb(FLOOR_HI, { r: 0, g: 0, b: 0 }, 0.42), 0.3 * (0.4 + uniform * 0.6));
    for (let k = -8; k <= 8; k++) {
      const x = w * 0.5 + k * tileT;
      g.beginPath();
      g.moveTo(vpX + (x - vpX) * far, vpY);
      g.lineTo(x, h);
      g.stroke();
    }
    g.restore();
  }

  /**
   * Walls with the repeating bays. Uniformity controls how identical the panels
   * are; a little variation is what stops it reading as a texture, and total
   * uniformity is itself the wrongness.
   */
  private _drawWalls(
    g: CanvasRenderingContext2D, w: number, h: number, vpX: number, vpY: number,
    bays: number, wall: RGB, tint: RGB, light: number, _uniform: number
  ): void {
    const far = 0.055 + (this._wrong === 'length' ? 0.03 : 0);

    for (const side of [-1, 1] as const) {
      g.save();
      g.beginPath();
      if (side < 0) {
        g.moveTo(0, 0);
        g.lineTo(vpX, vpY);
        g.lineTo(0, h);
      } else {
        g.moveTo(w, 0);
        g.lineTo(vpX, vpY);
        g.lineTo(w, h);
      }
      g.closePath();
      g.clip();

      const grd = g.createLinearGradient(vpX, 0, side < 0 ? 0 : w, 0);
      grd.addColorStop(0, css(mixRgb(WALL_LO, wall, 0.35)));
      grd.addColorStop(0.5, css(mixRgb(mixRgb(WALL_HI, wall, 0.3), tint, 0.16 * light)));
      grd.addColorStop(1, css(mixRgb(mixRgb(WALL_HI, wall, 0.1), tint, 0.08 * light)));
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);

      // Bay divisions. Each bay is a panel, and the panel edges are what give
      // the eye a ruler to measure the repetition against.
      g.strokeStyle = css(mixRgb(WALL_HI, { r: 0, g: 0, b: 0 }, 0.52), 0.42);
      g.lineWidth = 1;
      for (let i = 1; i < bays; i++) {
        const s0 = this._bayScale(i - 1, bays, far);
        const s1 = this._bayScale(i, bays, far);
        const x0 = vpX + side * s0 * w * 0.5;
        const x1 = vpX + side * s1 * w * 0.5;
        g.beginPath();
        g.moveTo(x0, vpY - s0 * vpY);
        g.lineTo(x0, h - (1 - s0) * 0 + s0 * 0);
        g.stroke();
        g.beginPath();
        g.moveTo(x1, vpY - s1 * vpY);
        g.lineTo(x1, h);
        g.stroke();
      }

      // A dado rail. Institutional interiors have one, and its presence does
      // more to date and place the space than any amount of colour.
      g.strokeStyle = css(mixRgb(WALL_HI, { r: 0, g: 0, b: 0 }, 0.4), 0.5);
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, h * 0.62);
      g.lineTo(vpX, vpY + (h * 0.62 - vpY) * far);
      g.stroke();

      g.restore();
    }
  }

  /** Doors down one side. One of them, in this space, is not quite shut. */
  private _drawDoors(
    g: CanvasRenderingContext2D, w: number, h: number, vpX: number, vpY: number,
    bays: number, wall: RGB, _tint: RGB, _light: number
  ): void {
    const far = 0.055 + (this._wrong === 'length' ? 0.03 : 0);

    for (let i = 2; i < bays; i++) {
      const s = this._bayScale(i, bays, far);
      for (const side of [-1, 1] as const) {
        // Doors alternate sides, which is the detail that makes a corridor read
        // as a building rather than as a repeating graphic.
        if ((i + (side < 0 ? 0 : 1)) % 2 !== 0) continue;
        const x = vpX + side * s * w * 0.5;
        const top = vpY - s * vpY * 0.42;
        const bot = h - (1 - s) * h * 0.0;
        const dw = Math.max(2, s * w * 0.09);
        const dh = (bot - top) * 0.72;

        const ajar = this._ajar.find((a) => a.bay === i && a.side === side);
        const skew = ajar ? side * dw * 0.22 : 0;

        g.save();
        g.beginPath();
        g.moveTo(x, bot);
        g.lineTo(x, top);
        g.lineTo(x + skew, top + dh * 0.04);
        g.lineTo(x + skew, bot - dh * 0.02);
        g.closePath();
        const dg = g.createLinearGradient(x, top, x + skew, bot);
        dg.addColorStop(0, css(mixRgb(WALL_LO, { r: 0, g: 0, b: 0 }, 0.3)));
        dg.addColorStop(1, css(mixRgb(WALL_LO, wall, 0.25)));
        g.fillStyle = dg;
        g.fill();
        g.strokeStyle = css(mixRgb(WALL_HI, { r: 0, g: 0, b: 0 }, 0.55), 0.7);
        g.lineWidth = 1;
        g.stroke();

        // The gap of darkness behind an ajar door. This is the single detail
        // that makes the space feel like it continues somewhere you are not
        // being shown.
        if (ajar) {
          g.fillStyle = 'rgba(0,0,0,0.72)';
          g.fillRect(x + (side < 0 ? -dw * 0.16 : 0), top + dh * 0.05, dw * 0.16, dh * 0.9);
        }
        g.restore();
      }
    }
  }

  /**
   * Recessed fluorescent tubes receding down the ceiling.
   *
   * These are the reason the space reads as institutional: a row of identical
   * fixtures at even intervals, all the same colour, all equally bright. The
   * flicker is very slight and very regular, because a bad flicker is a horror
   * beat while a barely-there one is just a fact about the building. Drawn far
   * to near so the near fixtures correctly sit in front of the ones behind.
   */
  private _drawLights(
    g: CanvasRenderingContext2D, w: number, h: number, vpX: number, vpY: number,
    bays: number, _ceiling: number, tint: RGB, light: number
  ): void {
    const far = 0.055 + (this._wrong === 'length' ? 0.03 : 0);

    for (let i = bays - 1; i >= 0; i--) {
      const s = this._bayScale(i, bays, far);
      const y = vpY - s * vpY * 0.72;
      // A tube is a long thin fixture, and it has to stay thin. An earlier
      // version scaled the bloom ellipse off the tube width and produced one
      // enormous blown-out blob across the whole ceiling.
      const lw = Math.max(4, s * w * 0.085);
      const lh = Math.max(1.5, s * h * 0.009);
      const housingH = lh * 3.2;

      // The one wrong fixture, or a tube that is slightly out.
      const out = this._wrong === 'light' && i === bays - 3;
      // Regular shimmer. Not random: randomness reads as a broken render.
      const flick = out
        ? (Math.sin(this._t * 37) > 0.55 ? 0.4 : 1)
        : 0.95 + 0.05 * Math.sin(this._t * 2.1 + i);

      const a = light * flick * (out ? 0.45 : 1) * (0.3 + s * 0.7);

      // Housing: the dark recess the tube sits in.
      g.fillStyle = css(mixRgb(WALL_LO, { r: 0, g: 0, b: 0 }, 0.45), 0.7);
      g.fillRect(vpX - lw * 0.62, y - housingH / 2, lw * 1.24, housingH);

      g.save();
      g.globalCompositeOperation = 'lighter';

      // Tight bloom along the tube only.
      const bloom = g.createRadialGradient(vpX, y, 0, vpX, y, lw * 0.95);
      bloom.addColorStop(0, css(tint, 0.34 * a));
      bloom.addColorStop(0.45, css(tint, 0.1 * a));
      bloom.addColorStop(1, css(tint, 0));
      g.save();
      g.translate(vpX, y);
      g.scale(1, 0.24);
      g.fillStyle = bloom;
      g.beginPath();
      g.arc(0, 0, lw * 0.95, 0, Math.PI * 2);
      g.fill();
      g.restore();

      // The tube itself.
      g.fillStyle = css(mixRgb(tint, { r: 255, g: 255, b: 255 }, 0.55), 0.8 * a);
      g.fillRect(vpX - lw / 2, y - lh / 2, lw, lh);

      g.restore();
    }
  }

  /**
   * Air. A faint haze that pools in the middle distance. Real interiors have
   * visible air in a light beam, and without it the far end looks like it is
   * painted on rather than being further away.
   */
  private _drawAir(
    g: CanvasRenderingContext2D, w: number, h: number, vpX: number, vpY: number,
    _bays: number, haze: RGB, tint: RGB, light: number
  ): void {
    g.save();
    g.globalCompositeOperation = 'lighter';
    const grd = g.createRadialGradient(vpX, vpY + h * 0.06, 0, vpX, vpY + h * 0.06, Math.max(w, h) * 0.55);
    grd.addColorStop(0, css(mixRgb(haze, tint, 0.5), 0.16 * light));
    grd.addColorStop(0.4, css(mixRgb(haze, tint, 0.3), 0.06 * light));
    grd.addColorStop(1, css(haze, 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);

    // Suspended dust. Barely there, but it is the difference between an empty
    // room and a room with air in it.
    const rnd = mulberry32(this._seed ^ 0x77);
    g.fillStyle = css(tint, 0.16 * light);
    for (let i = 0; i < 90; i++) {
      const x = rnd() * w;
      const y = rnd() * h;
      const d = Math.hypot(x - vpX, y - vpY) / Math.max(w, h);
      if (d > 0.42) continue;
      const r = (1 - d / 0.42) * 1.6;
      g.globalAlpha = (1 - d / 0.42) * 0.5;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }
}
