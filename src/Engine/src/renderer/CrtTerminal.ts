/**
 * The observatory terminal.
 *
 * The product is not a scenic wallpaper with occasional oddities; it is a
 * mystery interface that happens to be looking at a landscape. This module is
 * the surface that carries the mystery: a CRT sitting in the world, running a
 * readout of the place, where the anomalies arrive as text.
 *
 * Design rules, in order:
 *
 *  1. Quiet by default. The terminal idles. It is a piece of equipment
 *     humming in the corner of the view, not a HUD competing for attention.
 *  2. Never break the fiction. It does not know it is wallpaper, does not use
 *     UI words like "anomaly", and never claims to be watching the user.
 *  3. Everything it says is deniable. A "signal" is a calibration ping. A
 *     "visitor" is a bird. The player is always able to decide they imagined
 *     it, which is the whole contract of the ARG.
 *
 * It is drawn as a composited layer on top of the landscape so it reads as a
 * physical object in the scene, lit by the same time of day, rather than as an
 * overlay pasted on top.
 */

import { css, mixRgb, mulberry32 } from '../render/noise.js';
import type { SkyGrade } from '../render/palette.js';

/** Phosphor colours. Deliberately not green: the default green terminal is the
 *  single most predictable choice available and it dates the piece instantly. */
const PHOSPHOR = { r: 126, g: 226, b: 168 };
const PHOSPHOR_WARN = { r: 214, g: 108, b: 96 };
const BEZEL_HI = { r: 96, g: 94, b: 88 };
const BEZEL_LO = { r: 34, g: 33, b: 31 };

/** The state the terminal reports about the world it is looking at. */
export interface TerminalState {
  worldName: string;
  worldCode: string;
  biome: string;
  /** Local wall-clock time as HH:MM:SS. */
  clock: string;
  /** Short weather word. */
  weather: string;
  /** Local temperature if the weather system produced one. */
  temperature?: string;
  /** Count of observations the player has made. */
  observations: number;
  /** Count of secrets recovered. */
  secrets: number;
  /** Whether the current world has an active anomaly. */
  anomalyActive: boolean;
  /** Name of the active anomaly, for the signal line. */
  anomalyName?: string | undefined;
  /** Uptime of the engine in seconds. */
  uptime: number;
}

/** One line queued to be typed out. */
interface Line {
  text: string;
  /** warn lines print in the alarm colour */
  warn?: boolean;
  /** speed multiplier; lower is slower and more deliberate */
  pace?: number;
}

export class CrtTerminal {
  private _ctx: CanvasRenderingContext2D;

  /** typewriter cursor position within the current line */
  private _revealed = 0;
  private _queue: Line[] = [];
  private _current: Line | null = null;
  private _holdUntil = 0;

  /** horizontal scan bar position, 0..1 */
  private _scan = 0;
  /** phosphor flicker phase */
  private _flicker = 0;
  /** boot progress, 0..1, plays once on first appearance */
  private _boot = 0;
  private _booted = false;

  /** last state we rendered, so we only rewrite the readout when it changes */
  private _lastSignature = '';

  private _lines: string[] = [];

  constructor(ctx: CanvasRenderingContext2D, seed: number) {
    this._ctx = ctx;
    const rnd = mulberry32(seed ^ 0x5c7e);
    this._scan = rnd();
  }

  /** Re-queue a line. Duplicate consecutive lines are ignored so the readout
   *  does not fill with noise when nothing has changed. */
  push(text: string, opts: { warn?: boolean; pace?: number; force?: boolean } = {}): void {
    if (!opts.force && text === this._lines[this._lines.length - 1]) return;
    this._lines.push(text);
    if (this._lines.length > 6) this._lines.shift();
    const line: Line = { text };
    if (opts.warn !== undefined) line.warn = opts.warn;
    if (opts.pace !== undefined) line.pace = opts.pace;
    this._queue.push(line);
  }

