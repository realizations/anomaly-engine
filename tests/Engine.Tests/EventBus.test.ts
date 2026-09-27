import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../../src/core/EventBus.js';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('should subscribe and receive events', () => {
    const handler = vi.fn();
    bus.subscribe('test.event', handler);

    bus.emit({
      id: '1',
      type: 'test.event',
      timestamp: Date.now(),
      source: 'test',
      payload: {},
      priority: 'normal',
      rarity: 'common',
      cooldown: 0,
      duration: 0,
      targetScene: 'main',
      seed: 1,
      metadata: {},
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should respect cooldowns', () => {
    const handler = vi.fn();
    bus.subscribe('test.event', handler);

    const event = {
      id: '1',
      type: 'test.event',
      timestamp: Date.now(),
      source: 'test',
      payload: {},
      priority: 'normal',
      rarity: 'common',
      cooldown: 60,
      duration: 0,
      targetScene: 'main',
      seed: 1,
      metadata: {},
    };

    bus.emit(event);
    bus.emit(event);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should support wildcard subscriptions', () => {
    const handler = vi.fn();
    bus.subscribe('*', handler);

    bus.emit({
      id: '1',
      type: 'any.event',
      timestamp: Date.now(),
      source: 'test',
      payload: {},
      priority: 'normal',
      rarity: 'common',
      cooldown: 0,
      duration: 0,
      targetScene: 'main',
      seed: 1,
      metadata: {},
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should unsubscribe correctly', () => {
    const handler = vi.fn();
    const unsub = bus.subscribe('test.event', handler);
    unsub();

    bus.emit({
      id: '1',
      type: 'test.event',
      timestamp: Date.now(),
      source: 'test',
      payload: {},
      priority: 'normal',
      rarity: 'common',
      cooldown: 0,
      duration: 0,
      targetScene: 'main',
      seed: 1,
      metadata: {},
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('should track history', () => {
    bus.emit({
      id: '1',
      type: 'test.event',
      timestamp: Date.now(),
      source: 'test',
      payload: {},
      priority: 'normal',
      rarity: 'common',
      cooldown: 0,
      duration: 0,
      targetScene: 'main',
      seed: 1,
      metadata: {},
    });

    const history = bus.getHistory();
    expect(history.length).toBe(1);
    expect(history[0].type).toBe('test.event');
  });
});
