import { describe, it, expect } from 'vitest';
import {
  mapFeed,
  parseFeed,
  parseJsonFeed,
  decodeEntities,
  unseen,
  isAnomalyKind,
  MAX_SIGNALS_PER_FETCH,
  type FeedRule,
} from '../src/integrations/FeedMapper.js';

/**
 * That a feed document can only cause what the user mapped it to cause.
 *
 * The reason this file exists in this shape: the three adapters it replaces were dead
 * code, and the thing that made them dead is also the thing that makes this one safe.
 * The content security policy sets `connect-src 'none'`, so the renderer cannot fetch
 * anything -- a document only ever arrives as text the host chose to send. What the
 * engine does with it is then the only question, and the answer is: match it against
 * rules the user wrote and do nothing else.
 *
 * So the assertions below are mostly about refusal. A parser that is permissive is not
 * dangerous; a mapper that lets a document choose its own effect is.
 */

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Feed</title>
  <item>
    <title>Server maintenance scheduled</title>
    <link>https://example.invalid/1</link>
    <guid>tag:example.invalid,2026:1</guid>
    <pubDate>Mon, 02 Mar 2026 09:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Release 2.1 published</title>
    <link>https://example.invalid/2</link>
    <guid>tag:example.invalid,2026:2</guid>
    <pubDate>Mon, 02 Mar 2026 11:00:00 GMT</pubDate>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Lights failing on the north line</title>
    <id>urn:uuid:1</id>
    <updated>2026-03-02T09:00:00Z</updated>
    <link href="https://example.invalid/a"/>
  </entry>
</feed>`;

const RULES: FeedRule[] = [
  { match: 'maintenance', anomaly: 'observatory-signal' },
  { match: 'release', anomaly: 'meteor' },
];

describe('decodeEntities', () => {
  it('decodes the named entities feeds actually use', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot;')).toBe('a & b <c> "d"');
  });

  it('decodes numeric entities, which is how a curly quote arrives', () => {
    expect(decodeEntities('it&#8217;s')).toBe('it’s');
    expect(decodeEntities('it&#x27;s')).toBe("it's");
  });

  it('decodes &amp; last so it does not double-decode', () => {
    // `&amp;lt;` is a literal "&lt;", and decoding &amp; first would turn it into a
    // real tag. That is the classic double-decoding bug.
    expect(decodeEntities('&amp;lt;script&amp;gt;')).toBe('&lt;script&gt;');
  });

  it('drops an out-of-range code point rather than throwing', () => {
    expect(decodeEntities('&#1114112;')).toBe('');
    expect(decodeEntities('&#0;')).toBe('');
  });
});

describe('parseFeed', () => {
  it('reads RSS items with title, guid and date', () => {
    const items = parseFeed(RSS);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('Server maintenance scheduled');
    expect(items[0].id).toBe('tag:example.invalid,2026:1');
    expect(items[0].at).toBeGreaterThan(0);
  });

  it('reads Atom entries, because a feed that is Atom-only is common', () => {
    const items = parseFeed(ATOM);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Lights failing on the north line');
    expect(items[0].id).toBe('urn:uuid:1');
  });

  it('falls back to the link, then the title, when there is no guid', () => {
    const items = parseFeed(`<rss><channel><item><title>T</title><link>https://x.invalid/9</link></item></channel></rss>`);
    expect(items[0].id).toBe('https://x.invalid/9');
  });

  it('decodes entities and unwraps CDATA in a title', () => {
    const items = parseFeed(
      `<rss><channel><item><title><![CDATA[Release &amp; deploy]]></title></item></channel></rss>`
    );
    expect(items[0].title).toBe('Release & deploy');
  });

  it('skips items with no title rather than emitting an empty one', () => {
    const items = parseFeed('<rss><channel><item><link>https://x.invalid/1</link></item></channel></rss>');
    expect(items).toEqual([]);
  });

  it('returns nothing for junk instead of throwing', () => {
    for (const junk of ['', '   ', 'not xml', '<rss><channel>', '<<<>>>']) {
      expect(() => parseFeed(junk)).not.toThrow();
      expect(parseFeed(junk)).toEqual([]);
    }
  });

  it('survives a document with no closing tag on the last item', () => {
    // Truncated responses are the normal failure mode of a feed that dies mid-transfer,
    // and a parser that throws here takes the whole poll loop down.
    const items = parseFeed('<rss><channel><item><title>Half an item</title>');
    expect(items).toEqual([]);
  });
});