  /**
   * Draws the terminal. Returns nothing; all state is internal.
   *
   * @param w  viewport width
   * @param h  viewport height
   * @param grade current sky grade, so the bezel is lit by the same sky
   * @param state what the terminal has to report
   * @param dt   seconds since the last frame
   */
  render(w: number, h: number, grade: SkyGrade, state: TerminalState, dt: number): void {
    if (w < 420 || h < 260) return;

    const g = this._ctx;
    if (!this._booted) {
      this._booted = true;
      this._boot = 0;
    }
    this._boot = Math.min(1, this._boot + dt * 0.7);
    this._flicker += dt;
    this._scan = (this._scan + dt * 0.06) % 1;

    // Small and low. The landscape is the subject; the terminal is a piece of
    // equipment standing at the edge of it, not a second wallpaper competing
    // for the same space. It reads as a detail you notice, not a UI panel.
    const boxW = Math.min(w * 0.17, 230);
    const boxH = boxW * 0.7;
    // Sits low-left, in the ground region, where a real terminal would stand.
    const bx = w * 0.045;
    const by = h - boxH - h * 0.05;

    g.save();

    this._drawBezel(g, bx, by, boxW, boxH, grade);

    // Screen interior, inset past the bezel lip.
    const pad = boxW * 0.045;
    const sx = bx + pad;
    const sy = by + pad;
    const sw = boxW - pad * 2;
    const sh = boxH - pad * 2;

    g.save();
    g.beginPath();
    // Slight barrel: the screen is a curve, not a rectangle.
    g.moveTo(sx + sw * 0.03, sy);
    g.lineTo(sx + sw * 0.97, sy);
    g.quadraticCurveTo(sx + sw, sy + sh * 0.5, sx + sw * 0.97, sy + sh);
    g.lineTo(sx + sw * 0.03, sy + sh);
    g.quadraticCurveTo(sx, sy + sh * 0.5, sx + sw * 0.03, sy);
    g.closePath();
    g.clip();

    this._drawScreen(g, sx, sy, sw, sh, state, dt);
    this._drawScanlines(g, sx, sy, sw, sh);
    this._drawGlass(g, sx, sy, sw, sh, grade);

    g.restore();
    g.restore();
  }

  private _drawBezel(
    g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, grade: SkyGrade
  ): void {
    const lit = 0.25 + grade.ambient * 0.75;

    // Drop shadow onto the ground. A canvas blur filter here was measurably
    // one of the most expensive operations in the whole frame; a soft radial
    // gradient underneath the case is visually equivalent at this size and
    // costs a fraction of it.
    g.save();
    g.fillStyle = 'rgba(0,0,0,0.5)';
    for (let i = 3; i >= 1; i--) {
      g.globalAlpha = 0.16;
      g.filter = 'none';
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.beginPath();
      g.ellipse(
        x + w * 0.5, y + h * 1.02,
        w * (0.5 + i * 0.06), h * (0.06 + i * 0.04), 0, 0, Math.PI * 2
      );
      g.fill();
    }
    g.restore();

    // Case: a vertical plastic gradient, lit from the sky.
    const grd = g.createLinearGradient(x, y, x, y + h);
    grd.addColorStop(0, css(mixRgb(BEZEL_HI, grade.lightColor, 0.1 * lit)));
    grd.addColorStop(0.5, css(mixRgb(BEZEL_HI, BEZEL_LO, 0.55)));
    grd.addColorStop(1, css(mixRgb(BEZEL_LO, { r: 0, g: 0, b: 0 }, 0.4)));
    g.fillStyle = grd;
    this._roundRect(g, x, y, w, h, w * 0.035);
    g.fill();

    // Top lip highlight.
    g.strokeStyle = css(mixRgb(BEZEL_HI, { r: 255, g: 255, b: 255 }, 0.25 * lit), 0.5);
    g.lineWidth = Math.max(1, w * 0.004);
    this._roundRect(g, x, y, w, h, w * 0.035);
    g.stroke();

    // Inner well: the recess the tube sits in.
    const pad = w * 0.045;
    g.fillStyle = css(mixRgb(BEZEL_LO, { r: 0, g: 0, b: 0 }, 0.65));
    this._roundRect(g, x + pad * 0.6, y + pad * 0.6, w - pad * 1.2, h - pad * 1.2, w * 0.02);
    g.fill();
  }

