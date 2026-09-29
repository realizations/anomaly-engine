import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Persistence, reconcile, emptyState } from '../src/platform/Persistence.js';

const LS_KEY = 'anomaly-engine:state';

function makeBridge() {
  const sent: Array<{ type: string; payload?: Record<string, unknown> }> = [];
  return {
    sent,
    send: (type: string, payload?: Record<string, unknown>) => sent.push({ type, payload }),
  } as never;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useRealTimers();
});

describe('reconcile', () => {
  it('returns defaults for junk', () => {
    for (const bad of [null, undefined, 0, 'x', [], true]) {
      const s = reconcile(bad);
      expect(s.version).toBe(1);
      expect(s.journal).toEqual([]);
    }
  });

  it('keeps well-formed fields', () => {
    const s = reconcile({
      worldId: 'saltwick',
      style: 'flat',
      reducedMotion: true,
      totalSessions: 7,
      secrets: ['a', 'b'],
    });
    expect(s.worldId).toBe('saltwick');
    expect(s.style).toBe('flat');
    expect(s.reducedMotion).toBe(true);
    expect(s.totalSessions).toBe(7);
    expect(s.secrets).toEqual(['a', 'b']);
  });

  it('discards fields of the wrong type rather than trusting them', () => {
    const s = reconcile({
      worldId: 42,
      style: {},
      reducedMotion: 'yes',
      totalSessions: 'many',
      secrets: 'not-an-array',
      firstRun: 12,
    });
    expect(s.worldId).toBeNull();
    expect(s.style).toBeNull();
    expect(s.reducedMotion).toBeNull();
    expect(s.totalSessions).toBe(0);
    expect(s.secrets).toEqual([]);
    expect(s.firstRun).toBeNull();
  });

  it('drops non-string entries from string lists', () => {
    const s = reconcile({ secrets: ['ok', 1, null, 'fine'] });
    expect(s.secrets).toEqual(['ok', 'fine']);
  });

  it('drops journal entries that are not objects with an id', () => {
    const s = reconcile({
      journal: [
        { id: 'a', timestamp: 1, anomalyId: 'x', anomalyName: 'X', rarity: 'rare', location: 'u', notes: '', state: 'observed', clues: [] },
        { timestamp: 2 },
        'garbage',
        null,
      ],
    });
    expect(s.journal).toHaveLength(1);
    expect(s.journal[0].id).toBe('a');
  });

  it('rejects a negative session count', () => {
    expect(reconcile({ totalSessions: -5 }).totalSessions).toBe(0);
  });

  it('rejects a non-finite session count', () => {
    expect(reconcile({ totalSessions: Infinity }).totalSessions).toBe(0);
  });

  it('always stamps the current version', () => {
    expect(reconcile({ version: 999 }).version).toBe(1);
  });
});

describe('Persistence', () => {
  it('starts from a clean state and counts the session', () => {
    const p = new Persistence(makeBridge());
    const s = p.load();
    expect(s.totalSessions).toBe(1);
    expect(s.firstRun).toBeTruthy();
    expect(s.lastSeen).toBeTruthy();
  });

  it('counts sessions upward across loads', () => {
    new Persistence(makeBridge()).load();
    const second = new Persistence(makeBridge()).load();
    expect(second.totalSessions).toBe(2);
    const third = new Persistence(makeBridge()).load();
    expect(third.totalSessions).toBe(3);
  });

  it('preserves firstRun across sessions but advances lastSeen', () => {
    new Persistence(makeBridge()).load();
    const first = window.localStorage.getItem(LS_KEY)!;
    const s = new Persistence(makeBridge()).load();
    const firstParsed = JSON.parse(first);
    expect(s.firstRun).toBe(firstParsed.firstRun);
    expect(JSON.parse(window.localStorage.getItem(LS_KEY)!).lastSeen).toBeTruthy();
  });

  it('notifies the host on load so a fresh install creates its file', () => {
    const bridge = makeBridge();
    const p = new Persistence(bridge);
    p.load();
    expect(bridge).toBeDefined();
  });

  it('load is idempotent', () => {
    const p = new Persistence(makeBridge());
    p.load();
    const again = p.load();
    expect(again.totalSessions).toBe(1);
  });

  it('update persists through the local fallback', () => {
    const p = new Persistence(makeBridge());
    p.load();
    p.update({ worldId: 'the-long-fell', style: 'riso' });
    p.save();
    const stored = JSON.parse(window.localStorage.getItem(LS_KEY)!);
    expect(stored.worldId).toBe('the-long-fell');
    expect(stored.style).toBe('riso');
  });

  it('bounds the journal so it cannot grow without limit', () => {
    const p = new Persistence(makeBridge());
    p.load();
    for (let i = 0; i < 260; i++) {
      p.addJournalEntry({
        id: `e${i}`,
        timestamp: 1000 + i,
        anomalyId: 'meteor',
        anomalyName: 'Meteor',
        rarity: 'common',
        location: 'unknown',
        notes: '',
        state: 'observed',
        clues: [],
      });
    }
    expect(p.get().journal.length).toBeLessThanOrEqual(200);
  });

  it('deduplicates journal entries by id', () => {
    const p = new Persistence(makeBridge());
    p.load();
    const entry = {
      id: 'same', timestamp: 1, anomalyId: 'm', anomalyName: 'M',
      rarity: 'rare', location: 'u', notes: '', state: 'observed' as const, clues: [],
    };
    p.addJournalEntry(entry);
    p.addJournalEntry({ ...entry, notes: 'updated' });
    expect(p.get().journal).toHaveLength(1);
    expect(p.get().journal[0].notes).toBe('updated');
  });

  it('discover reports whether it was new', () => {
    const p = new Persistence(makeBridge());
    p.load();
    expect(p.discover('secrets', 'observatory-signal')).toBe(true);
    expect(p.discover('secrets', 'observatory-signal')).toBe(false);
    expect(p.get().secrets).toEqual(['observatory-signal']);
  });

  it('tracks moments separately from secrets', () => {
    const p = new Persistence(makeBridge());
    p.load();
    p.discover('secrets', 's1');
    p.discover('moments', 'm1');
    expect(p.get().secrets).toEqual(['s1']);
    expect(p.get().moments).toEqual(['m1']);
  });

  it('accepts host state without regressing the session count', () => {
    const p = new Persistence(makeBridge());
    p.load();
    expect(p.get().totalSessions).toBe(1);
    p.acceptFromHost({ totalSessions: 1, worldId: 'saltwick', journal: [] });
    // Host copy is authoritative but must not clobber our own session.
    expect(p.get().totalSessions).toBe(1);
    expect(p.get().worldId).toBe('saltwick');
    expect(p.isLoaded()).toBe(true);
  });

  it('survives a corrupt local store', () => {
    window.localStorage.setItem(LS_KEY, '{not json');
    const p = new Persistence(makeBridge());
    const s = p.load();
    expect(s.totalSessions).toBe(1);
  });

  it('emptyState returns a fresh object each call', () => {
    expect(emptyState()).not.toBe(emptyState());
    expect(emptyState().journal).toEqual([]);
  });
});
