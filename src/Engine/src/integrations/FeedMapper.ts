import type { AnomalyKind } from '../anomalies/effects.js';
import { isAnomalyKind } from '../anomalies/effects.js';

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

/**
 * The effects a feed may cause come from the one registry, not from a copy kept here.
 *
 * This module used to declare its own `ANOMALY_KINDS` array, described as "mirrored from
 * the renderer's union", and the only thing keeping the two honest was a gate that
 * compared them by regex. One registry is strictly better than a gate: a mirror can
 * drift and be caught, a derivation cannot drift at all.
 *
 * `isAnomalyKind` is re-exported so existing importers and the settings window have one
 * function to ask, rather than each importing the registry directly and forming a habit
 * that slowly unpicks the mapper's own boundary.
 */
export { isAnomalyKind };

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

/**
 * Parses a document into items, dispatching on the declared format.
 *
 * Exists so that the format question is answered in one place. Three callers need it
 * now -- the poll loop, the offline document tester, and the feed client's own health
 * bookkeeping -- and three copies of `kind === 'json' ? json : xml` is three places a
 * third format would have to be added.
 */
export function parseItems(kind: FeedKind, body: string): FeedItem[] {
  return kind === 'json' ? parseJsonFeed(body) : parseFeed(body);
}

/* ------------------------------------------------------------------- mapping -- */

/**
 * The one place a headline is tested against a rule.
 *
 * Shared by the poll loop and by the settings window's mapping tester, which is the
 * reason it is a function rather than two loops. A tester that answered a different
 * question from the one the engine actually asks would be worse than no tester: it
 * would confirm a mapping and then not fire it.
 *
 * A rule is *usable* only if it names an effect in the registry. This is checked here as
 * well as on the way in, so both callers refuse the same rules -- and a rule naming an
 * effect the renderer cannot draw matches nothing rather than falling through to the
 * next rule. The matching is a case-insensitive substring, which is the documented
 * semantics and the thing the rule editor describes in words.
 */
export function matchHeadline(headline: string, rules: FeedRule[]): FeedRule | null {
  if (!Array.isArray(rules) || rules.length === 0) return null;
  if (typeof headline !== 'string') return null;

  const haystack = headline.toLowerCase();
  for (const rule of rules) {
    if (typeof rule?.match !== 'string' || rule.match.trim().length === 0) continue;
    if (!isAnomalyKind(rule.anomaly)) continue;
    if (haystack.includes(rule.match.toLowerCase())) return rule;
  }
  return null;
}

/**
 * Applies the user's rules to items that have already been parsed.
 *
 * The property that matters, and the reason this function is written the way it is:
 * **the anomaly comes from the rule, never from the document.** A feed whose title is
 * "lights-out" does not cause a lights-out; it causes whatever the user mapped the
 * string "lights-out" to, which may be nothing at all. That is the difference between a
 * feed and a remote control.
 *
 * Split from parsing so an item list can be mapped once and also counted, rather than
 * parsed twice to answer "what does it mean" and "how much of it was there".
 */
export function mapItems(items: FeedItem[], rules: FeedRule[]): RemoteSignal[] {
  // No usable rules means no signals, which is the state a feed is in until somebody
  // says what it should do. A feed that fires something the moment it is added is a
  // feed nobody can predict.
  if (!Array.isArray(items) || !Array.isArray(rules) || rules.length === 0) return [];

  const signals: RemoteSignal[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (signals.length >= MAX_SIGNALS_PER_FETCH) break;

    const rule = matchHeadline(item.title, rules);
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

/** Parses a document and applies the user's rules to it. The poll loop's whole job. */
export function mapFeed(body: string, kind: FeedKind, rules: FeedRule[]): RemoteSignal[] {
  return mapItems(parseItems(kind, body), rules);
}

/** Ceiling on preview matches, so trying a large document stays a summary. */
export const MAX_PREVIEW_MATCHES = 12;

/** One rule that a document would have triggered, and the words that matched. */
export interface PreviewMatch {
  feedId: string;
  match: string;
  anomaly: AnomalyKind;
  title: string;
}

/**
 * What a document would cause, against every configured feed's rules, without firing.
 *
 * The offline half of the feature. No feed, no request, no host involvement past the file
 * dialog: the document is parsed by the same functions the poll loop uses and matched by
 * the same `matchHeadline`, so what this reports is what a real poll of a feed with those
 * rules would do. It is a way to check a rule before pointing the engine at a server, not
 * a second opinion about what the server would send.
 *
 * A feed that is disabled is still tested, because the question a preview answers is
 * "would my rules match this", and a user tuning a rule has usually not enabled the feed
 * yet -- enabling a feed you have not checked is the thing this exists to prevent.
 */
export function previewDocument(
  kind: FeedKind,
  body: string,
  feeds: ReadonlyArray<{ id: string; rules: FeedRule[] }>
): { items: number; matches: PreviewMatch[] } {
  if (typeof body !== 'string' || body.trim().length === 0) return { items: 0, matches: [] };

  const items = parseItems(kind, body);
  if (!Array.isArray(feeds) || feeds.length === 0) return { items: items.length, matches: [] };

  const matches: PreviewMatch[] = [];

  for (const feed of feeds) {
    for (const item of items) {
      if (matches.length >= MAX_PREVIEW_MATCHES) return { items: items.length, matches };
      const rule = matchHeadline(item.title, feed.rules);
      if (!rule || !isAnomalyKind(rule.anomaly)) continue;
      matches.push({ feedId: feed.id, match: rule.match, anomaly: rule.anomaly, title: item.title });
    }
  }

  return { items: items.length, matches };
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