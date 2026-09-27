export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface SkyState {
  topColor: Color;
  bottomColor: Color;
  sunPosition: { x: number; y: number };
  moonPosition: { x: number; y: number };
  starOpacity: number;
  ambientLight: number;
  period: string;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(a: Color, b: Color, t: number): Color {
  return {
    r: Math.round(lerp(a.r, b.r, t)),
    g: Math.round(lerp(a.g, b.g, t)),
    b: Math.round(lerp(a.b, b.b, t)),
    a: lerp(a.a, b.a, t),
  };
}

function colorToString(c: Color): string {
  return `rgba(${c.r},${c.g},${c.b},${c.a})`;
}

interface TimePeriod {
  startHour: number;
  endHour: number;
  topColor: Color;
  bottomColor: Color;
  starOpacity: number;
  ambientLight: number;
}

const PERIODS: TimePeriod[] = [
  { startHour: 0, endHour: 5, topColor: { r: 5, g: 5, b: 20, a: 1 }, bottomColor: { r: 10, g: 10, b: 30, a: 1 }, starOpacity: 1, ambientLight: 0.1 },
  { startHour: 5, endHour: 7, topColor: { r: 20, g: 20, b: 50, a: 1 }, bottomColor: { r: 60, g: 40, b: 70, a: 1 }, starOpacity: 0.6, ambientLight: 0.3 },
  { startHour: 7, endHour: 10, topColor: { r: 80, g: 120, b: 180, a: 1 }, bottomColor: { r: 180, g: 160, b: 140, a: 1 }, starOpacity: 0.1, ambientLight: 0.7 },
  { startHour: 10, endHour: 15, topColor: { r: 100, g: 150, b: 220, a: 1 }, bottomColor: { r: 180, g: 200, b: 230, a: 1 }, starOpacity: 0, ambientLight: 1 },
  { startHour: 15, endHour: 18, topColor: { r: 120, g: 100, b: 180, a: 1 }, bottomColor: { r: 220, g: 140, b: 80, a: 1 }, starOpacity: 0.1, ambientLight: 0.8 },
  { startHour: 18, endHour: 20, topColor: { r: 40, g: 30, b: 60, a: 1 }, bottomColor: { r: 100, g: 50, b: 60, a: 1 }, starOpacity: 0.5, ambientLight: 0.4 },
  { startHour: 20, endHour: 24, topColor: { r: 5, g: 5, b: 20, a: 1 }, bottomColor: { r: 15, g: 15, b: 35, a: 1 }, starOpacity: 0.9, ambientLight: 0.15 },
];

export class DayNightCycle {
  private _canvas: HTMLCanvasElement;
  private _ctx: CanvasRenderingContext2D;
  private _stars: { x: number; y: number; size: number; twinkle: number }[] = [];
  private _clouds: { x: number; y: number; width: number; speed: number; opacity: number }[] = [];
  private _shootingStar: { x: number; y: number; vx: number; vy: number; life: number } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d')!;
    this._initStars();
    this._initClouds();
  }

  private _initStars(): void {
    for (let i = 0; i < 200; i++) {
      this._stars.push({
        x: Math.random(),
        y: Math.random() * 0.6,
        size: Math.random() * 2 + 0.5,
        twinkle: Math.random() * Math.PI * 2,
      });
    }
  }

  private _initClouds(): void {
    for (let i = 0; i < 5; i++) {
      this._clouds.push({
        x: Math.random(),
        y: Math.random() * 0.3 + 0.05,
        width: Math.random() * 0.3 + 0.15,
        speed: (Math.random() * 0.02 + 0.005) * (Math.random() > 0.5 ? 1 : -1),
        opacity: Math.random() * 0.4 + 0.2,
      });
    }
  }

  render(time: Date): void {
    const hour = time.getHours() + time.getMinutes() / 60;

    const sky = this._computeSky(hour);
    this._drawSky(sky);
    this._drawStars(sky.starOpacity, time);
    this._drawSun(sky.sunPosition, sky.ambientLight);
    this._drawMoon(sky.moonPosition, sky.starOpacity);
    this._drawClouds(sky.ambientLight);
    this._drawLandscape(sky.ambientLight);
    this._updateShootingStar();
  }

  private _computeSky(hour: number): SkyState {
    let current = PERIODS[0];
    let next = PERIODS[1];

    for (let i = 0; i < PERIODS.length; i++) {
      if (hour >= PERIODS[i].startHour && hour < PERIODS[i].endHour) {
        current = PERIODS[i];
        next = PERIODS[(i + 1) % PERIODS.length];
        break;
      }
    }

    const periodLength = current.endHour - current.startHour;
    const t = (hour - current.startHour) / periodLength;

    const sunProgress = hour >= 6 && hour <= 18 ? (hour - 6) / 12 : -1;
    const moonProgress = hour >= 18 || hour <= 6 ? ((hour + 24 - 18) % 24) / 12 : -1;

    return {
      topColor: lerpColor(current.topColor, next.topColor, t),
      bottomColor: lerpColor(current.bottomColor, next.bottomColor, t),
      sunPosition: sunProgress >= 0
        ? { x: sunProgress, y: 0.8 - Math.sin(sunProgress * Math.PI) * 0.6 }
        : { x: -1, y: -1 },
      moonPosition: moonProgress >= 0
        ? { x: moonProgress, y: 0.8 - Math.sin(moonProgress * Math.PI) * 0.5 }
        : { x: -1, y: -1 },
      starOpacity: lerp(current.starOpacity, next.starOpacity, t),
      ambientLight: lerp(current.ambientLight, next.ambientLight, t),
      period: this._getPeriodName(hour),
    };
  }

  private _getPeriodName(hour: number): string {
    if (hour >= 5 && hour < 8) return 'dawn';
    if (hour >= 8 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 20) return 'dusk';
    if (hour >= 20 && hour < 23) return 'evening';
    return 'night';
  }

  private _drawSky(sky: SkyState): void {
    const gradient = this._ctx.createLinearGradient(0, 0, 0, this._canvas.height);
    gradient.addColorStop(0, colorToString(sky.topColor));
    gradient.addColorStop(1, colorToString(sky.bottomColor));
    this._ctx.fillStyle = gradient;
    this._ctx.fillRect(0, 0, this._canvas.width, this._canvas.height);
  }

  private _drawStars(opacity: number, time: Date): void {
    if (opacity <= 0) return;
    const t = time.getTime() / 1000;

    for (const star of this._stars) {
      const twinkle = 0.5 + 0.5 * Math.sin(t * 2 + star.twinkle);
      this._ctx.fillStyle = `rgba(255,255,255,${opacity * twinkle})`;
      this._ctx.beginPath();
      this._ctx.arc(star.x * this._canvas.width, star.y * this._canvas.height, star.size, 0, Math.PI * 2);
      this._ctx.fill();
    }
  }

  private _drawSun(pos: { x: number; y: number }, ambient: number): void {
    if (pos.x < 0) return;
    const x = pos.x * this._canvas.width;
    const y = pos.y * this._canvas.height;
    const radius = 40;

    const glow = this._ctx.createRadialGradient(x, y, 0, x, y, radius * 3);
    glow.addColorStop(0, `rgba(255,220,100,${0.8 * ambient})`);
    glow.addColorStop(1, 'rgba(255,220,100,0)');
    this._ctx.fillStyle = glow;
    this._ctx.fillRect(x - radius * 3, y - radius * 3, radius * 6, radius * 6);

    this._ctx.fillStyle = `rgba(255,240,180,${ambient})`;
    this._ctx.beginPath();
    this._ctx.arc(x, y, radius, 0, Math.PI * 2);
    this._ctx.fill();
  }

  private _drawMoon(pos: { x: number; y: number }, starOpacity: number): void {
    if (pos.x < 0 || starOpacity < 0.1) return;
    const x = pos.x * this._canvas.width;
    const y = pos.y * this._canvas.height;
    const radius = 30;

    this._ctx.fillStyle = `rgba(220,220,240,${starOpacity})`;
    this._ctx.beginPath();
    this._ctx.arc(x, y, radius, 0, Math.PI * 2);
    this._ctx.fill();

    this._ctx.fillStyle = `rgba(180,180,200,${starOpacity * 0.5})`;
    this._ctx.beginPath();
    this._ctx.arc(x - 8, y - 5, 6, 0, Math.PI * 2);
    this._ctx.fill();
    this._ctx.beginPath();
    this._ctx.arc(x + 10, y + 8, 4, 0, Math.PI * 2);
    this._ctx.fill();
  }

  private _drawClouds(ambient: number): void {
    for (const cloud of this._clouds) {
      cloud.x += cloud.speed / 60;
      if (cloud.x > 1.2) cloud.x = -0.2;
      if (cloud.x < -0.2) cloud.x = 1.2;

      const x = cloud.x * this._canvas.width;
      const y = cloud.y * this._canvas.height;
      const w = cloud.width * this._canvas.width;

      this._ctx.fillStyle = `rgba(255,255,255,${cloud.opacity * ambient * 0.5})`;
      this._ctx.beginPath();
      this._ctx.ellipse(x, y, w / 2, w / 6, 0, 0, Math.PI * 2);
      this._ctx.fill();
      this._ctx.beginPath();
      this._ctx.ellipse(x - w / 4, y + 5, w / 3, w / 8, 0, 0, Math.PI * 2);
      this._ctx.fill();
      this._ctx.beginPath();
      this._ctx.ellipse(x + w / 4, y + 3, w / 3.5, w / 7, 0, 0, Math.PI * 2);
      this._ctx.fill();
    }
  }

  private _drawLandscape(ambient: number): void {
    const w = this._canvas.width;
    const h = this._canvas.height;
    const horizon = h * 0.65;

    this._ctx.fillStyle = `rgba(20,30,20,${0.3 + ambient * 0.2})`;
    this._ctx.beginPath();
    this._ctx.moveTo(0, horizon);
    for (let x = 0; x <= w; x += 20) {
      const y = horizon - Math.sin(x * 0.005) * 30 - Math.sin(x * 0.01) * 15;
      this._ctx.lineTo(x, y);
    }
    this._ctx.lineTo(w, h);
    this._ctx.lineTo(0, h);
    this._ctx.closePath();
    this._ctx.fill();

    this._drawForest(horizon, ambient);
    this._drawCabin(horizon, ambient);
    this._drawRadioTower(horizon, ambient);
    this._drawObservatory(horizon, ambient);
  }

  private _drawForest(horizon: number, ambient: number): void {
    const w = this._canvas.width;
    const treeColor = `rgba(15,35,15,${0.5 + ambient * 0.3})`;

    for (let i = 0; i < 30; i++) {
      const x = (i / 30) * w + Math.sin(i * 7) * 20;
      const height = 40 + Math.sin(i * 13) * 20;
      const y = horizon + 10;

      this._ctx.fillStyle = treeColor;
      this._ctx.beginPath();
      this._ctx.moveTo(x, y - height);
      this._ctx.lineTo(x - 12, y);
      this._ctx.lineTo(x + 12, y);
      this._ctx.closePath();
      this._ctx.fill();
    }
  }

  private _drawCabin(horizon: number, ambient: number): void {
    const x = this._canvas.width * 0.15;
    const y = horizon + 20;
    const w = 80;
    const h = 50;

    this._ctx.fillStyle = `rgba(60,40,30,${0.5 + ambient * 0.3})`;
    this._ctx.fillRect(x - w / 2, y - h, w, h);

    this._ctx.fillStyle = `rgba(40,25,15,${0.5 + ambient * 0.3})`;
    this._ctx.beginPath();
    this._ctx.moveTo(x - w / 2 - 5, y - h);
    this._ctx.lineTo(x, y - h - 25);
    this._ctx.lineTo(x + w / 2 + 5, y - h);
    this._ctx.closePath();
    this._ctx.fill();

    const windowGlow = ambient < 0.3 ? 0.8 : 0.1;
    this._ctx.fillStyle = `rgba(255,200,100,${windowGlow})`;
    this._ctx.fillRect(x - 15, y - h + 15, 12, 12);
    this._ctx.fillRect(x + 5, y - h + 15, 12, 12);
  }

  private _drawRadioTower(horizon: number, ambient: number): void {
    const x = this._canvas.width * 0.75;
    const y = horizon - 10;
    const height = 120;

    this._ctx.strokeStyle = `rgba(80,80,80,${0.5 + ambient * 0.3})`;
    this._ctx.lineWidth = 2;
    this._ctx.beginPath();
    this._ctx.moveTo(x - 15, y);
    this._ctx.lineTo(x, y - height);
    this._ctx.lineTo(x + 15, y);
    this._ctx.stroke();

    this._ctx.beginPath();
    this._ctx.moveTo(x - 10, y - height * 0.3);
    this._ctx.lineTo(x + 10, y - height * 0.3);
    this._ctx.moveTo(x - 7, y - height * 0.6);
    this._ctx.lineTo(x + 7, y - height * 0.6);
    this._ctx.stroke();

    const blinkOn = Math.floor(Date.now() / 1000) % 2 === 0;
    if (blinkOn) {
      this._ctx.fillStyle = `rgba(255,50,50,${0.5 + ambient * 0.5})`;
      this._ctx.beginPath();
      this._ctx.arc(x, y - height, 4, 0, Math.PI * 2);
      this._ctx.fill();
    }
  }

  private _drawObservatory(horizon: number, ambient: number): void {
    const x = this._canvas.width * 0.55;
    const y = horizon - 5;

    this._ctx.fillStyle = `rgba(50,50,60,${0.5 + ambient * 0.3})`;
    this._ctx.fillRect(x - 20, y - 40, 40, 40);

    this._ctx.beginPath();
    this._ctx.arc(x, y - 40, 20, Math.PI, 0);
    this._ctx.fill();

    this._ctx.fillStyle = `rgba(30,30,40,${0.5 + ambient * 0.3})`;
    this._ctx.fillRect(x - 3, y - 55, 6, 15);

    const lightOn = ambient < 0.2 && Math.random() < 0.01;
    if (lightOn) {
      this._ctx.fillStyle = 'rgba(255,200,100,0.8)';
      this._ctx.beginPath();
      this._ctx.arc(x, y - 45, 3, 0, Math.PI * 2);
      this._ctx.fill();
    }
  }

  triggerShootingStar(): void {
    this._shootingStar = {
      x: Math.random() * 0.5 + 0.25,
      y: Math.random() * 0.2 + 0.05,
      vx: (Math.random() * 0.02 + 0.01) * (Math.random() > 0.5 ? 1 : -1),
      vy: Math.random() * 0.01 + 0.005,
      life: 1,
    };
  }

  private _updateShootingStar(): void {
    if (!this._shootingStar) return;

    const s = this._shootingStar;
    s.x += s.vx / 60;
    s.y += s.vy / 60;
    s.life -= 0.02;

    if (s.life <= 0) {
      this._shootingStar = null;
      return;
    }

    const x = s.x * this._canvas.width;
    const y = s.y * this._canvas.height;

    const gradient = this._ctx.createLinearGradient(x, y, x - s.vx * 500, y - s.vy * 500);
    gradient.addColorStop(0, `rgba(255,255,255,${s.life})`);
    gradient.addColorStop(1, 'rgba(255,255,255,0)');

    this._ctx.strokeStyle = gradient;
    this._ctx.lineWidth = 2;
    this._ctx.beginPath();
    this._ctx.moveTo(x, y);
    this._ctx.lineTo(x - s.vx * 500, y - s.vy * 500);
    this._ctx.stroke();
  }
}
