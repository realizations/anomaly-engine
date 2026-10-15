import {
  mapItems,
  parseItems,
  unseen,
  type FeedKind,
  type FeedRule,
  type RemoteSignal,
} from './FeedMapper.js';

/**
 * Polls configured feeds and turns what comes back into anomalies.
 *
 * The polling here is *request scheduling*, not fetching. Every byte arrives from the
 * host over a web message, because the renderer cannot make network requests at all: the
 * content security policy sets `connect-src 'none'`, and that is a feature rather than an
 * obstacle. It is why a feed in this engine cannot phone anywhere the user did not name,
 * and why this file never contains a URL fetch.
 *
 * What replaces the three adapters this grew out of is worth stating, because it is the
 * whole reason they were deleted: each held its own `fetch`, its own `setInterval` and
 * its own parser, so each was untestable, and each was dead. One request scheduler and
 * one pure mapper are both checkable.
 */

/** One configured feed, as the settings window holds it. */
export interface FeedConfig {
  /** Stable local id, assigned by the engine. Never taken from the document. */
  id: string;
  url: string;
  kind: FeedKind;
  /** Seconds between polls. Floored by the host and by this class. */
  intervalSeconds: number;
  enabled: boolean;
  /** What this feed is allowed to cause. Empty means it causes nothing. */
  rules: FeedRule[];
}

export interface FeedClientState {
  /** Whether polling is running at all. */
  active: boolean;
  /** Feeds configured, enabled or not. */
  configured: number;
  enabled: number;
  /** Feeds that have produced at least one signal this session. */
  fired: number;
  /** The last failure from any feed, for the panel and the log. */
  lastError: string | null;
  /** When each feed was last asked for, so the panel can show it. */
  lastPolled: Record<string, number>;
  /** Per-feed health, so a card can say what happened rather than only that it exists. */
  health: Record<string, FeedHealth>;
}

/**
 * What one feed has actually done, as opposed to how it is configured.
 *
 * Every field is something the engine observed, never something it inferred. A feed that
 * has answered with nothing for an hour and a feed that has never been asked look
 * identical in the config, and telling them apart is the whole point of a health line:
 * "it is silent" and "it is broken" should not look the same to the person who has to
 * decide which one it is.
 */
export interface FeedHealth {
  /** Milliseconds since the epoch the host was last asked, or null. */
  lastPolled: number | null;
  /** Milliseconds since the epoch of the last successful answer, or null. */
  lastOk: number | null;
  /** The last failure, cleared by the next success. */
  lastError: string | null;
  /** Items the last successful document contained. */
  items: number;
  /** Signals those items matched, before deduplication. */
  matched: number;
  /** Signals that were new and therefore actually fired. */
  fired: number;
}

/**
 * Minimum seconds between two requests to the same feed.
 *
 * Enforced here as well as on the host, because the host only sees requests that arrive:
 * a renderer bug that asked a thousand times a second would otherwise be a denial of
 * service pointed at somebody else's server, signed with the user's IP.
 */
export const MIN_INTERVAL_SECONDS = 60;

/** Ceiling on configured feeds. A desktop wallpaper is not a feed reader. */
export const MAX_FEEDS = 8;

export class EventFeedClient {
  private _feeds: FeedConfig[] = [];
  private _active = false;

  /**
   * Fingerprints already acted on, so a repeated poll does not re-fire.
   *
   * Per session rather than persisted, which means a feed that publishes the same item id
   * forever is silent for the rest of that session after the first sighting. That is the
   * right way round: the alternative is a set of ids growing for as long as the engine
   * runs, and a wallpaper is a thing people leave open for weeks.
   */
  private _seen = new Set<string>();

  private _firedFeeds = new Set<string>();
  private _lastPolled: Record<string, number> = {};
  private _health: Record<string, FeedHealth> = {};
  private _lastError: string | null = null;

  /**
   * How the host is asked, and what time it is.
   *
   * Both injected rather than imported so a test can drive the whole loop without a
   * host and without waiting an hour for a second poll. The direction of the channel is
   * the point of the first one: the renderer asks, the host answers, and this class never
   * learns where the bytes came from.
   *
   * Constructor arguments rather than setters because a setter for each would be two more
   * public methods that exist only for tests.
   */
  constructor(
    private _request: (feedId: string) => void = () => {},
    private _now: () => number = () => Date.now()
  ) {}

  getFeeds(): FeedConfig[] {
    return this._feeds.map((f) => ({ ...f, rules: f.rules.map((r) => ({ ...r })) }));
  }

