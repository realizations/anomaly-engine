export interface Layer {
  name: string;
  depth: number;
  color: string;
  points: number[];
}

export interface WeatherState {
  condition: 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'fog';
  intensity: number;
  windSpeed: number;
  windDirection: number;
}

export interface AnomalyVisual {
  type: 'second-moon' | 'red-moon' | 'forest-watcher' | 'observatory-signal' | 'meteor' | 'fireflies';
  active: boolean;
  opacity: number;
  x: number;
  y: number;
  seed: number;
}

export interface InteractiveElement {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hoverEffect: string;
  clickEffect: string;
  discovered: boolean;
}

export class WorldRenderer {
  private _canvas: HTMLCanvasElement;
  private _ctx: CanvasRenderingContext2D;
  private _width = 0;
  private _height = 0;
  private _time = 0;
  private _mouseX = -1;
  private _mouseY = -1;
  private _weather: WeatherState = { condition: 'clear', intensity: 0, windSpeed: 0, windDirection: 0 };
  private _anomalies: AnomalyVisual[] = [];
  private _interactiveElements: InteractiveElement[] = [];
  private _layers: Layer[] = [];
  private _stars: Array<{ x: number; y: number; size: number; twinkle: number; brightness: number }> = [];
  private _clouds: Array<{ x: number; y: number; width: number; speed: number; opacity: number; shadow: number }> = [];
  public _particles: Array<{ x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number; color: string; opacity: number }> = [];
  private _fireflies: Array<{ x: number; y: number; vx: number; vy: number; phase: number; brightness: number }> = [];
  private _shootingStar: { x: number; y: number; vx: number; vy: number; life: number } | null = null;
  private _lightning = 0;
  public _fogDensity = 0;
  private _parallaxX = 0;
  private _parallaxY = 0;

  constructor(canvas: HTMLCanvasElement) {
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d')!;
    this._initLayers();
    this._initStars();
    this._initClouds();
    this._initFireflies();
    this._initInteractiveElements();
    this._setupMouseTracking();
  }

  private _initLayers(): void {
    this._layers = [
      { name: 'sky', depth: 0, color: '', points: [] },
      { name: 'mountains-far', depth: 0.1, color: '#1a2a3a', points: this._generateMountainPoints(8, 0.3, 0.5) },
      { name: 'mountains-mid', depth: 0.2, color: '#0f1f2f', points: this._generateMountainPoints(6, 0.4, 0.6) },
      { name: 'hills', depth: 0.3, color: '#0a1a1a', points: this._generateMountainPoints(5, 0.5, 0.7) },
      { name: 'trees-far', depth: 0.4, color: '#0d2a0d', points: this._generateTreePoints(40, 0.6, 0.8) },
      { name: 'trees-mid', depth: 0.5, color: '#0a1f0a', points: this._generateTreePoints(25, 0.7, 0.9) },
      { name: 'ground', depth: 0.6, color: '#0a0f0a', points: [] },
    ];
  }

  private _generateMountainPoints(count: number, minHeight: number, maxHeight: number): number[] {
    const points: number[] = [];
    for (let i = 0; i <= count; i++) {
      points.push(minHeight + Math.random() * (maxHeight - minHeight));
    }
    return points;
  }

  private _generateTreePoints(count: number, minHeight: number, maxHeight: number): number[] {
    const points: number[] = [];
    for (let i = 0; i < count; i++) {
      points.push(minHeight + Math.random() * (maxHeight - minHeight));
    }
    return points;
  }

  private _initStars(): void {
    for (let i = 0; i < 300; i++) {
      this._stars.push({
        x: Math.random(),
        y: Math.random() * 0.5,
        size: Math.random() * 2 + 0.5,
        twinkle: Math.random() * Math.PI * 2,
        brightness: Math.random() * 0.5 + 0.5,
      });
    }
  }