  private _drawScreen(
    g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, state: TerminalState, dt: number
  ): void {
    // Tube phosphor: a dark green-black, never pure black. A real tube glows
    // faintly even when the text is off.
    g.fillStyle = 'rgb(6,18,15)';
    g.fillRect(x, y, w, h);

    // Soft phosphor bloom from the centre.
    const bloom = g.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, w * 0.75);
    bloom.addColorStop(0, 'rgba(40,90,70,0.28)');
    bloom.addColorStop(1, 'rgba(6,18,15,0)');
    g.fillStyle = bloom;
    g.fillRect(x, y, w, h);

    // Boot fade.
    if (this._boot < 1) {
      g.fillStyle = `rgba(4,10,9,${1 - this._boot})`;
      g.fillRect(x, y, w, h);
    }

    // Keep the readout current. Rewritten only when the signature changes, so
    // a still scene does not flicker text at 60fps.
    const sig = [
      state.worldCode, state.clock, state.weather, state.temperature ?? '',
      state.observations, state.secrets, state.anomalyActive ? state.anomalyName ?? '' : '',
      Math.floor(state.uptime / 30),
    ].join('|');
    if (sig !== this._lastSignature) {
      this._lastSignature = sig;
      this._syncReadout(state);
    }

    // Typewriter.
    this._advance(dt);

    const fs = Math.max(8, Math.round(h * 0.075));
    g.font = `${fs}px ui-monospace, "Cascadia Mono", Consolas, monospace`;
    g.textBaseline = 'top';

    const padX = w * 0.07;
    const padY = h * 0.09;
    const lineH = fs * 1.5;
    const maxRows = Math.floor((h - padY * 2) / lineH);

    // The readout is a stable block: every line is drawn every frame, and only
    // the single line that changed is re-typed. Re-typing the whole block on
    // every state change made the terminal flicker and often caught a blank
    // screen mid-reveal, which read as a broken prop rather than equipment.
    const shown: Array<{ text: string; warn?: boolean | undefined }> = [];
    for (const l of this._lines) {
      const isTyping = this._current && this._current.text === l;
      shown.push({
        text: isTyping ? l.slice(0, Math.floor(this._revealed)) : l,
        warn: l.startsWith('> !!'),
      });
    }
    // Clip to the rows that fit.
    while (shown.length > maxRows) shown.shift();

    // The cursor blinks on the current row regardless of typing state.
    const cursorVisible = Math.floor(this._flicker * 1.6) % 2 === 0;

    shown.forEach((row, i) => {
      const col = row.warn ? PHOSPHOR_WARN : PHOSPHOR;
      g.fillStyle = css(col, this._boot * 0.92);
      g.shadowColor = css(col, 0.7);
      g.shadowBlur = fs * 0.55;
      g.fillText(row.text, x + padX, y + padY + i * lineH);
      g.shadowBlur = 0;
    });

