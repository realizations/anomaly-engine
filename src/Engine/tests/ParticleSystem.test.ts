import { describe, it, expect } from 'vitest';
import { ParticleSystem } from '../src/systems/ParticleSystem.js';

describe('ParticleSystem', () => {
  let system: ParticleSystem;

  beforeEach(() => {
    system = new ParticleSystem(100);
  });

  it('should start and stop effects', () => {
    system.start('rain');
    system.stop();
    expect(system.getParticleCount()).toBe(0);
  });

  it('should emit particles', () => {
    system.start('rain');
    system.update(100);
    expect(system.getParticleCount()).toBeGreaterThan(0);
  });

  it('should respect max particles', () => {
    system.setMaxParticles(5);
    system.start('rain');
    for (let i = 0; i < 100; i++) {
      system.update(16);
    }
    expect(system.getParticleCount()).toBeLessThanOrEqual(5);
  });

  it('should clear particles', () => {
    system.start('rain');
    system.update(100);
    system.clear();
    expect(system.getParticleCount()).toBe(0);
  });
});
