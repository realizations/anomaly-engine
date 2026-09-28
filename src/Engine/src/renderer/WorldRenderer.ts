import { RGB, mixRgb, css, shade, mulberry32, ridged1D, fbm1D } from '../render/noise.js';
import { SkyGrade, gradeForHour, sunPosition, moonPosition, moonPhase } from '../render/palette.js';

export interface WeatherState {
  condition: 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'fog';
  intensity: number;
  windSpeed: number;
  windDirection: number;
}

export type AnomalyKind =
  | 'second-moon'
  | 'red-moon'
  | 'forest-watcher'
  | 'observatory-signal'
  | 'meteor'
  | 'lights-out';

export interface AnomalyVisual {
  type: AnomalyKind;
  active: boolean;
  opacity: number;
  startedAt: number;
  duration: number;
}

const TERRAIN_FAR: RGB = { r: 96, g: 108, b: 136 };
const TERRAIN_MID: RGB = { r: 62, g: 76, b: 96 };
const TERRAIN_NEAR: RGB = { r: 40, g: 52, b: 64 };
const FOREST_FAR: RGB = { r: 34, g: 46, b: 52 };
const FOREST_MID: RGB = { r: 20, g: 30, b: 34 };
const FOREST_NEAR: RGB = { r: 9, g: 15, b: 17 };

export class WorldRenderer {
  private _canvas: HTMLCanvasElement;
  private _ctx: CanvasRenderingContext2D;
  private _w = 0;
  private _h = 0;
  private _dpr = 1;
  private _seed = 1337;

  private _grain: HTMLCanvasElement | null = null;
  private _stars: Array<{ x: number; y: number; mag: number; tw: number; hue: number }> = [];
  private _cloudBands: Array<{ y: number; scale: number; speed: number; alpha: number; thickness: number }> = [];
  private _rain: Array<{ x: number; y: number; len: number; sp: number }> = [];
  private _snow: Array<{ x: number; y: number; r: number; ph: number; sp: number }> = [];
  private _motes: Array<{ x: number; y: number; ph: number; sp: number }> = [];
  private _smoke: Array<{ t: number; sp: number }> = [];
  private _poles: Array<{ x: number; h: number }> = [];
  private _treesFar: Array<{ x: number; h: number; s: number }> = [];
  private _treesMid: Array<{ x: number; h: number; s: number }> = [];
  private _treesNear: Array<{ x: number; h: number; s: number }> = [];

  private _weather: WeatherState = { condition: 'clear', intensity: 0, windSpeed: 0.2, windDirection: 0.2 };
  private _anomalies: AnomalyVisual[] = [];
  private _meteor: { x: number; y: number; vx: number; vy: number; life: number } | null = null;
  private _bolt: number = 0;
  private _boltSeed: number = 0;
  private _t = 0;
  private _last = 0;
  private _mouse = { x: -1, y: -1, px: 0, py: 0 };
  private _grade: SkyGrade = gradeForHour(12);

  constructor(canvas: HTMLCanvasElement) {
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d', { alpha: false })!;
    this._buildGrain();
    this._buildFeatures();
    this._bindPointer();
  }

  private _buildGrain(): void {
    const size = 180;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d')!;
    const img = g.createImageData(size, size);
    const rnd = mulberry32(9187);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 128 + (rnd() - 0.5) * 92;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this._grain = c;
  }

  private _buildFeatures(): void {
    const rnd = mulberry32(this._seed);

    for (let i = 0; i < 420; i++) {
      this._stars.push({
        x: rnd(),
        y: Math.pow(rnd(), 1.35) * 0.72,
        mag: Math.pow(rnd(), 2.6),
        tw: rnd() * Math.PI * 2,
        hue: rnd(),
      });
    }

    for (let i = 0; i < 7; i++) {
      this._cloudBands.push({
        y: 0.06 + rnd() * 0.3,
        scale: 0.7 + rnd() * 1.5,
        speed: 0.0016 + rnd() * 0.0042,
        alpha: 0.16 + rnd() * 0.3,
        thickness: 0.018 + rnd() * 0.05,
      });
    }

    for (let i = 0; i < 260; i++) {
      this._rain.push({ x: rnd(), y: rnd(), len: 0.02 + rnd() * 0.05, sp: 1.1 + rnd() * 1.1 });
    }
    for (let i = 0; i < 220; i++) {
      this._snow.push({ x: rnd(), y: rnd(), r: 0.7 + rnd() * 2.1, ph: rnd() * 6.28, sp: 0.1 + rnd() * 0.35 });
    }
    for (let i = 0; i < 26; i++) {
      this._motes.push({ x: rnd(), y: 0.54 + rnd() * 0.3, ph: rnd() * 6.28, sp: 0.3 + rnd() * 0.8 });
    }
    for (let i = 0; i < 14; i++) {
      this._smoke.push({ t: i / 14, sp: 0.14 + rnd() * 0.1 });
    }

    for (let i = 0; i < 5; i++) {
      this._poles.push({ x: 0.06 + i * 0.115 + (rnd() - 0.5) * 0.02, h: 0.1 + rnd() * 0.022 });
    }

    this._treesFar = this._scatterForest(3101, 118, 0.028, 0.05, 0.09, 0.028);
    this._treesMid = this._scatterForest(7717, 66, 0.055, 0.105, 0.16, 0.02);
    this._treesNear = this._scatterForest(4409, 15, 0.16, 0.3, 0.34, 0.05);
  }

  private _scatterForest(
    seed: number, count: number, minH: number, maxH: number, cluster: number, jitter: number
  ): Array<{ x: number; h: number; s: number }> {
    const rnd = mulberry32(seed);
    const out: Array<{ x: number; h: number; s: number }> = [];
    const clusters: number[] = [];
    const clusterCount = Math.max(3, Math.round(count / 9));

    for (let c = 0; c < clusterCount; c++) {
      clusters.push(rnd());
    }

    let placed = 0;
    let guard = 0;
    while (placed < count && guard < count * 40) {
      guard++;
      const anchor = clusters[Math.floor(rnd() * clusters.length)];
      const x = Math.min(1.02, Math.max(-0.02, anchor + (rnd() - 0.5) * cluster));
      if (out.some((t) => Math.abs(t.x - x) < jitter * 0.4)) continue;

      const sizeRoll = rnd();
      const h = minH + (maxH - minH) * Math.pow(sizeRoll, 1.7);
      out.push({ x, h, s: Math.floor(rnd() * 1e6) });
      placed++;
    }

    out.sort((a, b) => a.x - b.x);
    return out;
  }

  private _bindPointer(): void {
    this._canvas.addEventListener('mousemove', (e) => {
      const r = this._canvas.getBoundingClientRect();
      this._mouse.x = (e.clientX - r.left) / r.width;
      this._mouse.y = (e.clientY - r.top) / r.height;
    });
    this._canvas.addEventListener('mouseleave', () => {
      this._mouse.x = -1;
      this._mouse.y = -1;
    });
  }

