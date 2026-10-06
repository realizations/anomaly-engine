import { EventBus } from '../core/EventBus.js';

/**
 * A calendar day as `YYYY-MM-DD` in local time.
 *
 * Exported because "three consecutive nights at 03:33" is a statement about days, not
 * about milliseconds, and every consumer that needs to compare nights needs this
 * exact same string rather than its own idea of how to format a date.
 */
export function dateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export class ClockSource {
  private _bus: EventBus;
  private _timer: number | null = null;
  private _lastHour = -1;
  private _lastMinute = -1;

  constructor(bus: EventBus) {
    this._bus = bus;
  }

  start(): void {
    this._timer = window.setInterval(() => this._tick(), 1000);
  }

  stop(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  private _tick(): void {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();

    if (hour !== this._lastHour) {
      this._lastHour = hour;
      this._emitHourly(hour);
    }

    if (minute !== this._lastMinute) {
      this._lastMinute = minute;
      this._checkSpecialTimes(now);
    }
  }

  private _emitHourly(hour: number): void {
    this._bus.emit({
      id: `clock_hourly_${Date.now()}`,
      type: 'time.hourly',
      timestamp: Date.now(),
      source: 'clock',
      payload: { hour, period: this._getPeriod(hour) },
      priority: 'low',
      rarity: 'common',
      cooldown: 0,
      duration: 0,
      targetScene: 'main',
      seed: Date.now(),
      metadata: {},
    });
  }

  private _checkSpecialTimes(now: Date): void {
    const h = now.getHours();
    const m = now.getMinutes();

    if (h === 3 && m === 33) {
      this._bus.emit({
        id: 'clock_0333',
        type: 'time.0333',
        timestamp: Date.now(),
        source: 'clock',
        // The calendar date this reading was taken on.
        //
        // The `0333-stare` egg is "3:33 x3" -- three *consecutive nights* -- which is
        // not expressible from a bare timestamp without the consumer re-deriving the
        // date in its own local zone and hoping it agrees with the clock's. Carrying
        // the day in the payload makes the streak arithmetic exact and testable, and
        // it also distinguishes a second reading in the same minute from a second
        // night, which a timestamp alone cannot.
        payload: { dateKey: dateKey(now) },
        priority: 'high',
        rarity: 'very_rare',
        cooldown: 86400,
        duration: 30,
        targetScene: 'main',
        seed: Date.now(),
        metadata: { special: true },
      });
    }

    if (h === 0 && m === 0) {
      this._bus.emit({
        id: 'clock_midnight',
        type: 'time.midnight',
        timestamp: Date.now(),
        source: 'clock',
        payload: {},
        priority: 'normal',
        rarity: 'uncommon',
        cooldown: 86400,
        duration: 60,
        targetScene: 'main',
        seed: Date.now(),
        metadata: {},
      });
    }
  }

  private _getPeriod(hour: number): string {
    if (hour >= 5 && hour < 8) return 'dawn';
    if (hour >= 8 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 20) return 'dusk';
    if (hour >= 20 && hour < 23) return 'evening';
    return 'night';
  }
}