  /**
   * Replaces the configured feeds.
   *
   * Replacing rather than merging, so a feed deleted in the settings window is actually
   * gone. Merging is how a removed endpoint keeps being polled from memory.
   *
   * The seen-history is cleared here, and that is load-bearing rather than tidy. A user
   * who changes a rule has changed what the ids mean, so items already in the feed should
   * be allowed to fire under the new rule instead of sitting silent because those ids
   * were seen before the rule existed.
   */
  setFeeds(feeds: FeedConfig[]): void {
    this._feeds = feeds.slice(0, MAX_FEEDS).map((f) => ({
      ...f,
      intervalSeconds: Math.max(MIN_INTERVAL_SECONDS, f.intervalSeconds || MIN_INTERVAL_SECONDS),
      rules: Array.isArray(f.rules) ? f.rules.filter((r) => typeof r?.match === 'string') : [],
    }));
    this._seen.clear();
    this._firedFeeds.clear();

    // Health is pruned rather than cleared. Every rule edit goes through here, so
    // clearing it would wipe the "last checked" line each time the user typed in the
    // editor -- the one moment they most want to see it. A feed that is gone loses its
    // entry; a feed that is still configured keeps its history.
    const ids = new Set(this._feeds.map((f) => f.id));
    for (const id of Object.keys(this._health)) if (!ids.has(id)) delete this._health[id];
    for (const id of Object.keys(this._lastPolled)) if (!ids.has(id)) delete this._lastPolled[id];
  }

  start(): void {
    this._active = true;
  }

  stop(): void {
    this._active = false;
  }

  /**
   * Whether each feed is due, and asks for those that are.
   *
   * Driven from the render loop by the caller rather than by a timer of its own, for the
   * same reason the media transport is: a timer keeps running while the wallpaper is
   * paused, so the first frame after resuming would fire every poll that had accumulated
   * and the host would see a burst of requests.
   */
  poll(): string[] {
    if (!this._active) return [];
    const now = this._now();
    const due: string[] = [];

    for (const feed of this._feeds) {
      if (!feed.enabled) continue;
      const last = this._lastPolled[feed.id] ?? 0;
      if (now - last < feed.intervalSeconds * 1000) continue;
      this._lastPolled[feed.id] = now;
      this._recordHealth(feed.id, { lastPolled: now });
      due.push(feed.id);
    }

    for (const id of due) this._request(id);
    return due;
  }

  /**
   * Feeds the host's answer back in.
   *
   * Returns the signals that were new, which is what the caller fires. A malformed or
   * oversized body produces an error and no signals rather than an exception, because
   * this is called from an event handler and an exception there would take the page's
   * message loop with it.
   */
  receive(feedId: string, body: string | null, error?: string | null): RemoteSignal[] {
    if (error) {
      this._lastError = `${feedId}: ${error}`;
      this._recordHealth(feedId, { lastError: error, items: 0, matched: 0, fired: 0 });
      return [];
    }

    const feed = this._feeds.find((f) => f.id === feedId);
    if (!feed) return [];
    if (!body) {
      this._lastError = `${feedId}: the host returned no document`;
      this._recordHealth(feedId, { lastError: 'the host returned no document', items: 0, matched: 0, fired: 0 });
      return [];
    }

    // Parsed once and mapped from the result, rather than mapped and parsed again to
    // count. `mapFeed` is the same two steps in one call; the split is what lets the
    // health line report "twelve items, none matched" instead of only "checked".
    let items;
    let signals: RemoteSignal[];
    try {
      items = parseItems(feed.kind, body);
      signals = mapItems(items, feed.rules);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this._lastError = `${feedId}: ${message}`;
      this._recordHealth(feedId, { lastError: message, items: 0, matched: 0, fired: 0 });
      return [];
    }

    // Returned rather than emitted through a listener. The caller is already inside the
    // handler that received the body, so a second delivery route to the same place would
    // be two ways to be wrong: `receive` returning the signals cannot fire something the
    // caller forgot to look at, and cannot fire it twice.
    const fresh = unseen(signals, this._seen);
    if (fresh.length > 0) this._firedFeeds.add(feedId);
    this._recordHealth(feedId, {
      lastOk: this._now(),
      lastError: null,
      items: items.length,
      matched: signals.length,
      fired: fresh.length,
    });
    return fresh;
  }

  /**
   * Merges one observation into a feed's health, keeping whatever is not being replaced.
   *
   * A success clears the error but must not clear the last-poll timestamp, and a failure
   * must not clear the last-success timestamp: "last worked 3 minutes ago, failing since"
   * is exactly the pair that tells a user their server changed.
   */
  private _recordHealth(feedId: string, patch: Partial<FeedHealth>): void {
    const prev = this._health[feedId];
    this._health[feedId] = {
      lastPolled: prev?.lastPolled ?? this._lastPolled[feedId] ?? null,
      lastOk: prev?.lastOk ?? null,
      lastError: prev?.lastError ?? null,
      items: prev?.items ?? 0,
      matched: prev?.matched ?? 0,
      fired: prev?.fired ?? 0,
      ...patch,
    };
  }

  getState(): FeedClientState {
    return {
      active: this._active,
      configured: this._feeds.length,
      enabled: this._feeds.filter((f) => f.enabled).length,
      fired: this._firedFeeds.size,
      lastError: this._lastError,
      lastPolled: { ...this._lastPolled },
      // Copies, so a caller holding the status document cannot mutate the map a later
      // poll reads from. The status document is polled once a second.
      health: Object.fromEntries(Object.entries(this._health).map(([id, h]) => [id, { ...h }])),
    };
  }

  dispose(): void {
    this._seen.clear();
    this._firedFeeds.clear();
    this._health = {};
    this._lastPolled = {};
    this._feeds = [];
    this._active = false;
  }
}