  resize(w: number, h: number): void {
    this._dpr = Math.min(window.devicePixelRatio || 1, 2);
    this._w = w;
    this._h = h;
    this._canvas.width = Math.round(w * this._dpr);
    this._canvas.height = Math.round(h * this._dpr);
  }

  setWeather(w: WeatherState): void {
    this._weather = w;
  }

  addAnomaly(a: AnomalyVisual): void {
    this._anomalies = this._anomalies.filter((x) => x.type !== a.type);
    this._anomalies.push(a);
  }

  removeAnomaly(type: AnomalyKind): void {
    this._anomalies = this._anomalies.filter((a) => a.type !== type);
  }

  getActiveAnomaly(type: AnomalyKind): AnomalyVisual | undefined {
    return this._anomalies.find((a) => a.type === type && a.active);
  }

  triggerShootingStar(): void {
    this._meteor = {
      x: 0.15 + Math.random() * 0.5,
      y: 0.04 + Math.random() * 0.16,
      vx: (Math.random() > 0.5 ? 1 : -1) * (0.32 + Math.random() * 0.3),
      vy: 0.1 + Math.random() * 0.14,
      life: 1,
    };
  }

  triggerLightning(): void {
    this._bolt = 1;
    this._boltSeed = Math.random() * 1000;
  }

  render(date: Date): void {
    const now = performance.now();
    const dt = this._last === 0 ? 16.7 : Math.min(50, now - this._last);
    this._last = now;
    this._t += dt / 1000;

    const g = this._ctx;
    g.save();
    g.scale(this._dpr, this._dpr);

    const hour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
    const grade = gradeForHour(hour);
    this._grade = grade;

    this._mouse.px += (this._mouse.x - 0.5 - this._mouse.px) * 0.045;
    this._mouse.py += (this._mouse.y - 0.5 - this._mouse.py) * 0.045;

    this._pruneAnomalies();

    this._drawSky(grade);
    this._drawStars(grade);
    this._drawSun(grade, hour);
    this._drawMoon(grade, hour, date);
    this._drawClouds(grade);
    this._drawRidges(grade);
    this._drawHazeBands(grade);
    this._drawForestFar();
    this._drawGround(grade);
    this._drawPolesAndWires(grade);
    this._drawObservatory(grade);
    this._drawRadioTower(grade);
    this._drawForestMid();
    this._drawCabin(grade);
    this._drawFog(grade);
    this._drawForestNear();
    this._drawMotes(grade);
    this._drawPrecipitation(dt);
    this._drawMeteor();
    this._drawBolt();
    this._drawAnomalyOverlays();
    this._drawGrade(grade);
    this._drawVignette();
    this._drawGrain();

    g.restore();
  }

  private _pruneAnomalies(): void {
    const now = performance.now();
    this._anomalies = this._anomalies.filter((a) => now - a.startedAt < a.duration * 1000);
  }

  private _anom(type: AnomalyKind): number {
    const a = this._anomalies.find((x) => x.type === type && x.active);
    if (!a) return 0;
    const t = (performance.now() - a.startedAt) / (a.duration * 1000);
    const fade = Math.min(1, t * 6) * Math.min(1, (1 - t) * 6);
    return a.opacity * Math.max(0, fade);
  }

  private _drawSky(grade: SkyGrade): void {
    const g = this._ctx;
    const grad = g.createLinearGradient(0, 0, 0, this._h);
    grad.addColorStop(0, css(grade.skyTop));
    grad.addColorStop(0.52, css(mixRgb(grade.skyTop, grade.skyHorizon, 0.55)));
    grad.addColorStop(0.78, css(grade.skyHorizon));
    grad.addColorStop(1, css(shade(grade.skyHorizon, -0.22)));
    g.fillStyle = grad;
    g.fillRect(0, 0, this._w, this._h);
  }

