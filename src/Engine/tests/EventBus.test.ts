import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus, type AnomalyEvent } from '../src/core/EventBus.js';

/**
 * A complete event, built through one factory.
 *
 * `AnomalyEvent` has fourteen fields and two of them are string-literal unions, so an
 * object literal written at each call site widens `priority` to `string` and no longer
 * satisfies the type. That is what `tsc` found here once the tests were type-checked:
 * two tests asserting a real behaviour were passing objects the compiler says could not
 * exist. One factory is the fix, and it means a field added to the interface is a
 * compile error in one place rather than in however many literals there are.
 */
function event(overrides: Partial<AnomalyEvent> = {}): AnomalyEvent {
  return {
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
    ...overrides,
  };
}

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('should subscribe and receive events', () => {
    const handler = vi.fn();
    bus.subscribe('test.event', handler);

    bus.emit(event());

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should respect cooldowns', () => {
    const handler = vi.fn();
    bus.subscribe('test.event', handler);

    const e = event({ cooldown: 60 });
    bus.emit(e);
    bus.emit(e);

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