    // Cursor block.
    if (this._current && cursorVisible) {
      const idx = shown.length - 1;
      if (idx >= 0) {
        const text = shown[idx].text;
        const cw = g.measureText(text).width;
        g.fillStyle = css(this._current.warn ? PHOSPHOR_WARN : PHOSPHOR, this._boot * 0.8);
        g.fillRect(x + padX + cw + 1, y + padY + idx * lineH, fs * 0.55, fs * 1.05);
      }
    }
  }

  /**
   * Rebuilds the readout from the current world state.
   *
   * Only the lines that actually changed are queued for typing. On first
   * appearance the whole block types out, which is the boot sequence; after
   * that a single changing value re-types just its own line, so the terminal
   * feels alive without ever redrawing the whole screen.
   */
  private _syncReadout(state: TerminalState): void {
    const mins = Math.floor(state.uptime / 60);
    const hrs = Math.floor(mins / 60);
    const up = hrs > 0 ? `${hrs}h${String(mins % 60).padStart(2, '0')}` : `${mins}m`;

    const next: string[] = [
      `> ${state.worldCode.toUpperCase()} // LINKED`,
      `  ${state.clock}  ${state.weather}${state.temperature ? `  ${state.temperature}` : ''}`,
      `  SITE ${state.worldName.toUpperCase()}`,
      `  LOG ${state.observations} OBS / ${state.secrets} RECOVERED`,
      `  LINK ${up}  ::  NOMINAL`,
    ];

    if (state.anomalyActive) {
      next.push(`> !! ${(state.anomalyName ?? 'UNKNOWN').toUpperCase()}`);
    }

    const first = this._lines.length === 0;
    const changed: number[] = [];
    for (let i = 0; i < next.length; i++) {
      if (first || this._lines[i] !== next[i]) changed.push(i);
    }

    this._lines = next;

    if (first) {
      this._queue = next.map((text): Line => (text.startsWith('> !!') ? { text, warn: true } : { text }));
      this._current = null;
      this._revealed = 0;
      return;
    }

    // Re-type the most significant changed line only. The clock ticks every
    // second, so taking the last change keeps the terminal from thrashing.
    const idx = changed[changed.length - 1];
    if (idx !== undefined) {
      const text = next[idx];
      this._current = text.startsWith('> !!') ? { text, warn: true } : { text };
      this._revealed = 0;
      this._holdUntil = performance.now() + 260;
    }
  }

  /** Advances the typewriter one frame. */
  private _advance(dt: number): void {
    const now = performance.now();
    if (!this._current) {
      if (now < this._holdUntil) return;
      this._current = this._queue.shift() ?? null;
      if (!this._current) return;
      this._revealed = 0;
    }
    const cps = 78 * (this._current.pace ?? 1);
    this._revealed += (cps * dt) / 1000;
    if (this._revealed >= this._current.text.length) {
      this._revealed = this._current.text.length;
      this._holdUntil = now + 320 / (this._current.pace ?? 1);
      this._current = null;
    }
  }

  private _drawScanlines(
    g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number
  ): void {
    g.save();
    g.globalAlpha = 0.16;
    g.fillStyle = '#000';
    const step = Math.max(2, Math.round(h * 0.012));
    for (let sy = 0; sy < h; sy += step) {
      g.fillRect(x, y + sy, w, Math.max(1, step * 0.5));
    }

    // Slow bright scan bar travelling down the tube.
    const barY = y + this._scan * h;
    const barH = h * 0.06;
    const bar = g.createLinearGradient(0, barY - barH, 0, barY + barH);
    bar.addColorStop(0, 'rgba(160,255,200,0)');
    bar.addColorStop(0.5, 'rgba(160,255,200,0.09)');
    bar.addColorStop(1, 'rgba(160,255,200,0)');
    g.globalAlpha = 1;
    g.fillStyle = bar;
    g.fillRect(x, barY - barH, w, barH * 2);
    g.restore();
  }

  private _drawGlass(
    g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, grade: SkyGrade
  ): void {
    // Specular sheen across the glass, tied to the sky so it stays coherent.
    g.save();
    g.globalCompositeOperation = 'lighter';
    const sheen = g.createLinearGradient(x, y, x + w * 0.7, y + h);
    sheen.addColorStop(0, css(mixRgb(grade.lightColor, { r: 255, g: 255, b: 255 }, 0.5), 0.05 + grade.ambient * 0.05));
    sheen.addColorStop(0.4, 'rgba(255,255,255,0)');
    g.fillStyle = sheen;
    g.fillRect(x, y, w, h);
    g.restore();
  }

  private _roundRect(
    g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number
  ): void {
    g.beginPath();
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y);
    g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r);
    g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r);
    g.quadraticCurveTo(x, y, x + r, y);
    g.closePath();
  }
}
