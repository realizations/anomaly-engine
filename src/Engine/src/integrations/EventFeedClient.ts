import { mapFeed, unseen, type FeedKind, type FeedRule, type RemoteSignal } from './FeedMapper.js';

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
      return [];
    }

    const feed = this._feeds.find((f) => f.id === feedId);
    if (!feed) return [];
    if (!body) return [];

    let signals: RemoteSignal[];
    try {
      signals = mapFeed(body, feed.kind, feed.rules);
    } catch (e) {
      this._lastError = `${feedId}: ${e instanceof Error ? e.message : String(e)}`;
      return [];
    }

    // Returned rather than emitted through a listener. The caller is already inside the
    // handler that received the body, so a second delivery route to the same place would
    // be two ways to be wrong: `receive` returning the signals cannot fire something the
    // caller forgot to look at, and cannot fire it twice.
    const fresh = unseen(signals, this._seen);
    if (fresh.length > 0) this._firedFeeds.add(feedId);
    return fresh;
  }

  getState(): FeedClientState {
    return {
      active: this._active,
      configured: this._feeds.length,
      enabled: this._feeds.filter((f) => f.enabled).length,
      fired: this._firedFeeds.size,
      lastError: this._lastError,
      lastPolled: { ...this._lastPolled },
    };
  }

  dispose(): void {
    this._seen.clear();
    this._firedFeeds.clear();
    this._feeds = [];
    this._active = false;
  }
}