  private _initClouds(): void {
    for (let i = 0; i < 8; i++) {
      this._clouds.push({
        x: Math.random(),
        y: Math.random() * 0.25 + 0.05,
        width: Math.random() * 0.25 + 0.1,
        speed: (Math.random() * 0.015 + 0.005) * (Math.random() > 0.5 ? 1 : -1),
        opacity: Math.random() * 0.3 + 0.15,
        shadow: Math.random() * 0.1,
      });
    }
  }

  private _initFireflies(): void {
    for (let i = 0; i < 30; i++) {
      this._fireflies.push({
        x: 0.1 + Math.random() * 0.8,
        y: 0.5 + Math.random() * 0.3,
        vx: (Math.random() - 0.5) * 0.02,
        vy: (Math.random() - 0.5) * 0.02,
        phase: Math.random() * Math.PI * 2,
        brightness: Math.random(),
      });
    }
  }

  private _initInteractiveElements(): void {
    this._interactiveElements = [
      { id: 'observatory', name: 'Observatory', x: 0.52, y: 0.28, width: 0.08, height: 0.12, hoverEffect: 'glow', clickEffect: 'signal', discovered: false },
      { id: 'cabin', name: 'Cabin', x: 0.12, y: 0.58, width: 0.08, height: 0.1, hoverEffect: 'window-glow', clickEffect: 'knock', discovered: false },
      { id: 'radio-tower', name: 'Radio Tower', x: 0.72, y: 0.18, width: 0.06, height: 0.2, hoverEffect: 'beacon', clickEffect: 'transmit', discovered: false },
      { id: 'forest', name: 'Forest', x: 0.05, y: 0.5, width: 0.25, height: 0.25, hoverEffect: 'rustle', clickEffect: 'watcher', discovered: false },
      { id: 'moon', name: 'Moon', x: 0.7, y: 0.15, width: 0.06, height: 0.06, hoverEffect: 'pulse', clickEffect: 'eclipse', discovered: false },
    ];
  }

  private _setupMouseTracking(): void {
    this._canvas.addEventListener('mousemove', (e) => {
      this._mouseX = e.clientX / this._width;
      this._mouseY = e.clientY / this._height;
      this._parallaxX = (this._mouseX - 0.5) * 0.02;
      this._parallaxY = (this._mouseY - 0.5) * 0.01;
    });
    this._canvas.addEventListener('mouseleave', () => {
      this._mouseX = -1;
      this._mouseY = -1;
      this._parallaxX = 0;
      this._parallaxY = 0;
    });
  }

  resize(width: number, height: number): void {
    this._width = width;
    this._height = height;
    this._canvas.width = width;
    this._canvas.height = height;
  }

  setWeather(weather: WeatherState): void {
    this._weather = weather;
  }

  addAnomaly(anomaly: AnomalyVisual): void {
    this._anomalies.push(anomaly);
  }

  removeAnomaly(type: string): void {
    this._anomalies = this._anomalies.filter(a => a.type !== type);
  }

  triggerShootingStar(): void {
    this._shootingStar = {
      x: Math.random() * 0.6 + 0.2,
      y: Math.random() * 0.15 + 0.05,
      vx: (Math.random() * 0.015 + 0.008) * (Math.random() > 0.5 ? 1 : -1),
      vy: Math.random() * 0.008 + 0.004,
      life: 1,
    };
  }

  triggerLightning(): void {
    this._lightning = 1;
  }

  render(time: Date): void {
    this._time = time.getTime();
    const hour = time.getHours() + time.getMinutes() / 60;

    this._renderSky(hour);
    this._renderStars(hour);
    this._renderSun(hour);
    this._renderMoon(hour);
    this._renderClouds(hour);
    this._renderMountains(hour);
    this._renderTrees(hour);
    this._renderGround(hour);
    this._renderCabin(hour);
    this._renderObservatory(hour);
    this._renderRadioTower(hour);
    this._renderWeather();
    this._renderFireflies(hour);
    this._renderAnomalies();
    this._renderShootingStar();
    this._renderLightning();
    this._renderFog();
    this._renderInteractiveHighlights();
  }