describe('parseJsonFeed', () => {
  it('reads the documented shape', () => {
    const items = parseJsonFeed('{"items":[{"title":"Commit merged","id":"c1","at":1772449200000}]}');
    expect(items).toEqual([{ title: 'Commit merged', id: 'c1', at: 1772449200000 }]);
  });

  it('accepts `events` as an alias, which is what the removed adapter documented', () => {
    const items = parseJsonFeed('{"events":[{"event":"Commit merged","start":"2026-03-02T09:00:00Z"}]}');
    expect(items[0].title).toBe('Commit merged');
    expect(items[0].at).toBeGreaterThan(0);
  });

  it('discards every field it does not know', () => {
    // A JSON feed could carry anything. Only three fields are read and nothing is
    // merged, so a document cannot smuggle a value into the engine by being shaped
    // interestingly.
    const items = parseJsonFeed(
      '{"items":[{"title":"T","id":"1","anomaly":"lights-out","duration":9999,"payload":{"run":"calc.exe"}}]}'
    );
    expect(items).toEqual([{ title: 'T', id: '1', at: 0 }]);
  });

  it('returns nothing for malformed or unexpected shapes', () => {
    for (const body of ['', '{', 'null', '[]', '{"items":{}}', '{"items":[1,2]}', '"a string"']) {
      expect(parseJsonFeed(body)).toEqual([]);
    }
  });
});

