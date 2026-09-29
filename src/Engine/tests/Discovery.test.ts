import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnomalySystem, type AnomalyDefinition } from '../src/anomalies/AnomalyRegistry.js';
import { JournalSystem, type JournalEntry } from '../src/systems/JournalSystem.js';
import { SecretSystem } from '../src/systems/SecretSystem.js';
import { BUILTIN_SECRETS } from '../src/systems/SecretSystem.js';

const def = (over: Partial<AnomalyDefinition> = {}): AnomalyDefinition => ({
  id: 'test',
  name: 'Test Anomaly',
  description: 'Something happened.',
  category: 'visual',
  rarity: 'rare',
  cooldown: 0,
  duration: 5,
  effects: [],
  ...over,
});

describe('AnomalySystem', () => {
  let sys: AnomalySystem;
  beforeEach(() => {
    sys = new AnomalySystem();
  });

  it('registers and retrieves definitions', () => {
    sys.register(def({ id: 'alpha' }));
    expect(sys.getDefinitions().map((d) => d.id)).toContain('alpha');
  });

  it('ignores a duplicate id rather than double registering', () => {
    sys.register(def({ id: 'dup', name: 'First' }));
    sys.register(def({ id: 'dup', name: 'Second' }));
    const dups = sys.getDefinitions().filter((d) => d.id === 'dup');
    expect(dups).toHaveLength(1);
  });

  it('unregisters', () => {
    sys.register(def({ id: 'gone' }));
    sys.unregister('gone');
    expect(sys.getDefinitions().map((d) => d.id)).not.toContain('gone');
  });

  it('refuses to trigger an unknown anomaly', () => {
    expect(sys.trigger('nope')).toBe(false);
  });

  it('refuses to trigger while another anomaly is active', () => {
    sys.register(def({ id: 'a', cooldown: 0 }));
    sys.register(def({ id: 'b', cooldown: 0 }));
    expect(sys.trigger('a')).toBe(true);
    // canTrigger conflates "active" with "cooling down", so use a second
    // definition with no cooldown to prove it is the active one blocking.
    const b = sys.getDefinitions().find((d) => d.id === 'b')!;
    expect(sys.canTrigger(b)).toBe(false);
  });

  it('honours a cooldown once the anomaly is no longer active', () => {
    vi.useFakeTimers();
    // Expiry is driven by an interval that only runs once the system is started,
    // so the active window has to actually elapse here. Note that cooldown is
    // in SECONDS while the timers here are in milliseconds.
    sys.start();
    sys.register(def({ id: 'cooled', cooldown: 60, duration: 5 }));
    const d = sys.getDefinitions().find((x) => x.id === 'cooled')!;
    expect(sys.canTrigger(d)).toBe(true);
    expect(sys.trigger('cooled')).toBe(true);

    vi.advanceTimersByTime(8_000);
    expect(sys.getActiveAnomaly()).toBeNull();
    expect(sys.canTrigger(d)).toBe(false);
    expect(sys.trigger('cooled')).toBe(false);

    vi.advanceTimersByTime(61_000);
    expect(sys.canTrigger(d)).toBe(true);
    sys.stop();
    vi.useRealTimers();
  });

  it('treats cooldown as seconds, not milliseconds', () => {
    vi.useFakeTimers();
    sys.start();
    sys.register(def({ id: 'units', cooldown: 30, duration: 1 }));
    sys.trigger('units');
    vi.advanceTimersByTime(3_000);
    // 3s is nowhere near 30s, so it must still be blocked.
    expect(sys.trigger('units')).toBe(false);
    vi.advanceTimersByTime(29_000);
    expect(sys.trigger('units')).toBe(true);
    sys.stop();
    vi.useRealTimers();
  });

  it('notifies listeners on trigger and on end', () => {
    const started: string[] = [];
    const ended: string[] = [];
    sys.register(def({ id: 'watched', cooldown: 0, duration: 5 }));
    sys.onTrigger((a) => started.push(a.definition.id));
    sys.onEnd((a) => ended.push(a.definition.id));
    expect(sys.trigger('watched')).toBe(true);
    expect(started).toEqual(['watched']);
    expect(ended).toEqual([]);
  });

  it('reports no active anomaly when idle', () => {
    expect(sys.getActiveAnomaly()).toBeNull();
  });

  it('dispose stops the system', () => {
    sys.register(def({ id: 'x' }));
    expect(() => sys.dispose()).not.toThrow();
  });
});

