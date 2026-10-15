import { describe, it, expect, beforeEach } from 'vitest';
import { EventFeedClient, MIN_INTERVAL_SECONDS, type FeedConfig } from '../src/integrations/EventFeedClient.js';

/**
 * The poll loop, driven without a host and without waiting an hour.
 *
 * `EventFeedClient` takes its clock and its request channel as constructor arguments
 * precisely so this file can exist, and until now nothing used it. That is the kind of
 * gap that matters: the loop decides *when* the engine is allowed to ask somebody else's
 * server for a document, and the dedupe decides whether a feed that never changes fires
 * once or on every poll. Both are cheap to get wrong and invisible from the outside.
 */

const RSS = `<rss><channel>
  <item><title>Server maintenance scheduled</title><guid>g1</guid></item>
  <item><title>Release 2.1 published</title><guid>g2</guid></item>
</channel></rss>`;

function feed(overrides: Partial<FeedConfig> = {}): FeedConfig {
  return {
    id: 'f1',
    url: 'https://example.invalid/feed.xml',
    kind: 'rss',
    intervalSeconds: 60,
    enabled: true,
    rules: [{ match: 'maintenance', anomaly: 'meteor' }],
    ...overrides,
  };
}

describe('EventFeedClient polling', () => {
  let now: number;
  let requested: string[];
  let client: EventFeedClient;

  beforeEach(() => {
    now = 1_000_000;
    requested = [];
    client = new EventFeedClient(
      (id) => requested.push(id),
      () => now
    );
  });

  it('asks for nothing until it is started', () => {
    client.setFeeds([feed()]);
    expect(client.poll()).toEqual([]);
    expect(requested).toEqual([]);
  });

  it('asks for a feed that is due, and never more than once per interval', () => {
    client.setFeeds([feed({ intervalSeconds: 60 })]);
    client.start();

    expect(client.poll()).toEqual(['f1']);
    expect(requested).toEqual(['f1']);

    now += 30_000;
    expect(client.poll()).toEqual([]);

    now += 30_000;
    expect(client.poll()).toEqual(['f1']);
    expect(requested).toEqual(['f1', 'f1']);
  });

  it('floors the interval, so a state file edited to one second cannot spam a server', () => {
    client.setFeeds([feed({ intervalSeconds: 1 })]);
    client.start();

    expect(client.poll()).toEqual(['f1']);
    now += MIN_INTERVAL_SECONDS * 1000 - 1;
    expect(client.poll()).toEqual([]);
    now += 1;
    expect(client.poll()).toEqual(['f1']);
  });

  it('does not ask for a feed that is switched off', () => {
    client.setFeeds([feed({ enabled: false })]);
    client.start();
    expect(client.poll()).toEqual([]);
    expect(requested).toEqual([]);
  });

  it('stops asking once it is stopped', () => {
    client.setFeeds([feed()]);
    client.start();
    client.poll();
    client.stop();
    now += 10 * 60_000;
    expect(client.poll()).toEqual([]);
  });
});

describe('EventFeedClient health and deduplication', () => {
  let now: number;
  let client: EventFeedClient;

  beforeEach(() => {
    now = 1_000_000;
    client = new EventFeedClient(() => {}, () => now);
    client.setFeeds([feed()]);
    client.start();
  });

  it('fires a matching headline once and then not again', () => {
    expect(client.receive('f1', RSS).map((s) => s.anomaly)).toEqual(['meteor']);
    // The same document again. Most feeds return the same items every poll, and firing
    // twenty anomalies an hour because of it is the failure the fingerprint prevents.
    expect(client.receive('f1', RSS)).toEqual([]);
  });

  it('reports what the last document contained, not just that it answered', () => {
    client.receive('f1', RSS);
    const health = client.getState().health.f1;
    expect(health.items).toBe(2);
    expect(health.matched).toBe(1);
    expect(health.fired).toBe(1);
    expect(health.lastOk).toBe(now);
    expect(health.lastError).toBeNull();
  });

  it('counts a matched-but-already-seen signal as matched, not fired', () => {
    client.receive('f1', RSS);
    client.receive('f1', RSS);
    const health = client.getState().health.f1;
    expect(health.matched).toBe(1);
    expect(health.fired).toBe(0);
  });

  it('records a host failure and keeps the last success beside it', () => {
    client.receive('f1', RSS);
    now += 60_000;
    client.receive('f1', null, 'HTTP 503');

    const health = client.getState().health.f1;
    expect(health.lastError).toBe('HTTP 503');
    expect(health.lastOk).toBe(1_000_000);
    expect(client.getState().lastError).toContain('HTTP 503');
  });

  it('clears the error on the next success', () => {
    client.receive('f1', null, 'timed out');
    client.receive('f1', RSS);
    expect(client.getState().health.f1.lastError).toBeNull();
  });

  it('treats an empty document as a failure with a reason, not a silent success', () => {
    client.receive('f1', '');
    const health = client.getState().health.f1;
    expect(health.lastError).toBeTruthy();
    expect(health.items).toBe(0);
  });

  it('does not throw on malformed input, and reports nothing matched', () => {
    expect(() => client.receive('f1', '<<<not a feed>>>')).not.toThrow();
    const health = client.getState().health.f1;
    expect(health.items).toBe(0);
    expect(health.matched).toBe(0);
  });

  it('ignores a document for a feed it does not have', () => {
    expect(client.receive('nope', RSS)).toEqual([]);
  });

  it('prunes health for a removed feed but keeps it for the others', () => {
    client.receive('f1', RSS);
    now += 60_000;
    client.setFeeds([feed({ id: 'f2', enabled: true })]);

    const health = client.getState().health;
    expect(health.f1).toBeUndefined();
    expect(health.f2).toBeUndefined();
  });

  it('keeps a feed\'s history across an edit, since every edit goes through setFeeds', () => {
    client.receive('f1', RSS);
    const before = client.getState().health.f1;
    // The rule editor rewrites the whole list on every keystroke-sized change.
    client.setFeeds([feed({ rules: [{ match: 'release', anomaly: 'red-moon' }] })]);
    expect(client.getState().health.f1).toMatchObject({
      lastOk: before.lastOk,
      items: before.items,
    });
  });

  it('re-fires items already seen when the rules change, because the meaning changed', () => {
    client.receive('f1', RSS);
    client.setFeeds([feed({ rules: [{ match: 'release', anomaly: 'lights-out' }] })]);
    expect(client.receive('f1', RSS).map((s) => s.anomaly)).toEqual(['lights-out']);
  });

  it('forgets everything when disposed', () => {
    client.receive('f1', RSS);
    client.dispose();
    const state = client.getState();
    expect(state.health).toEqual({});
    expect(state.configured).toBe(0);
    expect(state.active).toBe(false);
  });
});