  private _renderSky(hour: number): void {
    let topColor: number[], bottomColor: number[];

    if (hour >= 5 && hour < 8) {
      const t = (hour - 5) / 3;
      topColor = this._lerpColor([10, 10, 40], [80, 120, 180], t);
      bottomColor = this._lerpColor([40, 20, 60], [180, 140, 120], t);
    } else if (hour >= 8 && hour < 17) {
      topColor = [80, 130, 200];
      bottomColor = [160, 190, 220];
    } else if (hour >= 17 && hour < 20) {
      const t = (hour - 17) / 3;
      topColor = this._lerpColor([80, 100, 160], [20, 15, 40], t);
      bottomColor = this._lerpColor([200, 120, 80], [60, 30, 50], t);
    } else {
      topColor = [5, 5, 20];
      bottomColor = [15, 15, 35];
    }

    const gradient = this._ctx.createLinearGradient(0, 0, 0, this._height);
    gradient.addColorStop(0, `rgb(${topColor[0]},${topColor[1]},${topColor[2]})`);
    gradient.addColorStop(1, `rgb(${bottomColor[0]},${bottomColor[1]},${bottomColor[2]})`);
    this._ctx.fillStyle = gradient;
    this._ctx.fillRect(0, 0, this._width, this._height);
  }

  private _renderStars(hour: number): void {
    const starOpacity = this._getStarOpacity(hour);
    if (starOpacity <= 0) return;

    const t = this._time / 1000;
    for (const star of this._stars) {
      const twinkle = 0.5 + 0.5 * Math.sin(t * 2 + star.twinkle);
      const alpha = starOpacity * star.brightness * twinkle;
      this._ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      this._ctx.beginPath();
      this._ctx.arc(
        star.x * this._width + this._parallaxX * 0.1,
        star.y * this._height + this._parallaxY * 0.1,
        star.size,
        0,
        Math.PI * 2
      );
      this._ctx.fill();
    }
  }

  private _renderSun(hour: number): void {
    if (hour < 6 || hour > 18) return;
    const progress = (hour - 6) / 12;
    const x = progress * this._width;
    const y = this._height * 0.7 - Math.sin(progress * Math.PI) * this._height * 0.5;

    const glow = this._ctx.createRadialGradient(x, y, 0, x, y, 80);
    glow.addColorStop(0, 'rgba(255,220,100,0.8)');
    glow.addColorStop(0.5, 'rgba(255,200,80,0.3)');
    glow.addColorStop(1, 'rgba(255,200,80,0)');
    this._ctx.fillStyle = glow;
    this._ctx.fillRect(x - 80, y - 80, 160, 160);

    this._ctx.fillStyle = 'rgba(255,240,180,1)';
    this._ctx.beginPath();
    this._ctx.arc(x, y, 30, 0, Math.PI * 2);
    this._ctx.fill();
  }

  private _renderMoon(hour: number): void {
    const moonProgress = hour >= 18 || hour <= 6 ? ((hour + 24 - 18) % 24) / 12 : -1;
    if (moonProgress < 0) return;

    const x = moonProgress * this._width;
    const y = this._height * 0.6 - Math.sin(moonProgress * Math.PI) * this._height * 0.4;

    const glow = this._ctx.createRadialGradient(x, y, 0, x, y, 60);
    glow.addColorStop(0, 'rgba(220,220,240,0.4)');
    glow.addColorStop(1, 'rgba(220,220,240,0)');
    this._ctx.fillStyle = glow;
    this._ctx.fillRect(x - 60, y - 60, 120, 120);

    this._ctx.fillStyle = 'rgba(220,220,240,0.9)';
    this._ctx.beginPath();
    this._ctx.arc(x, y, 25, 0, Math.PI * 2);
    this._ctx.fill();

    this._ctx.fillStyle = 'rgba(180,180,200,0.3)';
    this._ctx.beginPath();
    this._ctx.arc(x - 8, y - 5, 6, 0, Math.PI * 2);
    this._ctx.fill();
    this._ctx.beginPath();
    this._ctx.arc(x + 10, y + 8, 4, 0, Math.PI * 2);
    this._ctx.fill();
  }

