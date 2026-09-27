import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../../src/core/EventBus.js';
import { EventScheduler } from '../../src/core/EventScheduler.js';

describe('EventScheduler', () => {
  let bus: EventBus;
  let scheduler: EventScheduler;

  beforeEach(() => {
    bus = new EventBus();
    scheduler = new EventScheduler(bus);
  });

  it('should add and remove events', () => {
    scheduler.addEvent({
      id: 'test',
      cron: '* * * * *',
      eventType: 'test.event',
      payload: {},
      enabled: true,
    });

    scheduler.removeEvent('test');
  });

  it('should match cron patterns', () => {
    const handler = vi.fn();
    bus.subscribe('test.event', handler);

    scheduler.addEvent({
      id: 'test',
      cron: '* * * * *',
      eventType: 'test.event',
      payload: {},
      enabled: true,
    });

    scheduler.start();

    return new Promise((resolve) => {
      setTimeout(() => {
        scheduler.stop();
        expect(handler).toHaveBeenCalled();
        resolve(undefined);
      }, 1100);
    });
  });
});
