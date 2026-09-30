/**
 * The uncanny and the surreal.
 *
 * These two are the difference between a wallpaper and something that stays
 * with you, and they are opposites that share a discipline: both work by
 * putting one thing in the frame that cannot be right, and then refusing to
 * confirm it.
 *
 * UNCANNY is the near-miss. Everything stays correct and one detail is off by
 * a hair. The classic sources, in the order they actually work on a viewer:
 *
 *  - Cloned repetition. Identical elements repeated with a correct rhythm. A
 *    forest of exactly equal trees is not a forest, it is a stencil. Real
 *    uncanny imagery leans on this: the *slightly* too regular is the tell.
 *  - Almost-legible text. Words that are not words, at a distance, where you
 *    are not quite reading them. The moment you focus, they resolve into
 *    nothing, and the doubt is the point.
 *  - The wrong count. Six windows, then seven, then six again. The eye is very
 *    good at counting and does it without being asked.
 *  - A light that is right until it is not. Same brightness, same colour, same
 *    rhythm, and then one interval is longer. Nothing is out of place; the
 *    sequence simply has an extra beat.
 *  - Pareidolia. A face-like arrangement in a window grid or a rock formation.
 *    Never drawn as a face. Found as one, which is far worse.
 *
 * SURREAL is the impossible. One violation of physical possibility per event,
 * never two, because two is a joke and one is a dream. The forms that work:
 * scale inversion, wrong shadows, impossible reflections, an object where it
 * cannot be. The rule is that the surreal event must be *plausible in the
 * frame* — it should look like a mistake in the renderer, not like an effect.
 *
 * Both systems share one hard rule: NEVER show a creature. Presence is implied
 * by what moved, what changed, or what is almost there. The moment anything is
 * drawn, the piece becomes a haunted house and stops being uncanny.
 */

import { css, mixRgb, mulberry32 } from '../render/noise.js';
import type { SkyGrade } from '../render/palette.js';
import type { WorldDefinition } from '../worlds/types.js';

/** One impossible or almost-wrong thing happening right now. */
export interface SurrealEvent {
  kind: 'scale' | 'shadow' | 'reflection' | 'displaced' | 'parity';
  /** 0..1 through the event. */
  t: number;
  seed: number;
  /** Horizontal anchor, 0..1. */
  x: number;
  /** How far off it is, 0..1. Small values read as a near-miss. */
  amount: number;
}

export class UncannyLayer {
  private _seed: number;
  private _t = 0;

  /** Count of identical elements along a row, e.g. windows in a block. */
  private _parityBase = 6;
  /** Which element is the odd one out, -1 while the count is correct. */
  private _oddAt = -1;

  /** Text that is nearly legible, revealed by staring. */
  private _glyphs: Array<{ x: number; y: number; ch: string; a: number }> = [];
  /** A light sequence with one interval that is wrong. */
  private _beat = 0;
  private _beatPeriod = 4.2;
  /** The one long interval. */
  private _longInterval = false;
  private _longIntervalAt = 2;

  private _pareidolia: Array<{ x: number; y: number; s: number; seed: number }> = [];
  private _event: SurrealEvent | null = null;
  private _eventUntil = 0;