  private _drawStars(grade: SkyGrade): void {
    if (grade.starAlpha <= 0.01) return;
    const g = this._ctx;
    const dim = this._weather.condition === 'cloudy' || this._weather.condition === 'rain' || this._weather.condition === 'storm'
      ? 0.25
      : 1;
    const a = grade.starAlpha * dim;
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const s of this._stars) {
      const px = s.x * this._w + this._mouse.px * 5;
      const py = s.y * this._h + this._mouse.py * 3;
      const tw = 0.62 + 0.38 * Math.sin(this._t * 1.7 + s.tw);
      const alpha = a * (0.16 + s.mag * 0.84) * tw;
      if (alpha < 0.02) continue;
      const r = 0.35 + s.mag * 1.7;
      const tint = s.hue > 0.86 ? { r: 200, g: 214, b: 255 } : s.hue < 0.12 ? { r: 255, g: 224, b: 198 } : { r: 255, g: 255, b: 255 };
      const grd = g.createRadialGradient(px, py, 0, px, py, r * 3.4);
      grd.addColorStop(0, css(tint, alpha));
      grd.addColorStop(1, css(tint, 0));
      g.fillStyle = grd;
      g.beginPath();
      g.arc(px, py, r * 3.4, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  private _drawSun(grade: SkyGrade, hour: number): void {
    if (grade.sunAlpha <= 0.02) return;
    const g = this._ctx;
    const p = sunPosition(hour, this._w, this._h);
    if (!p.visible) return;

    g.save();
    g.globalCompositeOperation = 'lighter';

    const rays = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, this._h * 0.95);
    rays.addColorStop(0, css(grade.lightColor, 0.3 * grade.sunAlpha));
    rays.addColorStop(0.25, css(grade.lightColor, 0.09 * grade.sunAlpha));
    rays.addColorStop(1, css(grade.lightColor, 0));
    g.fillStyle = rays;
    g.fillRect(0, 0, this._w, this._h);

    const core = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, 46);
    core.addColorStop(0, css(shade(grade.lightColor, 0.5), 0.95 * grade.sunAlpha));
    core.addColorStop(0.22, css(grade.lightColor, 0.55 * grade.sunAlpha));
    core.addColorStop(1, css(grade.lightColor, 0));
    g.fillStyle = core;
    g.beginPath();
    g.arc(p.x, p.y, 46, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  private _drawMoon(grade: SkyGrade, hour: number, date: Date): void {
    if (grade.moonAlpha <= 0.02) return;
    const g = this._ctx;
    const p = moonPosition(hour, this._w, this._h);
    if (!p.visible) return;

    const red = this._anom('red-moon');
    const body = red > 0
      ? mixRgb({ r: 236, g: 226, b: 206 }, { r: 196, g: 44, b: 34 }, red)
      : { r: 232, g: 232, b: 226 };
    const r = 25;
    const alpha = grade.moonAlpha;

    g.save();
    g.globalCompositeOperation = 'lighter';
    const halo = g.createRadialGradient(p.x, p.y, r * 0.6, p.x, p.y, r * 11);
    const haloA = (0.16 + red * 0.3) * alpha;
    halo.addColorStop(0, css(body, haloA));
    halo.addColorStop(0.35, css(body, haloA * 0.24));
    halo.addColorStop(1, css(body, 0));
    g.fillStyle = halo;
    g.beginPath();
    g.arc(p.x, p.y, r * 11, 0, Math.PI * 2);
    g.fill();
    g.restore();

    g.save();
    g.beginPath();
    g.arc(p.x, p.y, r, 0, Math.PI * 2);
    g.clip();
    const surf = g.createRadialGradient(p.x - r * 0.3, p.y - r * 0.35, 0, p.x, p.y, r);
    surf.addColorStop(0, css(shade(body, 0.2), alpha));
    surf.addColorStop(1, css(shade(body, -0.16), alpha));
    g.fillStyle = surf;
    g.fillRect(p.x - r, p.y - r, r * 2, r * 2);

    const ph = moonPhase(date);
    const lit = Math.cos(ph * Math.PI * 2);
    if (lit < 0.985) {
      const off = lit * r * 1.12;
      g.globalCompositeOperation = 'destination-out';
      g.beginPath();
      g.ellipse(p.x + off, p.y, r * 1.06, r * 1.02, 0, 0, Math.PI * 2);
      g.fill();
    }

    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(0,0,0,0.1)';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * 6.28 + ph * 3;
      g.beginPath();
      g.ellipse(p.x + Math.cos(a) * r * 0.42, p.y + Math.sin(a) * r * 0.42, r * 0.24, r * 0.17, a, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();

    const second = this._anom('second-moon');
    if (second > 0) {
      const sx = Math.max(this._w * 0.09, Math.min(this._w * 0.9, p.x - this._w * 0.3));
      const sy = Math.max(this._h * 0.08, p.y + this._h * 0.11);
      g.save();
      g.globalCompositeOperation = 'lighter';
      const h2 = g.createRadialGradient(sx, sy, 0, sx, sy, r * 9);
      h2.addColorStop(0, css({ r: 226, g: 230, b: 255 }, 0.38 * second));
      h2.addColorStop(0.3, css({ r: 226, g: 230, b: 255 }, 0.1 * second));
      h2.addColorStop(1, css({ r: 226, g: 230, b: 255 }, 0));
      g.fillStyle = h2;
      g.beginPath();
      g.arc(sx, sy, r * 9, 0, Math.PI * 2);
      g.fill();

      g.fillStyle = css({ r: 236, g: 238, b: 250 }, 0.9 * second);
      g.beginPath();
      g.arc(sx, sy, r * 0.46, 0, Math.PI * 2);
      g.fill();

      g.fillStyle = css({ r: 196, g: 200, b: 216 }, 0.4 * second);
      g.beginPath();
      g.arc(sx - r * 0.14, sy - r * 0.1, r * 0.12, 0, Math.PI * 2);
      g.arc(sx + r * 0.16, sy + r * 0.12, r * 0.09, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }

  private _drawClouds(grade: SkyGrade): void {
    const overcast =
      this._weather.condition === 'storm' ? 0.86 :
      this._weather.condition === 'rain' ? 0.66 :
      this._weather.condition === 'cloudy' ? 0.5 :
      this._weather.condition === 'snow' ? 0.6 : 0.22;

    const g = this._ctx;
    g.save();
    for (const band of this._cloudBands) {
      const off = (this._t * band.speed * (1 + this._weather.windSpeed * 2.2)) % 1.6;
      const y = band.y * this._h + this._mouse.py * 4;
      const hgt = Math.max(6, band.thickness * this._h);
      const baseAlpha = band.alpha * overcast;

      for (let pass = 0; pass < 2; pass++) {
        const ph = pass * 0.5;
        for (let i = -1; i < 4; i++) {
          const cx = ((i / 3 + off + ph) % 1.4 - 0.2) * this._w;
          const n = fbm1D(i * 3.7 + off * 12 + band.scale * 10, Math.floor(band.scale * 1000), 4);
          const w = this._w * (0.2 + n * 0.26) * band.scale;
          const hh = hgt * (0.6 + n * 0.7);
          const lit = pass === 0 ? 0.1 : -0.14;
          const col = mixRgb(grade.haze, grade.lightColor, grade.ambient * 0.35 + 0.1);
          const grd = g.createRadialGradient(cx, y, 0, cx, y, w * 0.5);
          grd.addColorStop(0, css(shade(col, lit), baseAlpha * (pass === 0 ? 0.55 : 1)));
          grd.addColorStop(0.55, css(col, baseAlpha * (pass === 0 ? 0.3 : 0.5)));
          grd.addColorStop(1, css(col, 0));
          g.save();
          g.translate(cx, y);
          g.scale(1, hh / (w * 0.5));
          g.fillStyle = grd;
          g.beginPath();
          g.arc(0, 0, w * 0.5, 0, Math.PI * 2);
          g.fill();
          g.restore();
        }
      }
    }
    g.restore();
  }

  private _drawRidges(grade: SkyGrade): void {
    const g = this._ctx;
    const layers: Array<{ base: RGB; depth: number; amp: number; baseY: number; freq: number; seed: number; oct: number }> = [
      { base: TERRAIN_FAR, depth: 0.76, amp: 0.215, baseY: 0.665, freq: 0.0019, seed: 1201, oct: 5 },
      { base: TERRAIN_MID, depth: 0.52, amp: 0.15, baseY: 0.688, freq: 0.0033, seed: 3307, oct: 5 },
      { base: TERRAIN_NEAR, depth: 0.28, amp: 0.085, baseY: 0.712, freq: 0.0056, seed: 5501, oct: 6 },
    ];

    for (const L of layers) {
      const col = mixRgb(mixRgb(L.base, { r: 0, g: 0, b: 0 }, (1 - grade.ambient) * 0.55), grade.haze, L.depth);
      const step = 4;
      g.beginPath();
      g.moveTo(0, this._h);
      for (let px = 0; px <= this._w; px += step) {
        const r = ridged1D(px * L.freq, L.seed, L.oct);
        const r2 = fbm1D(px * L.freq * 2.6, L.seed + 17, 3) * 0.28;
        const y = L.baseY * this._h - (r * 0.78 + r2) * L.amp * this._h;
        g.lineTo(px, y);
      }
      g.lineTo(this._w, this._h);
      g.closePath();

      const grd = g.createLinearGradient(0, L.baseY * this._h - L.amp * this._h, 0, this._h);
      grd.addColorStop(0, css(shade(col, 0.06)));
      grd.addColorStop(1, css(shade(col, -0.3)));
      g.fillStyle = grd;
      g.fill();

      const crest = g.createLinearGradient(0, L.baseY * this._h - L.amp * this._h, 0, L.baseY * this._h + 0.02 * this._h);
      crest.addColorStop(0, css(grade.lightColor, grade.ambient * 0.2 * (1 - L.depth * 0.5)));
      crest.addColorStop(1, css(grade.lightColor, 0));
      g.fillStyle = crest;
      g.fill();
    }
  }

  private _drawHazeBands(grade: SkyGrade): void {
    const g = this._ctx;
    const horizon = this._h * 0.63;
    for (let i = 0; i < 3; i++) {
      const y = horizon - this._h * (0.02 + i * 0.045);
      const hgt = this._h * (0.03 + i * 0.02);
      const grd = g.createLinearGradient(0, y - hgt, 0, y + hgt);
      grd.addColorStop(0, css(grade.haze, 0));
      grd.addColorStop(0.5, css(grade.haze, 0.3 - i * 0.07));
      grd.addColorStop(1, css(grade.haze, 0));
      g.fillStyle = grd;
      g.fillRect(0, y - hgt, this._w, hgt * 2);
    }
  }

  private _drawPine(
    x: number, baseY: number, h: number, col: RGB, seed: number, detail: boolean
  ): void {
    const g = this._ctx;
    const rnd = mulberry32(seed);
    const tiers = 7 + Math.floor(rnd() * 6);
    const maxW = h * (0.3 + rnd() * 0.14);
    const lean = (rnd() - 0.5) * h * 0.05;
    const tipY = baseY - h;
    const tierStep = h / tiers;
    const droop = tierStep * (0.3 + rnd() * 0.22);
    const sway = Math.sin(this._t * 0.42 + seed) * h * 0.007;
    const wind = 0.4 + this._weather.windSpeed;

    g.fillStyle = css(shade(col, -0.42));
    g.fillRect(x - h * 0.014, baseY - h * 0.14, h * 0.028, h * 0.15);

    const body = mixRgb(col, { r: 255, g: 255, b: 255 }, 0.045 * this._grade.ambient);
    g.fillStyle = css(body);

    const pt = (side: number, t: number): { x: number; y: number } => {
      const y = tipY + t * h * 0.97;
      const w = maxW * Math.pow(t, 0.78) * (1 + 0.06 * Math.sin(t * 9 + seed));
      const drift = lean * t * t + sway * wind * (1 - t * 0.5);
      return { x: x + drift + side * w, y };
    };

    g.beginPath();
    g.moveTo(x + lean, tipY);

    for (let i = 0; i < tiers; i++) {
      const t0 = i / tiers;
      const t1 = (i + 1) / tiers;
      const right = pt(1, t1);
      const inset = pt(0.16, t0 + (t1 - t0) * 0.34);

      g.quadraticCurveTo(
        x + lean * t1 * t1 + sway * wind * (1 - t1) + maxW * t1 * 0.62,
        right.y - droop * 0.55,
        right.x,
        right.y
      );
      g.quadraticCurveTo(
        x + lean * t1 * t1 + sway * wind * (1 - t1) + maxW * t1 * 0.34,
        inset.y - droop * 0.16,
        inset.x,
        inset.y
      );
    }

    const foot = pt(1, 1);
    g.lineTo(foot.x, baseY);
    g.lineTo(x + lean - maxW * 0.1, baseY);
    g.lineTo(x + lean - maxW * 0.26, baseY);
    g.lineTo(x + lean - maxW * 0.12, baseY - h * 0.02);

    for (let i = tiers - 1; i >= 0; i--) {
      const t0 = i / tiers;
      const t1 = (i + 1) / tiers;
      const left = pt(-1, t1);
      const inset = pt(-0.16, t0 + (t1 - t0) * 0.34);

      g.quadraticCurveTo(
        x + lean * t1 * t1 + sway * wind * (1 - t1) - maxW * t1 * 0.34,
        inset.y - droop * 0.16,
        inset.x,
        inset.y
      );
      g.quadraticCurveTo(
        x + lean * t1 * t1 + sway * wind * (1 - t1) - maxW * t1 * 0.62,
        left.y - droop * 0.55,
        left.x,
        left.y
      );
    }

    g.closePath();
    g.fill();

    if (detail) {
      g.fillStyle = css(shade(body, 0.1));
      g.beginPath();
      g.moveTo(x + lean, tipY);
      g.lineTo(x + lean - maxW * 0.06, tipY + h * 0.2);
      g.lineTo(x + lean + maxW * 0.02, tipY + h * 0.16);
      g.closePath();
      g.fill();
    }
  }

  private _drawForestBand(
    trees: Array<{ x: number; h: number; s: number }>,
    base: RGB, depth: number, baseYFrac: number, detail: boolean, amp: number,
    clearing?: { x: number; halfW: number }
  ): void {
    const ambient = this._grade.ambient;
    const col = mixRgb(
      mixRgb(base, { r: 0, g: 0, b: 0 }, (1 - ambient) * 0.5),
      this._grade.haze,
      depth
    );
    const baseY = this._h * baseYFrac;

    for (const t of trees) {
      if (clearing && Math.abs(t.x - clearing.x) < clearing.halfW) continue;
      const n = fbm1D(t.x * 7.3, 4409, 3);
      const y = baseY - (n - 0.5) * amp * this._h;
      const px = t.x * this._w + this._mouse.px * (1 - depth) * 16;
      this._drawPine(px, y, t.h * this._h, col, t.s, detail);
    }
  }

  private _drawForestFar(): void {
    this._drawForestBand(this._treesFar, FOREST_FAR, 0.66, 0.668, false, 0.016);
  }

  private _drawForestMid(): void {
    this._drawForestBand(this._treesMid, FOREST_MID, 0.36, 0.706, true, 0.022, {
      x: 0.2,
      halfW: 0.052,
    });
  }

  private _drawForestNear(): void {
    this._drawForestBand(this._treesNear, FOREST_NEAR, 0.05, 0.87, true, 0.03, {
      x: 0.2,
      halfW: 0.07,
    });
  }

  private _drawPolesAndWires(grade: SkyGrade): void {
    const g = this._ctx;
    const ambient = grade.ambient;
    const col = mixRgb(mixRgb({ r: 26, g: 24, b: 26 }, { r: 0, g: 0, b: 0 }, (1 - ambient) * 0.6), grade.haze, 0.28);
    const baseY = this._h * 0.7;

    const tops = this._poles.map((p) => ({
      x: p.x * this._w,
      top: baseY - p.h * this._h,
      base: baseY + this._h * 0.05,
    }));

    g.strokeStyle = css(col, 0.94);
    g.lineWidth = Math.max(1.4, this._h * 0.0022);
    for (const t of tops) {
      g.beginPath();
      g.moveTo(t.x, t.base);
      g.lineTo(t.x, t.top);
      g.stroke();

      const armW = this._h * 0.026;
      const armY = t.top + this._h * 0.012;
      g.beginPath();
      g.moveTo(t.x - armW, armY);
      g.lineTo(t.x + armW, armY);
      g.stroke();
      g.beginPath();
      g.moveTo(t.x - armW * 0.75, armY - this.h0(0.009));
      g.lineTo(t.x + armW * 0.75, armY - this.h0(0.009));
      g.stroke();
    }

    g.lineWidth = Math.max(1, this._h * 0.0013);
    g.strokeStyle = css(col, 0.8);
    for (let i = 0; i < tops.length - 1; i++) {
      const a = tops[i];
      const b = tops[i + 1];
      for (const off of [0, -0.009, -0.018]) {
        const ay = a.top + this._h * 0.012 + this._h * off;
        const by = b.top + this._h * 0.012 + this._h * off;
        g.beginPath();
        g.moveTo(a.x, ay);
        const seg = 26;
        for (let s = 1; s <= seg; s++) {
          const t = s / seg;
          const x = a.x + (b.x - a.x) * t;
          const sag = Math.sin(Math.PI * t) * this._h * 0.014;
          g.lineTo(x, ay + (by - ay) * t + sag);
        }
        g.stroke();
      }
    }
  }

  private h0(frac: number): number {
    return this._h * frac;
  }

  private _drawCabin(grade: SkyGrade): void {
    const g = this._ctx;
    const ambient = grade.ambient;
    const wallBase = mixRgb(mixRgb({ r: 74, g: 52, b: 40 }, { r: 0, g: 0, b: 0 }, (1 - ambient) * 0.62), grade.haze, 0.2);
    const wallDark = shade(wallBase, -0.3);
    const roofCol = shade(mixRgb(mixRgb({ r: 44, g: 32, b: 30 }, { r: 0, g: 0, b: 0 }, (1 - ambient) * 0.6), grade.haze, 0.16), -0.12);

    const x = this._w * 0.2 + this._mouse.px * 8;
    const baseY = this._h * 0.748;
    const w = this._w * 0.062;
    const h = this._h * 0.042;

    const shadow = g.createRadialGradient(x, baseY, 0, x, baseY, w * 1.1);
    shadow.addColorStop(0, 'rgba(0,0,0,0.34)');
    shadow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = shadow;
    g.beginPath();
    g.ellipse(x, baseY, w * 1.1, h * 0.28, 0, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = css(wallBase);
    g.fillRect(x - w / 2, baseY - h, w, h);

    g.fillStyle = css(wallDark);
    g.fillRect(x + w * 0.24, baseY - h, w * 0.26, h);
    for (let i = 0; i < 4; i++) {
      g.fillRect(x - w / 2, baseY - h * (0.18 + i * 0.2), w, Math.max(1, h * 0.012));
    }

    g.fillStyle = css(roofCol);
    g.beginPath();
    g.moveTo(x - w * 0.66, baseY - h);
    g.lineTo(x + w * 0.06, baseY - h - h * 0.72);
    g.lineTo(x + w * 0.4, baseY - h);
    g.closePath();
    g.fill();
    g.fillStyle = css(shade(roofCol, -0.16));
    g.beginPath();
    g.moveTo(x + w * 0.06, baseY - h - h * 0.72);
    g.lineTo(x + w * 0.62, baseY - h);
    g.lineTo(x + w * 0.4, baseY - h);
    g.closePath();
    g.fill();

    g.fillStyle = css(shade(wallDark, -0.3));
    g.fillRect(x + w * 0.22, baseY - h - h * 0.46, w * 0.09, h * 0.46);

    const lit = ambient < 0.42;
    const winAlpha = lit ? 0.96 : 0.1;
    if (winAlpha > 0.2) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (const wx of [-w * 0.28, w * 0.1]) {
        const wxx = x + wx;
        const wyy = baseY - h * 0.66;
        const ww = w * 0.16;
        const glow = g.createRadialGradient(wxx, wyy, 0, wxx, wyy, ww * 4.2);
        glow.addColorStop(0, `rgba(255,196,104,${0.4 * winAlpha})`);
        glow.addColorStop(1, 'rgba(255,180,90,0)');
        g.fillStyle = glow;
        g.beginPath();
        g.arc(wxx, wyy, ww * 4.2, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }
    g.fillStyle = `rgba(255,206,132,${winAlpha})`;
    g.fillRect(x - w * 0.36, baseY - h * 0.78, w * 0.16, h * 0.26);
    g.fillRect(x + w * 0.02, baseY - h * 0.78, w * 0.16, h * 0.26);
    g.fillStyle = css(shade(wallDark, -0.4));
    g.fillRect(x - w * 0.28, baseY - h * 0.78, w * 0.16, Math.max(1, h * 0.014));
    g.fillRect(x + w * 0.1, baseY - h * 0.78, w * 0.16, Math.max(1, h * 0.014));

    const lightsOut = this._anom('lights-out');
    if (ambient < 0.7) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (const s of this._smoke) {
        const t = (this._t * s.sp + s.t) % 1;
        const sy = baseY - h - h * 0.42 - t * this._h * 0.14;
        const sx = x + w * 0.35 + Math.sin(t * 4 + s.t * 9) * this.h0(0.012) * (0.4 + t);
        const sr = this._h * (0.004 + t * 0.017);
        const a = (1 - t) * 0.15 * (1 - lightsOut);
        const grd = g.createRadialGradient(sx, sy, 0, sx, sy, sr);
        grd.addColorStop(0, `rgba(206,206,214,${a})`);
        grd.addColorStop(1, 'rgba(206,206,214,0)');
        g.fillStyle = grd;
        g.beginPath();
        g.arc(sx, sy, sr, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }
  }

  private _drawObservatory(grade: SkyGrade): void {
    const g = this._ctx;
    const ambient = grade.ambient;
    const body = mixRgb(mixRgb({ r: 92, g: 94, b: 102 }, { r: 0, g: 0, b: 0 }, (1 - ambient) * 0.6), grade.haze, 0.24);
    const dark = shade(body, -0.36);
    const domeLit = shade(body, 0.14);

    const x = this._w * 0.565 + this._mouse.px * 6;
    const baseY = this._h * 0.715;
    const w = this._w * 0.05;
    const h = this._h * 0.062;
    const r = w * 0.56;

    const shadow = g.createRadialGradient(x, baseY, 0, x, baseY, w * 1.3);
    shadow.addColorStop(0, 'rgba(0,0,0,0.3)');
    shadow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = shadow;
    g.beginPath();
    g.ellipse(x, baseY, w * 1.3, h * 0.26, 0, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = css(body);
    g.fillRect(x - w / 2, baseY - h, w, h);

    g.fillStyle = css(dark);
    g.fillRect(x - w * 0.5, baseY - h * 0.44, w, Math.max(1, h * 0.045));
    g.fillStyle = css(shade(body, 0.12));
    g.fillRect(x - w * 0.1, baseY - h * 0.38, w * 0.2, h * 0.38);

    g.fillStyle = css(dark);
    g.fillRect(x + w * 0.24, baseY - h * 0.9, w * 0.18, h * 0.9);

    g.beginPath();
    g.arc(x, baseY - h, r, Math.PI, 0);
    g.closePath();
    const domeGrad = g.createRadialGradient(
      x - r * 0.35, baseY - h - r * 0.5, r * 0.1,
      x, baseY - h, r * 1.25
    );
    domeGrad.addColorStop(0, css(domeLit));
    domeGrad.addColorStop(0.55, css(body));
    domeGrad.addColorStop(1, css(shade(body, -0.3)));
    g.fillStyle = domeGrad;
    g.fill();

    g.save();
    g.beginPath();
    g.arc(x, baseY - h, r, Math.PI, 0);
    g.closePath();
    g.clip();

    g.fillStyle = css(shade(body, -0.5));
    g.beginPath();
    g.moveTo(x - w * 0.035, baseY - h - r * 1.05);
    g.lineTo(x + w * 0.035, baseY - h - r * 1.05);
    g.lineTo(x + w * 0.06, baseY - h);
    g.lineTo(x - w * 0.06, baseY - h);
    g.closePath();
    g.fill();

    const slitGrad = g.createLinearGradient(x, baseY - h - r, x, baseY - h);
    slitGrad.addColorStop(0, css(mixRgb(grade.lightColor, { r: 26, g: 34, b: 56 }, 0.3), ambient * 0.7));
    slitGrad.addColorStop(1, css(grade.lightColor, 0));
    g.fillStyle = slitGrad;
    g.fillRect(x - w * 0.035, baseY - h - r, w * 0.07, r);
    g.restore();

    g.strokeStyle = css(shade(body, -0.5));
    g.lineWidth = Math.max(1, this._h * 0.0014);
    g.beginPath();
    g.arc(x, baseY - h, r, Math.PI, 0);
    g.stroke();

    g.fillStyle = css(shade(body, 0.24));
    g.beginPath();
    g.arc(x, baseY - h - r - this._h * 0.004, this._h * 0.004, 0, Math.PI * 2);
    g.fill();

    const sig = this._anom('observatory-signal');
    const lit = ambient < 0.34 ? 0.95 : ambient < 0.6 ? 0.4 : 0.1;

    if (lit > 0.15 || sig > 0) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      const lx = x;
      const ly = baseY - h - w * 0.28;
      const glow = g.createRadialGradient(lx, ly, 0, lx, ly, w * (1.6 + sig * 3));
      const col = sig > 0.2 ? { r: 255, g: 96, b: 84 } : { r: 255, g: 198, b: 110 };
      glow.addColorStop(0, css(col, (0.5 + sig * 0.4) * Math.max(lit, sig)));
      glow.addColorStop(0.3, css(col, 0.18 + sig * 0.3));
      glow.addColorStop(1, css(col, 0));
      g.fillStyle = glow;
      g.beginPath();
      g.arc(lx, ly, w * (1.6 + sig * 3), 0, Math.PI * 2);
      g.fill();

      if (sig > 0.05) {
        g.strokeStyle = css(col, sig * 0.5);
        g.lineWidth = Math.max(1, this._h * 0.0016);
        for (let i = 0; i < 3; i++) {
          const pulse = (this._t * 0.8 + i * 0.33) % 1;
          const r = w * (0.8 + pulse * 5);
          g.globalAlpha = sig * (1 - pulse);
          g.beginPath();
          g.arc(lx, ly, r, -Math.PI * 0.42, -Math.PI * 0.08);
          g.stroke();
        }
        g.globalAlpha = 1;
      }
      g.restore();
    }
  }

  private _drawRadioTower(grade: SkyGrade): void {
    const g = this._ctx;
    const ambient = grade.ambient;
    const col = mixRgb(mixRgb({ r: 118, g: 118, b: 122 }, { r: 0, g: 0, b: 0 }, (1 - ambient) * 0.6), grade.haze, 0.2);

    const x = this._w * 0.775 + this._mouse.px * 5;
    const baseY = this._h * 0.715;
    const h = this._h * 0.2;
    const halfBase = this._h * 0.017;
    const halfTop = this._h * 0.0035;

    g.strokeStyle = css(col, 0.95);
    g.lineWidth = Math.max(1, this._h * 0.0016);

    g.beginPath();
    g.moveTo(x - halfBase, baseY);
    g.lineTo(x - halfTop, baseY - h);
    g.moveTo(x + halfBase, baseY);
    g.lineTo(x + halfTop, baseY - h);
    g.stroke();

    g.lineWidth = Math.max(0.8, this._h * 0.0011);
    g.strokeStyle = css(col, 0.8);
    const segs = 9;
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs;
      const t1 = (i + 1) / segs;
      const y0 = baseY - h * t0;
      const y1 = baseY - h * t1;
      const w0 = halfBase + (halfTop - halfBase) * t0;
      const w1 = halfBase + (halfTop - halfBase) * t1;
      g.beginPath();
      g.moveTo(x - w0, y0);
      g.lineTo(x + w1, y1);
      g.moveTo(x + w0, y0);
      g.lineTo(x - w1, y1);
      g.moveTo(x - w1, y1);
      g.lineTo(x + w1, y1);
      g.stroke();
    }

    const apexY = baseY - h;
    g.lineWidth = Math.max(1, this._h * 0.0013);
    g.beginPath();
    g.moveTo(x, apexY);
    g.lineTo(x, apexY - this._h * 0.016);
    g.moveTo(x - this._h * 0.006, apexY - this._h * 0.012);
    g.lineTo(x + this._h * 0.006, apexY - this._h * 0.012);
    g.moveTo(x - this._h * 0.004, apexY - this._h * 0.006);
    g.lineTo(x + this._h * 0.004, apexY - this._h * 0.006);
    g.stroke();

    const blink = (this._t % 2) < 1.1;
    if (blink) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      const gx = x;
      const gy = apexY - this._h * 0.016;
      const glow = g.createRadialGradient(gx, gy, 0, gx, gy, this._h * 0.022);
      glow.addColorStop(0, 'rgba(255,72,64,0.85)');
      glow.addColorStop(0.25, 'rgba(255,60,50,0.28)');
      glow.addColorStop(1, 'rgba(255,50,40,0)');
      g.fillStyle = glow;
      g.beginPath();
      g.arc(gx, gy, this._h * 0.022, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }

  private _drawGround(grade: SkyGrade): void {
    const g = this._ctx;
    const base = mixRgb(
      mixRgb({ r: 30, g: 40, b: 32 }, { r: 0, g: 0, b: 0 }, (1 - grade.ambient) * 0.55),
      grade.haze,
      0.1
    );
    const y0 = this._h * 0.7;
    const grd = g.createLinearGradient(0, y0, 0, this._h);
    grd.addColorStop(0, css(shade(base, 0.1)));
    grd.addColorStop(0.4, css(base));
    grd.addColorStop(1, css(shade(base, -0.42)));
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(0, this._h);
    for (let px = 0; px <= this._w; px += 6) {
      const n = fbm1D(px * 0.004, 8821, 4);
      g.lineTo(px, y0 + (n - 0.5) * this._h * 0.02);
    }
    g.lineTo(this._w, this._h);
    g.closePath();
    g.fill();

    this._drawRoad(grade, base, y0);
    this._drawRocks(grade);
    this._drawGrass(grade, base);
  }

  private _drawRoad(grade: SkyGrade, ground: RGB, y0: number): void {
    const g = this._ctx;
    const dirt = mixRgb(mixRgb(shade(ground, 0.06), { r: 122, g: 106, b: 86 }, 0.22 * grade.ambient), { r: 0, g: 0, b: 0 }, 0.12);

    const vanishX = this._w * 0.52;
    const bottomX = this._w * 0.16;

    const edge = (side: number) => (t: number) => {
      const px = bottomX + (vanishX - bottomX) * t + side * this._w * 0.016 * (0.2 + t * 1.2);
      const py = y0 + this._h * 0.02 + (this._h - y0 - this._h * 0.02) * Math.pow(t, 1.7);
      return { x: px, y: py };
    };

    const l = edge(-1);
    const r = edge(1);

    g.beginPath();
    g.moveTo(l(0).x, l(0).y);
    for (let i = 1; i <= 18; i++) g.lineTo(l(i / 18).x, l(i / 18).y);
    for (let i = 18; i >= 0; i--) g.lineTo(r(i / 18).x, r(i / 18).y);
    g.closePath();

    const grd = g.createLinearGradient(0, y0, 0, this._h);
    grd.addColorStop(0, css(shade(dirt, -0.24)));
    grd.addColorStop(0.45, css(dirt));
    grd.addColorStop(1, css(shade(dirt, 0.1)));
    g.fillStyle = grd;
    g.fill();

    g.save();
    g.clip();
    g.strokeStyle = css(shade(dirt, -0.3), 0.32);
    g.lineWidth = Math.max(0.7, this._h * 0.0012);
    for (let i = 0; i < 26; i++) {
      const t = i / 26;
      const rr = l(t);
      g.beginPath();
      g.moveTo(rr.x, rr.y);
      g.lineTo(rr.x + (r(t).x - rr.x) * (0.3 + (i % 3) * 0.2), rr.y);
      g.stroke();
    }
    g.restore();

    g.strokeStyle = css(shade(ground, -0.2), 0.5);
    g.lineWidth = Math.max(1, this._h * 0.0016);
    for (const side of [-1, 1]) {
      const e = edge(side);
      g.beginPath();
      g.moveTo(e(0).x, e(0).y);
      for (let i = 1; i <= 18; i++) g.lineTo(e(i / 18).x, e(i / 18).y);
      g.stroke();
    }
  }

  private _drawRocks(grade: SkyGrade): void {
    const g = this._ctx;
    const rnd = mulberry32(6673);
    for (let i = 0; i < 22; i++) {
      const t = rnd();
      const px = rnd() * this._w;
      const py = this._h * (0.73 + t * 0.25);
      const scale = (0.25 + t * 0.75) * (this._h / 1080);
      const col = mixRgb(
        mixRgb({ r: 54, g: 54, b: 56 }, { r: 0, g: 0, b: 0 }, (1 - grade.ambient) * 0.66),
        grade.haze,
        0.05 + t * 0.05
      );

      g.beginPath();
      const n = 6;
      for (let v = 0; v < n; v++) {
        const a = (v / n) * Math.PI * 2 + rnd() * 0.5;
        const rr = scale * (4 + rnd() * 5);
        const vx = px + Math.cos(a) * rr;
        const vy = py + Math.sin(a) * rr * 0.5;
        if (v === 0) g.moveTo(vx, vy);
        else g.lineTo(vx, vy);
      }
      g.closePath();
      g.fillStyle = css(col);
      g.fill();
    }
  }

  private _drawGrass(grade: SkyGrade, base: RGB): void {
    const g = this._ctx;
    const rnd = mulberry32(2213);
    for (let i = 0; i < 340; i++) {
      const t = Math.pow(rnd(), 0.7);
      const px = rnd() * this._w;
      const py = this._h * (0.725 + t * 0.26);
      const hh = this._h * (0.003 + t * 0.019);
      const tone = mixRgb(base, { r: 255, g: 255, b: 255 }, rnd() * 0.16 * grade.ambient);
      g.strokeStyle = css(tone, 0.32 + t * 0.3);
      g.lineWidth = Math.max(0.6, this._h * 0.001 * (0.6 + t));

      const blades = 2 + Math.floor(rnd() * 3);
      for (let b = 0; b < blades; b++) {
        const ox = px + (b - blades / 2) * hh * 0.32;
        const sway = Math.sin(this._t * 0.85 + i * 1.7 + b) * hh * 0.34 * (0.35 + this._weather.windSpeed);
        g.beginPath();
        g.moveTo(ox, py);
        g.quadraticCurveTo(ox + sway * 0.45, py - hh * 0.58, ox + sway, py - hh);
        g.stroke();
      }
    }
  }

  private _drawFog(grade: SkyGrade, _unused?: number): void {
    const amt = this._weather.condition === 'fog' ? 0.85 : this._weather.condition === 'rain' ? 0.28 : this._weather.condition === 'storm' ? 0.34 : 0.08;
    if (amt <= 0.02) return;
    const g = this._ctx;
    for (let i = 0; i < 4; i++) {
      const y = this._h * (0.6 + i * 0.075) + Math.sin(this._t * 0.12 + i) * this.h0(0.008);
      const hgt = this._h * (0.06 + i * 0.03);
      const drift = Math.sin(this._t * 0.07 + i * 2) * this.h0(0.03);
      const grd = g.createLinearGradient(0, y - hgt, 0, y + hgt);
      grd.addColorStop(0, css(grade.haze, 0));
      grd.addColorStop(0.5, css(grade.haze, amt * (0.5 - i * 0.09)));
      grd.addColorStop(1, css(grade.haze, 0));
      g.fillStyle = grd;
      g.fillRect(drift - this.h0(0.05), y - hgt, this._w + this.h0(0.1), hgt * 2);
    }
  }

  private _drawMotes(grade: SkyGrade, _unused?: number): void {
    if (grade.ambient > 0.42) return;
    const g = this._ctx;
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const m of this._motes) {
      const px = m.x * this._w + Math.sin(this._t * m.sp + m.ph) * this.h0(0.024);
      const py = m.y * this._h + Math.cos(this._t * m.sp * 0.8 + m.ph * 1.7) * this.h0(0.011);
      const b = 0.5 + 0.5 * Math.sin(this._t * 2.1 + m.ph * 3);
      const a = Math.pow(b, 4.5) * 0.42 * (1 - grade.ambient);
      if (a < 0.015) continue;
      const r = this._h * 0.0011;
      const grd = g.createRadialGradient(px, py, 0, px, py, r * 4.5);
      grd.addColorStop(0, `rgba(206,248,158,${a})`);
      grd.addColorStop(0.4, `rgba(178,228,124,${a * 0.24})`);
      grd.addColorStop(1, 'rgba(160,210,110,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(px, py, r * 4.5, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  private _drawPrecipitation(dt: number): void {
    const g = this._ctx;
    const cond = this._weather.condition;
    if (cond === 'rain' || cond === 'storm') {
      const wind = this._weather.windSpeed * 0.5 + 0.25;
      g.strokeStyle = 'rgba(178,200,240,0.34)';
      g.lineWidth = Math.max(0.7, this._h * 0.001);
      g.beginPath();
      for (const r of this._rain) {
        r.y += (r.sp * dt) / 1000;
        r.x += (wind * dt) / 1000 * 0.3;
        if (r.y > 1.05) {
          r.y = -0.05;
          r.x = Math.random();
        }
        if (r.x > 1.05) r.x = -0.05;
        const x = r.x * this._w;
        const y = r.y * this._h;
        g.moveTo(x, y);
        g.lineTo(x - wind * r.len * this._w * 0.1, y + r.len * this._h);
      }
      g.stroke();
    } else if (cond === 'snow') {
      g.save();
      for (const s of this._snow) {
        s.y += (s.sp * dt) / 1000;
        if (s.y > 1.05) {
          s.y = -0.03;
          s.x = Math.random();
        }
        const px = s.x * this._w + Math.sin(this._t * 0.7 + s.ph) * this.h0(0.01);
        const py = s.y * this._h;
        const r = s.r * (this._h / 1080);
        g.fillStyle = 'rgba(246,248,255,0.62)';
        g.beginPath();
        g.arc(px, py, r, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }
  }

  private _drawMeteor(): void {
    if (!this._meteor) return;
    const m = this._meteor;
    m.x += (m.vx * 0.24) / 60;
    m.y += (m.vy * 0.24) / 60;
    m.life -= 0.017;
    if (m.life <= 0 || m.x < -0.1 || m.x > 1.1) {
      this._meteor = null;
      return;
    }
    const g = this._ctx;
    const x = m.x * this._w;
    const y = m.y * this._h;
    const tail = this._w * 0.16;
    const dx = -m.vx * tail;
    const dy = -m.vy * tail;

    g.save();
    g.globalCompositeOperation = 'lighter';
    const grd = g.createLinearGradient(x, y, x + dx, y + dy);
    grd.addColorStop(0, `rgba(255,255,255,${m.life})`);
    grd.addColorStop(0.25, `rgba(210,230,255,${m.life * 0.4})`);
    grd.addColorStop(1, 'rgba(190,215,255,0)');
    g.strokeStyle = grd;
    g.lineWidth = Math.max(1, this._h * 0.0022);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + dx, y + dy);
    g.stroke();

    const head = g.createRadialGradient(x, y, 0, x, y, this._h * 0.006);
    head.addColorStop(0, `rgba(255,255,255,${m.life})`);
    head.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = head;
    g.beginPath();
    g.arc(x, y, this._h * 0.006, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  private _drawBolt(): void {
    if (this._bolt <= 0) return;
    this._bolt -= 0.055;
    const a = Math.max(0, this._bolt);
    const g = this._ctx;

    g.save();
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = `rgba(190,205,255,${a * 0.14})`;
    g.fillRect(0, 0, this._w, this._h);

    const flick = Math.sin(this._bolt * 41) > 0.1;
    if (flick) {
      const rnd = (n: number) => {
        const v = Math.sin((this._boltSeed + n) * 12.9898) * 43758.5453;
        return v - Math.floor(v);
      };
      let x = this._w * (0.15 + rnd(1) * 0.7);
      let y = 0;
      g.strokeStyle = `rgba(226,236,255,${a})`;
      g.lineWidth = Math.max(1.2, this._h * 0.0026);
      g.beginPath();
      g.moveTo(x, y);
      while (y < this._h * 0.62) {
        y += this._h * (0.02 + rnd(2) * 0.045);
        x += (rnd(3) - 0.5) * this._w * 0.05;
        g.lineTo(x, y);
      }
      g.stroke();

      const gl = g.createRadialGradient(x, y, 0, x, y, this._h * 0.2);
      gl.addColorStop(0, `rgba(210,224,255,${a * 0.5})`);
      gl.addColorStop(1, 'rgba(210,224,255,0)');
      g.fillStyle = gl;
      g.beginPath();
      g.arc(x, y, this._h * 0.2, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  private _drawAnomalyOverlays(): void {
    const watcher = this._anom('forest-watcher');
    if (watcher > 0) {
      const g = this._ctx;
      const x = this._w * (0.2 + Math.sin(this._t * 0.4) * 0.05) + this._mouse.px * 12;
      const y = this.h0(0.688);
      const h = this._h * 0.085;
      g.save();
      g.globalAlpha = watcher;
      g.fillStyle = 'rgba(0,0,0,0.86)';
      g.beginPath();
      g.moveTo(x, y - h);
      g.quadraticCurveTo(x + h * 0.24, y - h * 0.55, x + h * 0.2, y);
      g.lineTo(x - h * 0.2, y);
      g.quadraticCurveTo(x - h * 0.24, y - h * 0.55, x, y - h);
      g.closePath();
      g.fill();
      g.beginPath();
      g.ellipse(x, y - h * 0.94, h * 0.17, h * 0.15, 0, 0, Math.PI * 2);
      g.fill();

      const look = Math.sin(this._t * 1.3) > 0.55;
      if (look) {
        g.save();
        g.globalCompositeOperation = 'lighter';
        for (const ex of [-h * 0.06, h * 0.06]) {
          const grd = g.createRadialGradient(x + ex, y - h * 0.95, 0, x + ex, y - h * 0.95, h * 0.05);
          grd.addColorStop(0, `rgba(255,236,190,${0.85 * watcher})`);
          grd.addColorStop(1, 'rgba(255,220,160,0)');
          g.fillStyle = grd;
          g.beginPath();
          g.arc(x + ex, y - h * 0.95, h * 0.05, 0, Math.PI * 2);
          g.fill();
        }
        g.restore();
      }
      g.restore();
    }
  }

  private _drawGrade(grade: SkyGrade): void {
    const g = this._ctx;
    g.save();
    g.globalCompositeOperation = 'overlay';
    const warm = grade.lightColor.r > grade.lightColor.b;
    g.fillStyle = warm ? 'rgba(255,170,90,0.055)' : 'rgba(90,150,255,0.05)';
    g.fillRect(0, 0, this._w, this._h);
    g.restore();

    g.save();
    g.globalCompositeOperation = 'multiply';
    const v = 0.5 + grade.ambient * 0.5;
    g.fillStyle = `rgba(${(255 * v) | 0},${(255 * v * 0.99) | 0},${(255 * v * 0.96) | 0},1)`;
    g.fillRect(0, 0, this._w, this._h);
    g.restore();
  }

  private _drawVignette(): void {
    const g = this._ctx;
    const grd = g.createRadialGradient(
      this._w * 0.5, this._h * 0.46, this._h * 0.22,
      this._w * 0.5, this._h * 0.5, this.h0(0.95)
    );
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(0.62, 'rgba(0,0,0,0.1)');
    grd.addColorStop(1, 'rgba(0,0,0,0.5)');
    g.fillStyle = grd;
    g.fillRect(0, 0, this._w, this._h);
  }

  private _drawGrain(): void {
    if (!this._grain) return;
    const g = this._ctx;
    g.save();
    g.globalCompositeOperation = 'overlay';
    g.globalAlpha = 0.045;
    const ox = -Math.floor(Math.random() * 180);
    const oy = -Math.floor(Math.random() * 180);
    const pat = g.createPattern(this._grain, 'repeat');
    if (pat) {
      g.translate(ox, oy);
      g.fillStyle = pat;
      g.fillRect(0, 0, this._w + 180, this._h + 180);
    }
    g.restore();
  }

  dispose(): void {
    this._anomalies = [];
    this._rain = [];
    this._snow = [];
  }
}