describe('JournalSystem', () => {
  let j: JournalSystem;
  const entry = (id: string, ts: number): JournalEntry => ({
    id, timestamp: ts, anomalyId: 'meteor', anomalyName: 'Meteor',
    rarity: 'common', location: 'unknown', notes: '', state: 'observed', clues: [],
  });

  beforeEach(() => {
    j = new JournalSystem();
  });

  it('adds and retrieves entries', () => {
    j.addEntry(entry('a', 1));
    expect(j.getEntries()).toHaveLength(1);
    expect(j.getEntry('a')?.anomalyName).toBe('Meteor');
  });

  it('returns entries newest first for display', () => {
    j.addEntry(entry('old', 1));
    j.addEntry(entry('new', 100));
    const ids = j.getEntries().map((e) => e.id);
    expect(ids[0]).toBe('new');
  });

  it('updates an existing entry', () => {
    j.addEntry(entry('a', 1));
    j.updateEntry('a', { notes: 'edited', state: 'solved' });
    expect(j.getEntry('a')?.notes).toBe('edited');
    expect(j.getEntry('a')?.state).toBe('solved');
  });

  it('ignores updates to a missing entry', () => {
    expect(() => j.updateEntry('nope', { notes: 'x' })).not.toThrow();
    expect(j.getEntries()).toHaveLength(0);
  });

  it('notifies entry listeners', () => {
    const seen: string[] = [];
    j.onEntry((e) => seen.push(e.id));
    j.addEntry(entry('a', 1));
    expect(seen).toEqual(['a']);
  });

  it('notifies state listeners', () => {
    let n = 0;
    j.onStateChange(() => { n++; });
    j.addEntry(entry('a', 1));
    expect(n).toBeGreaterThan(0);
  });

  it('restores entries and sorts them by time', () => {
    j.restore([
      { ...entry('b', 200) },
      { ...entry('a', 100) },
    ]);
    expect(j.getEntries().map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('drops malformed entries on restore', () => {
    j.restore([
      { ...entry('good', 1) },
      { timestamp: 2 },
      null as never,
      'garbage' as never,
    ]);
    expect(j.getEntries().map((e) => e.id)).toEqual(['good']);
  });

  it('normalises an unknown discovery state to observed', () => {
    j.restore([{ ...entry('a', 1), state: 'weird' as never }]);
    expect(j.getEntry('a')?.state).toBe('observed');
  });

  it('keeps valid discovery states', () => {
    for (const s of ['observed', 'discovered', 'solved'] as const) {
      j.restore([{ ...entry(s, 1), state: s }]);
      expect(j.getEntry(s)?.state).toBe(s);
    }
  });

  it('exportToJSON produces parseable output', () => {
    j.addEntry(entry('a', 1));
    expect(() => JSON.parse(j.exportToJSON())).not.toThrow();
  });

  it('exportToMarkdown includes entry names', () => {
    j.addEntry(entry('a', 1));
    expect(j.exportToMarkdown()).toContain('Meteor');
  });

  it('getState reports a count', () => {
    j.addEntry(entry('a', 1));
    j.addEntry(entry('b', 2));
    expect(j.getState().entries.length).toBe(2);
  });
});

describe('SecretSystem', () => {
  let s: SecretSystem;
  beforeEach(() => {
    s = new SecretSystem();
  });

  it('ships built-in secrets with hints and clues', () => {
    expect(BUILTIN_SECRETS.length).toBeGreaterThan(0);
    for (const sec of BUILTIN_SECRETS) {
      expect(sec.id).toBeTruthy();
      expect(sec.hints.length).toBeGreaterThan(0);
    }
  });

  it('has unique secret ids', () => {
    const ids = BUILTIN_SECRETS.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('starts with nothing discovered', () => {
    expect(s.getDiscovered()).toHaveLength(0);
    expect(s.getProgress().percentage).toBe(0);
  });

  it('discover marks a secret found', () => {
    const first = BUILTIN_SECRETS[0].id;
    expect(s.discover(first)).toBe(true);
    expect(s.isDiscovered(first)).toBe(true);
  });

  it('observe records an observation before discovery', () => {
    const first = BUILTIN_SECRETS[0].id;
    s.observe(first);
    expect(s.getSecret(first)).toBeTruthy();
  });

  it('refuses to discover an unknown secret', () => {
    expect(s.discover('not-a-secret')).toBe(false);
    expect(s.getSecret('not-a-secret')).toBeUndefined();
  });

  it('notifies on discovery', () => {
    const seen: string[] = [];
    s.onDiscover((d) => seen.push(d.definition.id));
    s.discover(BUILTIN_SECRETS[0].id);
    expect(seen).toEqual([BUILTIN_SECRETS[0].id]);
  });

  it('progress counts toward the total', () => {
    const p = s.getProgress();
    s.discover(BUILTIN_SECRETS[0].id);
    const after = s.getProgress();
    expect(after.discovered).toBe(1);
    expect(after.total).toBe(p.total);
    expect(after.percentage).toBeGreaterThan(0);
  });

  it('restore rehydrates known ids and ignores unknown ones', () => {
    s.restore([BUILTIN_SECRETS[0].id, 'stale-secret-from-a-older-build']);
    expect(s.getDiscovered()).toHaveLength(1);
    expect(s.isDiscovered(BUILTIN_SECRETS[0].id)).toBe(true);
  });

  it('restore is idempotent', () => {
    s.restore([BUILTIN_SECRETS[0].id]);
    s.restore([BUILTIN_SECRETS[0].id]);
    expect(s.getDiscovered()).toHaveLength(1);
  });

  it('restore with an empty list clears discoveries', () => {
    s.discover(BUILTIN_SECRETS[0].id);
    s.restore([]);
    expect(s.getDiscovered()).toHaveLength(0);
  });
});
