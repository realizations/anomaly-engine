import { EventBus } from '../core/EventBus.js';
import type { Rarity } from '../core/EventBus.js';

interface RandomEventDef {
  type: string;
  rarity: Rarity;
  payload: Record<string, unknown>;
  cooldown: number;
  duration: number;
}

const RARITY_WEIGHTS: Record<Rarity, number> = {
  common: 70,
  uncommon: 20,
  rare: 8,
  very_rare: 1.8,
  legendary: 0.2,
};

const EVENT_DEFS: RandomEventDef[] = [
  { type: 'random.cloud_shift', rarity: 'common', payload: { direction: 'east' }, cooldown: 300, duration: 60 },
  { type: 'random.bird_flyby', rarity: 'common', payload: { count: 3 }, cooldown: 600, duration: 15 },
  { type: 'random.leaves_blow', rarity: 'common', payload: { intensity: 0.5 }, cooldown: 300, duration: 30 },
  { type: 'random.distant_light', rarity: 'uncommon', payload: { location: 'cabin' }, cooldown: 1800, duration: 20 },
  { type: 'random.radio_static', rarity: 'uncommon', payload: { frequency: 73.4 }, cooldown: 3600, duration: 15 },
  { type: 'random.meteor', rarity: 'rare', payload: { brightness: 0.8 }, cooldown: 7200, duration: 5 },
  { type: 'random.observatory_flash', rarity: 'rare', payload: {}, cooldown: 14400, duration: 10 },
  { type: 'random.lights_out', rarity: 'rare', payload: {}, cooldown: 14400, duration: 10 },
  { type: 'random.second_moon', rarity: 'very_rare', payload: { duration: 8 }, cooldown: 86400, duration: 8 },
  { type: 'random.forest_creature', rarity: 'very_rare', payload: { type: 'deer' }, cooldown: 43200, duration: 12 },
  { type: 'random.red_moon', rarity: 'legendary', payload: {}, cooldown: 604800, duration: 300 },
];

export class RandomSource {
  private _bus: EventBus;
  private _timer: number | null = null;
  private _recentTypes: string[] = [];

  constructor(bus: EventBus) {
    this._bus = bus;
  }

  start(): void {
    this._timer = window.setInterval(() => this._maybeFire(), 30000);
  }

  stop(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  private _maybeFire(): void {
    const roll = Math.random() * 100;
    let cumulative = 0;
    let selectedRarity: Rarity = 'common';

    for (const [rarity, weight] of Object.entries(RARITY_WEIGHTS)) {
      cumulative += weight;
      if (roll <= cumulative) {
        selectedRarity = rarity as Rarity;
        break;
      }
    }

    const candidates = EVENT_DEFS.filter(e =>
      e.rarity === selectedRarity && !this._recentTypes.includes(e.type)
    );

    if (candidates.length === 0) return;

    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    this._recentTypes.push(chosen.type);
    if (this._recentTypes.length > 5) this._recentTypes.shift();

    this._bus.emit({
      id: `random_${chosen.type}_${Date.now()}`,
      type: chosen.type,
      timestamp: Date.now(),
      source: 'random',
      payload: chosen.payload,
      priority: 'normal',
      rarity: chosen.rarity,
      cooldown: chosen.cooldown,
      duration: chosen.duration,
      targetScene: 'main',
      seed: Date.now(),
      metadata: { random: true },
    });
  }
}
