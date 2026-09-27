import { describe, it, expect, vi } from 'vitest';
import { DayNightCycle } from '../src/renderer/DayNightCycle.js';

describe('DayNightCycle', () => {
  it('should create stars on init', () => {
    const canvas = document.createElement('canvas');
    const ctx = {
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      stroke: vi.fn(),
      ellipse: vi.fn(),
      createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    };
    canvas.getContext = vi.fn(() => ctx as unknown as CanvasRenderingContext2D);
    const cycle = new DayNightCycle(canvas);
    expect(cycle).toBeDefined();
  });

  it('should render without errors', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    const ctx = {
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      stroke: vi.fn(),
      ellipse: vi.fn(),
      createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    };
    canvas.getContext = vi.fn(() => ctx as unknown as CanvasRenderingContext2D);
    const cycle = new DayNightCycle(canvas);
    expect(() => cycle.render(new Date())).not.toThrow();
  });

  it('should trigger shooting star', () => {
    const canvas = document.createElement('canvas');
    const ctx = {
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      stroke: vi.fn(),
      ellipse: vi.fn(),
      createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    };
    canvas.getContext = vi.fn(() => ctx as unknown as CanvasRenderingContext2D);
    const cycle = new DayNightCycle(canvas);
    expect(() => cycle.triggerShootingStar()).not.toThrow();
  });
});
