export type Rarity = 'common' | 'uncommon' | 'rare' | 'very_rare' | 'legendary';

export type EventPriority = 'low' | 'normal' | 'high' | 'critical';

export interface AnomalyEvent {
  id: string;
  type: string;
  timestamp: number;
  source: string;
  payload: Record<string, unknown>;
  priority: EventPriority;
  rarity: Rarity;
  cooldown: number;
  duration: number;
  targetScene: string;
  seed: number;
  metadata: Record<string, unknown>;
}

export type EventHandler = (event: AnomalyEvent) => void;

export interface EventSubscription {
  id: string;
  type: string;
  handler: EventHandler;
  priority: number;
}

export class EventBus {
  private _subscriptions: Map<string, EventSubscription[]> = new Map();
  private _history: AnomalyEvent[] = [];
  private _cooldowns: Map<string, number> = new Map();
  private _idCounter = 0;

  subscribe(type: string, handler: EventHandler, priority = 0): () => void {
    const sub: EventSubscription = {
      id: `sub_${++this._idCounter}`,
      type,
      handler,
      priority,
    };

    const existing = this._subscriptions.get(type) ?? [];
    existing.push(sub);
    existing.sort((a, b) => b.priority - a.priority);
    this._subscriptions.set(type, existing);

    return () => this.unsubscribe(type, sub.id);
  }

  unsubscribe(type: string, subscriptionId: string): void {
    const subs = this._subscriptions.get(type);
    if (!subs) return;
    const idx = subs.findIndex(s => s.id === subscriptionId);
    if (idx >= 0) subs.splice(idx, 1);
  }

  emit(event: AnomalyEvent): void {
    if (!this._checkCooldown(event)) return;

    this._history.push(event);
    if (this._history.length > 1000) this._history.shift();

    this._cooldowns.set(event.type, Date.now() + event.cooldown * 1000);

    const subs = this._subscriptions.get(event.type);
    if (subs) {
      for (const sub of subs) {
        try {
          sub.handler(event);
        } catch (err) {
          console.error(`[EventBus] Handler error for ${event.type}:`, err);
        }
      }
    }

    const wildcardSubs = this._subscriptions.get('*');
    if (wildcardSubs) {
      for (const sub of wildcardSubs) {
        try {
          sub.handler(event);
        } catch (err) {
          console.error(`[EventBus] Wildcard handler error:`, err);
        }
      }
    }
  }

  private _checkCooldown(event: AnomalyEvent): boolean {
    const lastFired = this._cooldowns.get(event.type);
    if (lastFired === undefined) return true;
    return Date.now() >= lastFired;
  }

  getHistory(limit = 100): AnomalyEvent[] {
    return this._history.slice(-limit);
  }

  clearHistory(): void {
    this._history = [];
  }

  getActiveCooldowns(): Map<string, number> {
    return new Map(this._cooldowns);
  }
}
