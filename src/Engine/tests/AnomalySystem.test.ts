import { describe, it, expect } from 'vitest';
import { AnomalySystem } from '../src/anomalies/AnomalyRegistry.js';

describe('AnomalySystem', () => {
  let system: AnomalySystem;

  beforeEach(() => {
    system = new AnomalySystem();
  });

  it('should register anomalies', () => {
    system.register({
      id: 'test-anomaly',
      name: 'Test Anomaly',
      description: 'A test anomaly',
      category: 'visual',
      rarity: 'rare',
      cooldown: 60,
      duration: 10,
      effects: [],
    });
    expect(system.getDefinitions().length).toBe(1);
  });

  it('should trigger anomalies', () => {
    system.register({
      id: 'test-anomaly',
      name: 'Test Anomaly',
      description: 'A test anomaly',
      category: 'visual',
      rarity: 'rare',
      cooldown: 60,
      duration: 10,
      effects: [],
    });
    const result = system.trigger('test-anomaly');
    expect(result).toBe(true);
    expect(system.getActiveAnomaly()).toBeDefined();
  });

  it('should respect cooldowns', () => {
    system.register({
      id: 'test-anomaly',
      name: 'Test Anomaly',
      description: 'A test anomaly',
      category: 'visual',
      rarity: 'rare',
      cooldown: 60,
      duration: 10,
      effects: [],
    });
    system.trigger('test-anomaly');
    const result = system.trigger('test-anomaly');
    expect(result).toBe(false);
  });

  it('should check prerequisites', () => {
    system.register({
      id: 'prereq-anomaly',
      name: 'Prereq Anomaly',
      description: 'An anomaly with prerequisites',
      category: 'visual',
      rarity: 'rare',
      cooldown: 60,
      duration: 10,
      prerequisites: ['other-anomaly'],
      effects: [],
    });
    const result = system.trigger('prereq-anomaly');
    expect(result).toBe(false);
  });

  it('should mark prerequisites as met', () => {
    system.register({
      id: 'prereq-anomaly',
      name: 'Prereq Anomaly',
      description: 'An anomaly with prerequisites',
      category: 'visual',
      rarity: 'rare',
      cooldown: 60,
      duration: 10,
      prerequisites: ['other-anomaly'],
      effects: [],
    });
    system.markPrerequisiteMet('other-anomaly');
    const result = system.trigger('prereq-anomaly');
    expect(result).toBe(true);
  });
});
