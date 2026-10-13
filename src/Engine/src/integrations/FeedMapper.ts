import type { AnomalyKind } from '../renderer/WorldRenderer.js';

/**
 * Turns a feed document into signals the engine can act on.
 *
 * Everything here is a pure function over a string. That is the whole design, and it is
 * a change of approach from what it replaces: `GitHubSource`, `RSSSource` and
 * `RemoteEventSource` each held their own `fetch`, their own timer and their own parser,
 * none of them could be constructed in a test without a network or a DOM, and the
 * content security policy blocks `fetch` from the page anyway -- so all three were
 * unreachable code and three exemptions in the dead-code gate. They have been deleted.
 *
 * The host fetches; this file decides what a fetched document *means*. Splitting it that
 * way is also what makes the security property checkable: the renderer has no network
 * access at all, so everything it learns arrives as text over a channel it cannot write
 * to, and the only thing it will do with that text is match it against rules the user
 * wrote.
 */

/** The document formats understood. */
export type FeedKind = 'rss' | 'json';

/**
 * What a feed may cause, and when.
 *
 * A rule maps a substring of an item's title onto one anomaly. That is the *entire*
 * vocabulary: a feed cannot supply a command, a duration, an opacity, a colour or a
 * payload, because those are not in the type. `anomaly` is checked against the six
 * registered kinds on the way in, so a typo in a rule disables that rule rather than
 * inventing an effect.
 */
export interface FeedRule {
  /** Case-insensitive substring of the item title. */
  match: string;
  /** One of the six registered anomaly kinds. */
  anomaly: AnomalyKind;
}

/** One thing worth showing the user. */
export interface RemoteSignal {
  /**
   * Stable across identical polls.
   *
   * This is the deduplication key, and it is deliberately derived from the item's own
   * identity rather than from a timestamp: a feed that returns the same twenty items
   * every hour would otherwise fire twenty anomalies on every poll.
   */
  fingerprint: string;
  /** Which effect to run. Always one of the six; never anything a document supplied. */
  anomaly: AnomalyKind;
  /** The item's title, for the log and the journal. Never rendered as markup. */
  title: string;
  /** Milliseconds since the epoch, from the document where it has one. */
  at: number;
}

/** The six effects, mirrored from the renderer's union. */
const ANOMALY_KINDS: readonly AnomalyKind[] = [
  'second-moon',
  'red-moon',
  'forest-watcher',
  'observatory-signal',
  'meteor',
  'lights-out',
];

/** Whether a string names a registered effect. Exported for the settings window's check. */
export function isAnomalyKind(value: string): value is AnomalyKind {
  return (ANOMALY_KINDS as readonly string[]).includes(value);
}

/** Ceiling on signals from one document. A feed cannot flood the scheduler. */
export const MAX_SIGNALS_PER_FETCH = 5;

/* ------------------------------------------------------------------- parsing -- */

/**
 * Decodes the XML entities that appear in real feeds.
 *
 * Numeric forms included because `&#8217;` is how a right single quote reaches a feed
 * and leaving it in produces "it&#8217;s" on the desktop, which looks like a bug.
 */
export function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const n = parseInt(code, 16);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    })
    .replace(/&amp;/g, '&');
}

/** One parsed item, before any rule is applied. */
export interface FeedItem {
  title: string;
  /** Stable id if the feed has one, otherwise derived from the title. */
  id: string;
  at: number;
}

function unwrap(inner: string): string {
  return decodeEntities(inner.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim();
}

function tag(block: string, name: string): string | null {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return match ? unwrap(match[1]) : null;
}

/**
 * Parses RSS 2.0 or Atom into items.
 *
 * Both, because a feed that is Atom-only is common enough that supporting only RSS would
 * make this useless against real feeds. Not a general XML parser and not trying to be:
 * it reads the six fields this needs and ignores the rest, which is also what keeps a
 * hostile document from becoming a denial-of-service via a billion-laughs entity.
 */
export function parseFeed(body: string): FeedItem[] {
  const trimmed = body.trim();
  if (!trimmed) return [];

  const items: FeedItem[] = [];

  const rssItems = trimmed.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  for (const block of rssItems) {
    const title = tag(block, 'title');
    if (!title) continue;
    const dateText = tag(block, 'pubDate') ?? tag(block, 'dc:date');
    items.push({
      title,
      id: tag(block, 'guid') ?? tag(block, 'link') ?? title,
      at: dateText ? Date.parse(dateText) || 0 : 0,
    });
  }
  if (items.length) return items;

  const atomEntries = trimmed.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  for (const block of atomEntries) {
    const title = tag(block, 'title');
    if (!title) continue;
    const id = tag(block, 'id') ?? title;
    const link = /<link[^>]*href="([^"]+)"/i.exec(block)?.[1];
    const updated = tag(block, 'updated') ?? tag(block, 'published');
    items.push({
      title,
      id,
      at: updated ? Date.parse(updated) || 0 : 0,
    });
    void link;
  }
  return items;
}

