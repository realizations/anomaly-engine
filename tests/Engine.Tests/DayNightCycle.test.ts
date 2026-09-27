import { describe, it, expect } from 'vitest';
import { DayNightCycle } from '../../src/renderer/DayNightCycle.js';

describe('DayNightCycle', () => {
  it('should create stars on init', () => {
    const canvas = document.createElement('canvas');
    const cycle = new DayNightCycle(canvas);
    expect(cycle).toBeDefined();
  });

  it('should render without errors', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    const cycle = new DayNightCycle(canvas);
    expect(() => cycle.render(new Date())).not.toThrow();
  });

  it('should trigger shooting star', () => {
    const canvas = document.createElement('canvas');
    const cycle = new DayNightCycle(canvas);
    expect(() => cycle.triggerShootingStar()).not.toThrow();
  });
});