  private _renderClouds(hour: number): void {
    const ambient = this._getAmbientLight(hour);
    for (const cloud of this._clouds) {
      cloud.x += cloud.speed / 60;
      if (cloud.x > 1.3) cloud.x = -0.3;
      if (cloud.x < -0.3) cloud.x = 1.3;

      const x = cloud.x * this._width;
      const y = cloud.y * this._height;
      const w = cloud.width * this._width;

      this._ctx.fillStyle = `rgba(255,255,255,${cloud.opacity * (0.3 + ambient * 0.7)})`;
      this._ctx.beginPath();
      this._ctx.ellipse(x, y, w / 2, w / 6, 0, 0, Math.PI * 2);
      this._ctx.fill();
      this._ctx.beginPath();
      this._ctx.ellipse(x - w / 4, y + 5, w / 3, w / 8, 0, 0, Math.PI * 2);
      this._ctx.fill();
      this._ctx.beginPath();
      this._ctx.ellipse(x + w / 4, y + 3, w / 3.5, w / 7, 0, 0, Math.PI * 2);
      this._ctx.fill();

      if (cloud.shadow > 0.05) {
        this._ctx.fillStyle = `rgba(0,0,0,${cloud.shadow * (1 - ambient)})`;
        this._ctx.beginPath();
        this._ctx.ellipse(x, y + 10, w / 2, w / 8, 0, 0, Math.PI * 2);
        this._ctx.fill();
      }
    }
  }

  private _renderMountains(hour: number): void {
    const _ambient = this._getAmbientLight(hour);

    for (const layer of this._layers) {
      if (!layer.name.startsWith('mountains') && !layer.name.startsWith('hills')) continue;

      const parallax = this._parallaxX * layer.depth;
      const baseY = this._height * 0.65;

      this._ctx.fillStyle = layer.color;
      this._ctx.beginPath();
      this._ctx.moveTo(0, this._height);

      for (let i = 0; i < layer.points.length; i++) {
        const x = (i / (layer.points.length - 1)) * this._width + parallax * this._width;
        const y = baseY - layer.points[i] * this._height * 0.3;
        this._ctx.lineTo(x, y);
      }

      this._ctx.lineTo(this._width, this._height);
      this._ctx.closePath();
      this._ctx.fill();

      if (_ambient < 0.3) {
        this._ctx.fillStyle = `rgba(200,200,220,${0.1 * (1 - _ambient)})`;
        this._ctx.beginPath();
        for (let i = 0; i < layer.points.length; i++) {
          const x = (i / (layer.points.length - 1)) * this._width + parallax * this._width;
          const y = baseY - layer.points[i] * this._height * 0.3;
          if (i === 0) this._ctx.moveTo(x, y);
          else this._ctx.lineTo(x, y);
        }
        this._ctx.stroke();
      }
    }
  }

  private _renderTrees(_hour: number): void {
    for (const layer of this._layers) {
      if (!layer.name.startsWith('trees')) continue;

      const parallax = this._parallaxX * layer.depth;
      const baseY = this._height * 0.7;

      this._ctx.fillStyle = layer.color;
      for (let i = 0; i < layer.points.length; i++) {
        const x = (i / layer.points.length) * this._width + parallax * this._width;
        const height = layer.points[i] * this._height * 0.15;
        const y = baseY;

        this._ctx.beginPath();
        this._ctx.moveTo(x, y - height);
        this._ctx.lineTo(x - 8, y);
        this._ctx.lineTo(x + 8, y);
        this._ctx.closePath();
        this._ctx.fill();
      }
    }
  }