/**
 * Reads a plain JSON feed.
 *
 * The expected shape is `{"items": [{"title": "...", "id": "...", "at": 0}]}`, with
 * `events` accepted as an alias because that is what the removed
 * `RemoteEventSource` documented and a feed written against it should keep working.
 *
 * A JSON feed could carry anything. It is parsed strictly -- only these three fields are
 * read, from each element, and anything else is discarded rather than merged -- so a
 * document cannot smuggle a field into the engine by being shaped interestingly.
 */
export function parseJsonFeed(body: string): FeedItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }

  const container = parsed as { items?: unknown; events?: unknown };
  const list = Array.isArray(container?.items)
    ? container.items
    : Array.isArray(container?.events)
      ? container.events
      : null;
  if (!list) return [];

  const items: FeedItem[] = [];
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const title = record.title ?? record.event ?? record.name;
    if (typeof title !== 'string' || !title.trim()) continue;

    const id = typeof record.id === 'string' && record.id ? record.id : title;
    const at =
      typeof record.at === 'number'
        ? record.at
        : typeof record.start === 'string'
          ? Date.parse(record.start) || 0
          : 0;

    items.push({ title: title.trim(), id, at });
  }
  return items;
}

/* ------------------------------------------------------------------- mapping -- */

/**
 * Applies the user's rules to a parsed feed.
 *
 * The property that matters, and the reason this function is written the way it is:
 * **the anomaly comes from the rule, never from the document.** A feed whose title is
 * "lights-out" does not cause a lights-out; it causes whatever the user mapped the
 * string "lights-out" to, which may be nothing at all. That is the difference between a
 * feed and a remote control.
 */
export function mapFeed(body: string, kind: FeedKind, rules: FeedRule[]): RemoteSignal[] {
  const usable = rules.filter(
    (rule): rule is FeedRule =>
      typeof rule?.match === 'string' &&
      rule.match.trim().length > 0 &&
      isAnomalyKind(rule.anomaly)
  );
  // No usable rules means no signals, which is the state a feed is in until somebody
  // says what it should do. A feed that fires something the moment it is added is a
  // feed nobody can predict.
  if (usable.length === 0) return [];

  const items = kind === 'json' ? parseJsonFeed(body) : parseFeed(body);

  const signals: RemoteSignal[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (signals.length >= MAX_SIGNALS_PER_FETCH) break;

    const haystack = item.title.toLowerCase();
    const rule = usable.find((r) => haystack.includes(r.match.toLowerCase()));
    if (!rule) continue;

    // The fingerprint is derived from the item's own identity. Two polls of the same
    // feed produce the same key, which is what stops it firing every interval; two
    // different items do not collide.
    const fingerprint = `${rule.anomaly}:${item.id}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    signals.push({
      fingerprint,
      anomaly: rule.anomaly,
      title: item.title,
      at: item.at || Date.now(),
    });
  }

  return signals;
}

/**
 * Filters out fingerprints already seen.
 *
 * Kept separate from `mapFeed` so that *what is new* is a question about the engine's
 * history rather than about the document, and so the same parsed feed can be offered to
 * a caller that wants all of it (a panel listing) as well as to one that wants only what
 * it has not shown yet.
 */
export function unseen(signals: RemoteSignal[], seen: Set<string>): RemoteSignal[] {
  const fresh: RemoteSignal[] = [];
  for (const signal of signals) {
    if (seen.has(signal.fingerprint)) continue;
    seen.add(signal.fingerprint);
    fresh.push(signal);
  }
  return fresh;
}