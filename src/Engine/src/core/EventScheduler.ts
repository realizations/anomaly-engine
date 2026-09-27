import { EventBus } from './EventBus.js';

export interface ScheduledEvent {
  id: string;
  cron: string;
  eventType: string;
  payload: Record<string, unknown>;
  enabled: boolean;
  lastFired?: number;
}

export class EventScheduler {
  private _events: ScheduledEvent[] = [];
  private _timer: number | null = null;
  private _bus: EventBus;
  private _running = false;

  constructor(bus: EventBus) {
    this._bus = bus;
  }

  start(): void {
    if (this._running) return;
    this._running = true;
    this._timer = window.setInterval(() => this._tick(), 1000);
  }

  stop(): void {
    this._running = false;
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  addEvent(event: ScheduledEvent): void {
    this._events.push(event);
  }

  removeEvent(id: string): void {
    this._events = this._events.filter(e => e.id !== id);
  }

  private _tick(): void {
    const now = new Date();
    for (const evt of this._events) {
      if (!evt.enabled) continue;
      if (this._shouldFire(evt.cron, now)) {
        evt.lastFired = now.getTime();
        this._bus.emit({
          id: `sched_${evt.id}_${now.getTime()}`,
          type: evt.eventType,
          timestamp: now.getTime(),
          source: 'scheduler',
          payload: evt.payload,
          priority: 'normal',
          rarity: 'common',
          cooldown: 0,
          duration: 0,
          targetScene: 'main',
          seed: now.getTime(),
          metadata: { scheduled: true },
        });
      }
    }
  }

  private _shouldFire(cron: string, now: Date): boolean {
    const parts = cron.split(' ');
    if (parts.length !== 5) return false;

    const [min, hour, day, month, dow] = parts;
    return (
      this._match(min, now.getMinutes()) &&
      this._match(hour, now.getHours()) &&
      this._match(day, now.getDate()) &&
      this._match(month, now.getMonth() + 1) &&
      this._match(dow, now.getDay())
    );
  }

  private _match(pattern: string, value: number): boolean {
    if (pattern === '*') return true;
    if (pattern === String(value)) return true;
    if (pattern.includes(',')) {
      return pattern.split(',').some(p => this._match(p.trim(), value));
    }
    if (pattern.includes('/')) {
      const [range, step] = pattern.split('/');
      const stepNum = parseInt(step, 10);
      if (range === '*') return value % stepNum === 0;
    }
    if (pattern.includes('-')) {
      const [start, end] = pattern.split('-').map(Number);
      return value >= start && value <= end;
    }
    return false;
  }
}