  private _renderGround(hour: number): void {
    const ambient = this._getAmbientLight(hour);
    const gradient = this._ctx.createLinearGradient(0, this._height * 0.7, 0, this._height);
    gradient.addColorStop(0, `rgba(10,20,10,${0.5 + ambient * 0.3})`);
    gradient.addColorStop(1, `rgba(5,10,5,${0.7 + ambient * 0.2})`);
    this._ctx.fillStyle = gradient;
    this._ctx.fillRect(0, this._height * 0.7, this._width, this._height * 0.3);
  }

  private _renderCabin(hour: number): void {
    const ambient = this._getAmbientLight(hour);
    const x = this._width * 0.15 + this._parallaxX * 0.3;
    const y = this._height * 0.72;
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

    if (ambient < 0.2) {
      const smokeY = y - h - 30 - (this._time / 50 % 20);
      this._ctx.fillStyle = `rgba(200,200,200,0.1)`;
      this._ctx.beginPath();
      this._ctx.arc(x + 20, smokeY, 5, 0, Math.PI * 2);
      this._ctx.fill();
    }
  }

  private _renderObservatory(hour: number): void {
    const ambient = this._getAmbientLight(hour);
    const x = this._width * 0.55 + this._parallaxX * 0.2;
    const y = this._height * 0.68;

    this._ctx.fillStyle = `rgba(50,50,60,${0.5 + ambient * 0.3})`;
    this._ctx.fillRect(x - 20, y - 40, 40, 40);

    this._ctx.beginPath();
    this._ctx.arc(x, y - 40, 20, Math.PI, 0);
    this._ctx.fill();

    this._ctx.fillStyle = `rgba(30,30,40,${0.5 + ambient * 0.3})`;
    this._ctx.fillRect(x - 3, y - 55, 6, 15);

    const lightOn = ambient < 0.2 && Math.random() < 0.02;
    if (lightOn) {
      const glow = this._ctx.createRadialGradient(x, y - 45, 0, x, y - 45, 20);
      glow.addColorStop(0, 'rgba(255,200,100,0.8)');
      glow.addColorStop(1, 'rgba(255,200,100,0)');
      this._ctx.fillStyle = glow;
      this._ctx.fillRect(x - 20, y - 65, 40, 40);
    }
  }

  private _renderRadioTower(hour: number): void {
    const ambient = this._getAmbientLight(hour);
    const x = this._width * 0.75 + this._parallaxX * 0.15;
    const y = this._height * 0.68;
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

    const blinkOn = Math.floor(this._time / 1000) % 2 === 0;
    if (blinkOn) {
      const glow = this._ctx.createRadialGradient(x, y - height, 0, x, y - height, 15);
      glow.addColorStop(0, 'rgba(255,50,50,0.8)');
      glow.addColorStop(1, 'rgba(255,50,50,0)');
      this._ctx.fillStyle = glow;
      this._ctx.fillRect(x - 15, y - height - 15, 30, 30);
    }
  }

  private _renderWeather(): void {
    if (this._weather.condition === 'rain' || this._weather.condition === 'storm') {
      this._renderRain();
    } else if (this._weather.condition === 'snow') {
      this._renderSnow();
    } else if (this._weather.condition === 'fog') {
      this._renderFog();
    }
  }

  private _renderRain(): void {
    const count = Math.floor(this._weather.intensity * 200);
    this._ctx.strokeStyle = 'rgba(150,180,255,0.4)';
    this._ctx.lineWidth = 1;

    for (let i = 0; i < count; i++) {
      const x = Math.random() * this._width;
      const y = Math.random() * this._height;
      const length = 10 + Math.random() * 10;

      this._ctx.beginPath();
      this._ctx.moveTo(x, y);
      this._ctx.lineTo(x + this._weather.windDirection * 2, y + length);
      this._ctx.stroke();
    }
  }

  private _renderSnow(): void {
    const count = Math.floor(this._weather.intensity * 100);
    this._ctx.fillStyle = 'rgba(255,255,255,0.6)';

    for (let i = 0; i < count; i++) {
      const x = Math.random() * this._width;
      const y = Math.random() * this._height;
      const size = 2 + Math.random() * 3;

      this._ctx.beginPath();
      this._ctx.arc(x, y, size, 0, Math.PI * 2);
      this._ctx.fill();
    }
  }