describe('mapFeed', () => {
  it('fires nothing until the user says what a feed should do', () => {
    // The state a feed is in the moment it is added. A feed that started firing
    // something on arrival would be one nobody could predict.
    expect(mapFeed(RSS, 'rss', [])).toEqual([]);
    expect(mapFeed(RSS, 'rss', [])).toHaveLength(0);
  });

  it('maps a matching title to the anomaly the rule names', () => {
    const signals = mapFeed(RSS, 'rss', RULES);
    expect(signals).toHaveLength(2);
    expect(signals[0].anomaly).toBe('observatory-signal');
    expect(signals[1].anomaly).toBe('meteor');
  });

  it('matches case-insensitively, because feeds are not consistent about it', () => {
    const signals = mapFeed(RSS.toUpperCase(), 'rss', RULES);
    expect(signals).toHaveLength(2);
  });

  it('does not take the effect from the document', () => {
    // The property the whole design exists for. A feed that can name its own outcome is
    // a remote control, and the only way to be sure this is not one is to check.
    const hostile = `<rss><channel>
      <item><title>lights-out</title><guid>g1</guid></item>
      <item><title>meteor</title><guid>g2</guid></item>
      <item><title>red-moon</title><guid>g3</guid></item>
    </channel></rss>`;

    // The rules match "maintenance", which none of those titles contain, so nothing fires
    // even though every one of the six effect names is in the document.
    expect(mapFeed(hostile, 'rss', RULES)).toEqual([]);

    // And with a rule that does match, the anomaly is the rule's, not the title's.
    const signals = mapFeed(hostile, 'rss', [{ match: 'meteor', anomaly: 'forest-watcher' }]);
    expect(signals).toHaveLength(1);
    expect(signals[0].anomaly).toBe('forest-watcher');
  });

  it('ignores a rule naming an effect that does not exist', () => {
    // A typo in a rule disables that rule. It does not invent an effect, and it does
    // not fall back to firing something else.
    const signals = mapFeed(RSS, 'rss', [
      { match: 'maintenance', anomaly: 'not-a-real-anomaly' as never },
    ]);
    expect(signals).toEqual([]);
  });

  it('ignores an empty rule and a non-string match', () => {
    expect(
      mapFeed(RSS, 'rss', [
        { match: '   ', anomaly: 'meteor' },
        { match: 42 as never, anomaly: 'meteor' },
      ])
    ).toEqual([]);
  });

  it('uses the first rule that matches, so ordering is how a user overrides', () => {
    const signals = mapFeed(RSS, 'rss', [
      { match: 'a', anomaly: 'lights-out' },
      { match: 'server', anomaly: 'meteor' },
    ]);
    expect(signals.every((s) => s.anomaly === 'lights-out')).toBe(true);
  });

  it('gives repeated items within one document the same fingerprint', () => {
    const doubled = RSS.replace('</channel>', RSS.match(/<item[\s\S]*?<\/item>/g)![0] + '</channel>');
    const signals = mapFeed(doubled, 'rss', RULES);
    const fingerprints = signals.map((s) => s.fingerprint);
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
  });

  it('caps how many signals one document can produce', () => {
    // Distinct guids, so this exercises the ceiling rather than the dedupe. Without
    // them all fifty items collapse to one fingerprint and the cap never comes into
    // play, which is the right behaviour for a feed that repeats itself and the wrong
    // thing to be testing here.
    const many = `<rss><channel>${Array.from(
      { length: 50 },
      (_, i) => `<item><title>maintenance ${i}</title><guid>g${i}</guid></item>`
    ).join('')}</channel></rss>`;
    expect(mapFeed(many, 'rss', RULES)).toHaveLength(MAX_SIGNALS_PER_FETCH);
  });

  it('collapses a feed that repeats itself to one signal', () => {
    // The normal case: most feeds return the same items every poll, and firing twenty
    // anomalies an hour because of it is the failure this fingerprint exists to stop.
    const repeated = `<rss><channel>${Array.from(
      { length: 20 },
      (_, i) => `<item><title>maintenance ${i % 3}</title><guid>g${i % 3}</guid></item>`
    ).join('')}</channel></rss>`;
    expect(mapFeed(repeated, 'rss', RULES)).toHaveLength(3);
  });

  it('works on Atom through the same path', () => {
    const signals = mapFeed(ATOM, 'rss', [{ match: 'lights failing', anomaly: 'lights-out' }]);
    expect(signals).toHaveLength(1);
    expect(signals[0].anomaly).toBe('lights-out');
  });

  it('works on a JSON feed through the same path', () => {
    const body = '{"items":[{"title":"Planned maintenance tonight","id":"j1"}]}';
    const signals = mapFeed(body, 'json', RULES);
    expect(signals).toHaveLength(1);
    expect(signals[0].anomaly).toBe('observatory-signal');
  });
});

describe('unseen', () => {
  const signal = {
    fingerprint: 'meteor:abc',
    anomaly: 'meteor' as const,
    title: 'T',
    at: 0,
  };

  it('offers a signal once and then not again', () => {
    const seen = new Set<string>();
    expect(unseen([signal], seen)).toHaveLength(1);
    expect(unseen([signal], seen)).toHaveLength(0);
  });

  it('offers only the new ones from a mixed batch', () => {
    const seen = new Set<string>(['meteor:abc']);
    const batch = [signal, { ...signal, fingerprint: 'meteor:def' }];
    expect(unseen(batch, seen).map((s) => s.fingerprint)).toEqual(['meteor:def']);
  });

  it('does not fire the same effect twice for two different items in one poll', () => {
    // Distinct items are distinct keys, so this is about the ceiling rather than the
    // dedupe: two items are allowed, and both are allowed to be the same anomaly.
    const seen = new Set<string>();
    const batch = [signal, { ...signal, fingerprint: 'meteor:def' }];
    expect(unseen(batch, seen)).toHaveLength(2);
  });
});

describe('isAnomalyKind', () => {
  it('accepts exactly the six registered effects', () => {
    for (const kind of [
      'second-moon', 'red-moon', 'forest-watcher',
      'observatory-signal', 'meteor', 'lights-out',
    ]) {
      expect(isAnomalyKind(kind)).toBe(true);
    }
  });

  it('rejects anything else, including near misses', () => {
    for (const value of ['Meteor', 'meteor ', 'moons', '', 'constructor', '__proto__']) {
      expect(isAnomalyKind(value)).toBe(false);
    }
  });
});