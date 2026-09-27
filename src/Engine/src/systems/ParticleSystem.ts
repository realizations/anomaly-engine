export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  opacity: number;
}

export type ParticleEffect = 'rain' | 'snow' | 'fireflies' | 'leaves' | 'meteor' | 'fog';

export class ParticleSystem {
  private _particles: Particle[] = [];
  private _maxParticles: number;
  private _effect: ParticleEffect | null = null;
  private _emitting = false;
  private _originX = 0;
  private _originY = 0;

  constructor(maxParticles = 1000) {
    this._maxParticles = maxParticles;
  }

  start(effect: ParticleEffect, originX = 0.5, originY = 0): void {
    this._effect = effect;
    this._emitting = true;
    this._originX = originX;
    this._originY = originY;
  }

  stop(): void {
    this._emitting = false;
    this._effect = null;
  }

  clear(): void {
    this._particles = [];
  }

  update(deltaMs: number): void {
    const deltaSec = deltaMs / 1000;

    if (this._emitting && this._effect) {
      this._emit(deltaSec);
    }

    for (let i = this._particles.length - 1; i >= 0; i--) {
      const p = this._particles[i];
      p.x += p.vx * deltaSec;
      p.y += p.vy * deltaSec;
      p.life -= deltaMs;
      p.opacity = Math.max(0, p.life / p.maxLife);

      if (p.life <= 0 || p.y > 1.2 || p.x < -0.2 || p.x > 1.2) {
        this._particles.splice(i, 1);
      }
    }
  }

  private _emit(_deltaSec: number): void {
    if (!this._effect) return;

    const count = this._getEmitCount();
    for (let i = 0; i < count; i++) {
      if (this._particles.length >= this._maxParticles) break;
      this._particles.push(this._createParticle());
    }
  }

  private _getEmitCount(): number {
    if (!this._effect) return 0;
    switch (this._effect) {
      case 'rain': return 5;
      case 'snow': return 2;
      case 'fireflies': return 1;
      case 'leaves': return 1;
      case 'meteor': return 1;
      case 'fog': return 1;
      default: return 1;
    }
  }

  private _createParticle(): Particle {
    if (!this._effect) {
      return { x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 1, color: '#fff', opacity: 1 };
    }

    switch (this._effect) {
      case 'rain':
        return {
          x: Math.random(),
          y: -0.05,
          vx: -0.02,
          vy: 0.8 + Math.random() * 0.4,
          life: 2000,
          maxLife: 2000,
          size: 1,
          color: 'rgba(150,180,255,0.6)',
          opacity: 0.6,
        };
      case 'snow':
        return {
          x: Math.random(),
          y: -0.05,
          vx: (Math.random() - 0.5) * 0.1,
          vy: 0.1 + Math.random() * 0.1,
          life: 8000,
          maxLife: 8000,
          size: 2 + Math.random() * 3,
          color: 'rgba(255,255,255,0.8)',
          opacity: 0.8,
        };
      case 'fireflies':
        return {
          x: 0.2 + Math.random() * 0.6,
          y: 0.5 + Math.random() * 0.3,
          vx: (Math.random() - 0.5) * 0.05,
          vy: (Math.random() - 0.5) * 0.05,
          life: 5000,
          maxLife: 5000,
          size: 2,
          color: 'rgba(200,255,100,0.8)',
          opacity: 0.8,
        };
      case 'leaves':
        return {
          x: -0.05,
          y: 0.3 + Math.random() * 0.4,
          vx: 0.1 + Math.random() * 0.1,
          vy: 0.05 + Math.random() * 0.05,
          life: 6000,
          maxLife: 6000,
          size: 3,
          color: 'rgba(100,80,40,0.7)',
          opacity: 0.7,
        };
      case 'meteor':
        return {
          x: this._originX,
          y: this._originY,
          vx: (Math.random() - 0.5) * 0.02,
          vy: 0.01 + Math.random() * 0.01,
          life: 1500,
          maxLife: 1500,
          size: 2,
          color: 'rgba(255,255,255,1)',
          opacity: 1,
        };
      case 'fog':
        return {
          x: Math.random(),
          y: 0.4 + Math.random() * 0.3,
          vx: (Math.random() - 0.5) * 0.02,
          vy: 0,
          life: 10000,
          maxLife: 10000,
          size: 50 + Math.random() * 100,
          color: 'rgba(200,200,220,0.1)',
          opacity: 0.1,
        };
      default:
        return { x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 1, color: '#fff', opacity: 1 };
    }
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    for (const p of this._particles) {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.opacity;
      ctx.beginPath();
      ctx.arc(p.x * width, p.y * height, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  getParticleCount(): number {
    return this._particles.length;
  }

  setMaxParticles(max: number): void {
    this._maxParticles = max;
  }

  dispose(): void {
    this.stop();
    this.clear();
  }
}