  private _renderFog(): void {
    const density = this._weather.intensity * 0.3;
    const gradient = this._ctx.createLinearGradient(0, this._height * 0.5, 0, this._height);
    gradient.addColorStop(0, `rgba(200,200,220,0)`);
    gradient.addColorStop(1, `rgba(200,200,220,${density})`);
    this._ctx.fillStyle = gradient;
    this._ctx.fillRect(0, this._height * 0.5, this._width, this._height * 0.5);
  }

  private _renderFireflies(hour: number): void {
    const ambient = this._getAmbientLight(hour);
    if (ambient > 0.3) return;

    const t = this._time / 1000;
    for (const fly of this._fireflies) {
      fly.x += fly.vx / 60;
      fly.y += fly.vy / 60;
      if (fly.x < 0 || fly.x > 1) fly.vx *= -1;
      if (fly.y < 0.4 || fly.y > 0.9) fly.vy *= -1;

      const brightness = 0.3 + 0.7 * Math.sin(t * 3 + fly.phase);
      const alpha = brightness * (1 - ambient);

      const glow = this._ctx.createRadialGradient(
        fly.x * this._width, fly.y * this._height, 0,
        fly.x * this._width, fly.y * this._height, 8
      );
      glow.addColorStop(0, `rgba(200,255,100,${alpha})`);
      glow.addColorStop(1, 'rgba(200,255,100,0)');
      this._ctx.fillStyle = glow;
      this._ctx.fillRect(
        fly.x * this._width - 8, fly.y * this._height - 8,
        16, 16
      );
    }
  }

  private _renderAnomalies(): void {
    for (const anomaly of this._anomalies) {
      if (!anomaly.active) continue;

      switch (anomaly.type) {
        case 'second-moon':
          this._renderSecondMoon(anomaly);
          break;
        case 'red-moon':
          this._renderRedMoon(anomaly);
          break;
        case 'forest-watcher':
          this._renderForestWatcher(anomaly);
          break;
        case 'observatory-signal':
          this._renderObservatorySignal(anomaly);
          break;
      }
    }
  }

  private _renderSecondMoon(anomaly: AnomalyVisual): void {
    const x = this._width * 0.3;
    const y = this._height * 0.2;

    const glow = this._ctx.createRadialGradient(x, y, 0, x, y, 40);
    glow.addColorStop(0, `rgba(200,200,220,${anomaly.opacity * 0.5})`);
    glow.addColorStop(1, 'rgba(200,200,220,0)');
    this._ctx.fillStyle = glow;
    this._ctx.fillRect(x - 40, y - 40, 80, 80);

    this._ctx.fillStyle = `rgba(200,200,220,${anomaly.opacity * 0.8})`;
    this._ctx.beginPath();
    this._ctx.arc(x, y, 15, 0, Math.PI * 2);
    this._ctx.fill();
  }

  private _renderRedMoon(anomaly: AnomalyVisual): void {
    const x = this._width * 0.7;
    const y = this._height * 0.15;

    const glow = this._ctx.createRadialGradient(x, y, 0, x, y, 80);
    glow.addColorStop(0, `rgba(255,50,50,${anomaly.opacity * 0.6})`);
    glow.addColorStop(1, 'rgba(255,50,50,0)');
    this._ctx.fillStyle = glow;
    this._ctx.fillRect(x - 80, y - 80, 160, 160);

    this._ctx.fillStyle = `rgba(255,80,80,${anomaly.opacity})`;
    this._ctx.beginPath();
    this._ctx.arc(x, y, 30, 0, Math.PI * 2);
    this._ctx.fill();
  }