  constructor(world: WorldDefinition) {
    this._seed = world.terrain.seed;
    const rnd = mulberry32(this._seed ^ 0x77e0);

    // A building with an odd number of identical bays. Six is the most
    // obviously countable number, which is exactly why it works.
    this._parityBase = 5 + Math.floor(rnd() * 4);
    this._oddAt = Math.floor(rnd() * this._parityBase);

    // The light beats. One interval stretched by a fraction, so the rhythm is
    // intact but your body notices before your mind does.
    this._beatPeriod = 3.6 + rnd() * 2.4;
    this._longIntervalAt = 1 + Math.floor(rnd() * 2);

    // Almost-legible marks, scattered where something could have been written.
    const n = 3 + Math.floor(rnd() * 5);
    for (let i = 0; i < n; i++) {
      this._glyphs.push({
        x: 0.08 + rnd() * 0.84,
        y: 0.42 + rnd() * 0.4,
        ch: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789?#|/\\<>+*'[Math.floor(rnd() * 40)],
        a: 0.1 + rnd() * 0.16,
      });
    }

    // Pareidolia: arrangements that are *almost* a face. Never drawn as one.
    const pf = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < pf; i++) {
      this._pareidolia.push({
        x: 0.15 + rnd() * 0.7,
        y: 0.5 + rnd() * 0.3,
        s: 0.02 + rnd() * 0.03,
        seed: Math.floor(rnd() * 100000),
      });
    }
  }

  /** Starts a surreal event. One at a time, because two is a joke. */
  triggerSurreal(rnd: () => number = Math.random): void {
    const now = performance.now();
    if (now < this._eventUntil) return;
    const kinds: SurrealEvent['kind'][] = ['scale', 'shadow', 'reflection', 'displaced', 'parity'];
    this._event = {
      kind: kinds[Math.floor(rnd() * kinds.length)],
      t: 0,
      seed: Math.floor(rnd() * 100000),
      x: 0.2 + rnd() * 0.6,
      // Deliberately small. A large violation reads as a bug report; a small
      // one reads as something you are not sure you saw.
      amount: 0.03 + rnd() * 0.05,
    };
    this._eventUntil = now + 14000;
  }

  hasSurreal(): boolean {
    return this._event !== null;
  }

  update(dt: number): void {
    this._t += dt;
    if (this._event) {
      this._event.t = Math.min(1, this._event.t + dt / 14);
    }

    // The light beat, with one interval stretched.
    const cycle = this._t / this._beatPeriod;
    const step = Math.floor(cycle);
    this._longInterval = step % 3 === this._longIntervalAt;
    this._beat = (cycle % 1);
  }

  /**
   * Draws the near-miss layer. Everything here is drawn at low opacity and
   * small size: if the viewer notices it immediately, it has failed, because
   * the effect only works while it is being looked for.
   */
  render(
    g: CanvasRenderingContext2D, w: number, h: number, world: WorldDefinition,
    grade: SkyGrade, detail: number
  ): void {
    this._drawParity(g, w, h, world, grade, detail);
    this._drawGlyphs(g, w, h, detail);
    this._drawPareidolia(g, w, h, detail, world.terrain.groundY ?? 0.7);
    this._drawBeat(g, w, h, grade, detail);
    this._drawSurreal(g, w, h, world, grade, detail);
  }

  /**
   * A row of identical elements where the count is very slightly wrong. Drawn
   * as light sources on the ground line, because a row of lights is the most
   * countable thing in any landscape.
   */
  private _drawParity(
    g: CanvasRenderingContext2D, w: number, h: number, world: WorldDefinition,
    grade: SkyGrade, detail: number
  ): void {
    const groundY = h * (world.terrain.groundY ?? 0.7);
    const n = this._parityBase;
    const lit = grade.ambient < 0.6;

    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      // The odd one is at the same height, the same size, the same colour.
      // Only the spacing of one gap differs, and by very little.
      const jitter = i === this._oddAt ? 0.012 : 0;
      const t = (i + 0.5) / n + jitter;
      const x = w * (0.08 + t * 0.84);
      const y = groundY - h * 0.012 - (i % 2) * h * 0.004;
      const r = Math.max(1.2, h * 0.006);
      const a = (lit ? 0.3 : 0.1) * detail * (0.7 + 0.3 * Math.sin(this._t * 0.6 + i));
      if (a < 0.02) continue;
      const grd = g.createRadialGradient(x, y, 0, x, y, r * 4);
      grd.addColorStop(0, `rgba(255,232,190,${a})`);
      grd.addColorStop(1, 'rgba(255,232,190,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, r * 4, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  /**
   * Almost-legible text. Each glyph is a real character from a plausible set,
   * placed at reading size, at an opacity that only resolves if you look. The
   * moment any of them form a word, the effect has landed and they should
   * therefore not.
   */
  private _drawGlyphs(g: CanvasRenderingContext2D, w: number, h: number, detail: number, limit = 1): void {
    const fs = Math.max(6, Math.round(h * 0.014));
    g.save();
    g.font = `${fs}px 'Plex Mono', Consolas, monospace`;
    g.textBaseline = 'middle';
    // Only the first few marks are drawn. Drawing all of them at once turned the
    // layer into visible stray text, which reads as a debugging overlay rather
    // than as something you are not quite sure you saw.
    let drawn = 0;
    for (const gl of this._glyphs) {
      if (drawn >= limit) break;
      // Very low alpha, and it breathes. A steady mark reads as graffiti; a
      // mark that varies in visibility reads as something you cannot quite see.
      const a = gl.a * 0.34 * detail * (0.4 + 0.6 * Math.abs(Math.sin(this._t * 0.4 + gl.x * 9)));
      if (a < 0.008) continue;
      g.fillStyle = `rgba(210,214,206,${a})`;
      g.fillText(gl.ch, w * gl.x, h * gl.y);
      drawn++;
    }
    g.restore();
  }

  /**
   * Pareidolia. Two dark marks and a lighter surround, positioned so that a
   * face is *available* without ever being present. Drawn over ground and
   * structure faces where the eye goes when it is looking for people.
   */
  private _drawPareidolia(
    g: CanvasRenderingContext2D, w: number, h: number, detail: number, groundYFrac: number
  ): void {
    for (const p of this._pareidolia) {
      // Only below the horizon. Pareidolia belongs on ground, rock and
      // structure, where the eye actually goes when it is looking for people;
      // floating two dark ellipses in open sky read as smudges on the lens.
      const yFrac = h * p.y;
      if (yFrac < h * groundYFrac - h * 0.04) continue;

      const rnd = mulberry32(p.seed);
      const s = p.s * w;
      const a = 0.13 * detail * (0.5 + 0.5 * Math.sin(this._t * 0.23 + p.seed));
      if (a < 0.02) continue;
      g.save();
      g.globalAlpha = a;
      // Two marks where eyes would be, and a darker mass under them. Nothing
      // that reads as a face on its own.
      g.fillStyle = 'rgba(20,20,26,1)';
      for (const side of [-1, 1]) {
        g.beginPath();
        g.ellipse(
          w * p.x + side * s * 0.42 + (rnd() - 0.5) * s * 0.2,
          yFrac - s * 0.12,
          s * 0.3, s * 0.19, (rnd() - 0.5) * 0.5, 0, Math.PI * 2
        );
        g.fill();
      }
      g.beginPath();
      g.ellipse(w * p.x, yFrac + s * 0.7, s * 0.8, s * 0.44, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }

  /**
   * The light sequence. The rhythm is perfectly regular, and one interval in
   * every three is stretched by about eight percent. Nothing is out of place.
   * Your sense of timing notices, and then you decide you imagined it.
   */
  private _drawBeat(
    g: CanvasRenderingContext2D, w: number, h: number, grade: SkyGrade, detail: number
  ): void {
    const groundY = h * 0.86;
    const a = grade.ambient < 0.7 ? 0.3 * detail : 0.08 * detail;
    if (a < 0.02) return;
    // On the long interval the light is dimmer for longer, which is the whole
    // trick: a missing heartbeat, not a strange one.
    const swell = this._longInterval ? 0.45 : 1;
    const pulse = Math.pow(1 - this._beat, 3);

    g.save();
    g.globalCompositeOperation = 'lighter';
    const grd = g.createLinearGradient(0, groundY - h * 0.2, 0, groundY);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, `rgba(255,228,180,${a * pulse * swell})`);
    g.fillStyle = grd;
    g.fillRect(0, groundY - h * 0.2, w, h * 0.2);
    g.restore();
  }

  /**
   * The one impossible thing. Drawn subtly and briefly, and each form is a
   * physical impossibility rather than a special effect.
   */
  private _drawSurreal(
    g: CanvasRenderingContext2D, w: number, h: number, world: WorldDefinition,
    grade: SkyGrade, detail: number
  ): void {
    const e = this._event;
    if (!e || e.t >= 1) return;
    // Fade in and out so it never pops.
    const env = Math.sin(e.t * Math.PI);
    const groundY = h * (world.terrain.groundY ?? 0.7);
    const cx = w * e.x;

    g.save();
    g.globalAlpha = env * detail;

    switch (e.kind) {
      case 'scale': {
        // One structure at the wrong scale, correct in every other respect.
        const s = 1 + e.amount * 6 * env;
        const bw = w * 0.05 * s;
        const bh = (groundY - h * 0.2) * s;
        g.fillStyle = 'rgba(18,20,26,0.85)';
        g.fillRect(cx - bw / 2, groundY - bh, bw, bh);
        break;
      }
      case 'shadow': {
        // A shadow that does not belong to anything above it.
        const sw = w * (0.08 + e.amount * 2);
        g.fillStyle = 'rgba(0,0,0,0.42)';
        g.beginPath();
        g.ellipse(cx, groundY + h * 0.02, sw, h * 0.012 * (1 + e.amount * 8), 0.2, 0, Math.PI * 2);
        g.fill();
        break;
      }
      case 'reflection': {
        // The sky reflected in the ground, at the wrong depth.
        const band = mixRgb(grade.skyTop, grade.skyHorizon, 0.4);
        g.fillStyle = css(band, 0.3 * env);
        g.fillRect(0, groundY, w, h * e.amount * 1.4);
        break;
      }
      case 'displaced': {
        // A horizon that steps. One part of the ground line is a little
        // higher than the rest, as though the world has a seam.
        const step = h * e.amount * env;
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.fillRect(cx - w * 0.02, groundY - step, w * 0.04, h * 0.01);
        break;
      }
      case 'parity': {
        // The near-miss, promoted. One element of the row is the wrong size.
        const r = Math.max(1, h * 0.007 * (1 + e.amount * 10));
        g.fillStyle = 'rgba(255,236,200,0.5)';
        g.beginPath();
        g.arc(cx, groundY - h * 0.015, r, 0, Math.PI * 2);
        g.fill();
        break;
      }
    }

    g.restore();
  }

  dispose(): void {
    this._event = null;
  }
}