  private _renderForestWatcher(anomaly: AnomalyVisual): void {
    const x = this._width * 0.2 + Math.sin(this._time / 2000) * 20;
    const y = this._height * 0.65;

    this._ctx.fillStyle = `rgba(0,0,0,${anomaly.opacity * 0.8})`;
    this._ctx.beginPath();
    this._ctx.ellipse(x, y, 15, 30, 0, 0, Math.PI * 2);
    this._ctx.fill();

    this._ctx.fillStyle = `rgba(255,255,255,${anomaly.opacity})`;
    this._ctx.beginPath();
    this._ctx.arc(x - 5, y - 20, 2, 0, Math.PI * 2);
    this._ctx.fill();
    this._ctx.beginPath();
    this._ctx.arc(x + 5, y - 20, 2, 0, Math.PI * 2);
    this._ctx.fill();
  }

  private _renderObservatorySignal(anomaly: AnomalyVisual): void {
    const x = this._width * 0.55;
    const y = this._height * 0.28;

    const pulse = Math.sin(this._time / 500) * 0.5 + 0.5;
    const alpha = anomaly.opacity * pulse;

    this._ctx.strokeStyle = `rgba(255,100,100,${alpha})`;
    this._ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const radius = 20 + i * 15 + pulse * 10;
      this._ctx.beginPath();
      this._ctx.arc(x, y, radius, -Math.PI * 0.3, Math.PI * 0.3);
      this._ctx.stroke();
    }
  }

  private _renderShootingStar(): void {
    if (!this._shootingStar) return;

    const s = this._shootingStar;
    s.x += s.vx / 60;
    s.y += s.vy / 60;
    s.life -= 0.015;

    if (s.life <= 0) {
      this._shootingStar = null;
      return;
    }

    const x = s.x * this._width;
    const y = s.y * this._height;

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

  private _renderLightning(): void {
    if (this._lightning <= 0) return;

    this._lightning -= 0.05;
    const alpha = this._lightning;

    this._ctx.fillStyle = `rgba(255,255,255,${alpha * 0.3})`;
    this._ctx.fillRect(0, 0, this._width, this._height);

    if (Math.random() < 0.3) {
      const x = Math.random() * this._width;
      this._ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      this._ctx.lineWidth = 2;
      this._ctx.beginPath();
      this._ctx.moveTo(x, 0);
      let ly = 0;
      while (ly < this._height * 0.6) {
        ly += 20 + Math.random() * 30;
        const lx = x + (Math.random() - 0.5) * 40;
        this._ctx.lineTo(lx, ly);
      }
      this._ctx.stroke();
    }
  }

  private _renderInteractiveHighlights(): void {
    if (this._mouseX < 0) return;

    for (const element of this._interactiveElements) {
      const ex = element.x * this._width;
      const ey = element.y * this._height;
      const ew = element.width * this._width;
      const eh = element.height * this._height;

      if (this._mouseX >= element.x && this._mouseX <= element.x + element.width &&
          this._mouseY >= element.y && this._mouseY <= element.y + element.height) {
        this._ctx.strokeStyle = 'rgba(136,136,255,0.3)';
        this._ctx.lineWidth = 1;
        this._ctx.setLineDash([4, 4]);
        this._ctx.strokeRect(ex, ey, ew, eh);
        this._ctx.setLineDash([]);
      }
    }
  }

  private _getStarOpacity(hour: number): number {
    if (hour >= 20 || hour < 5) return 1;
    if (hour >= 5 && hour < 7) return 1 - (hour - 5) / 2;
    if (hour >= 17 && hour < 20) return (hour - 17) / 3;
    return 0;
  }

  private _getAmbientLight(hour: number): number {
    if (hour >= 8 && hour < 17) return 1;
    if (hour >= 5 && hour < 8) return 0.3 + (hour - 5) / 3 * 0.7;
    if (hour >= 17 && hour < 20) return 1 - (hour - 17) / 3 * 0.7;
    return 0.1;
  }

  private _lerpColor(a: number[], b: number[], t: number): number[] {
    return [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t),
    ];
  }

  dispose(): void {
    this._anomalies = [];
    this._particles = [];
    this._fireflies = [];
  }
}
