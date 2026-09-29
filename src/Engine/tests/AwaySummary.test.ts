import { describe, it, expect } from 'vitest';
import { buildAwaySummary, summaryToTerminalLines, phraseDuration } from '../src/platform/AwaySummary.js';
import { findBuiltInWorld } from '../src/worlds/registry.js';

const TOWN = findBuiltInWorld('the-town-that-wasnt-there')!;
const HOURS = 3600e3;

describe('While you were away', () => {
  it('says nothing at all after a short absence', () => {
    // A summary on every launch is a notification, not a discovery.
    const s = buildAwaySummary(10 * 60e3, TOWN, 1);
    expect(s.worthShowing).toBe(false);
    expect(s.lines).toEqual([]);
    expect(summaryToTerminalLines(s)).toEqual([]);
  });

  it('says something after a long absence', () => {
    const s = buildAwaySummary(14 * HOURS, TOWN, 1);
    expect(s.worthShowing).toBe(true);
    expect(s.lines.length).toBeGreaterThan(0);
    expect(s.awayPhrase).toContain('hour');
  });

  it('reports more after a very long absence', () => {
    const brief = buildAwaySummary(5 * HOURS, TOWN, 1);
    const long = buildAwaySummary(20 * HOURS, TOWN, 1);
    expect(long.lines.length).toBeGreaterThanOrEqual(brief.lines.length);
  });

  it('always pairs every line with a deniability', () => {
    for (const w of [TOWN, findBuiltInWorld('saltwick')!, findBuiltInWorld('the-long-corridor')!]) {
      for (const away of [1 * HOURS, 5 * HOURS, 30 * HOURS]) {
        const s = buildAwaySummary(away, w, w.terrain.seed);
        for (const l of s.lines) {
          expect(l.deniability.length).toBeGreaterThan(0);
          expect(l.text.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('never uses interface language', () => {
    // The copy is about the place, not about the player or the software.
    const banned = ['anomaly', 'event', 'triggered', 'wallpaper', 'engine', 'user', 'you were away'];
    for (const w of [TOWN, findBuiltInWorld('the-long-corridor')!]) {
      const s = buildAwaySummary(30 * HOURS, w, w.terrain.seed);
      for (const l of s.lines) {
        for (const b of banned) {
          expect(l.text.toLowerCase()).not.toContain(b);
        }
      }
    }
  });

  it('gives different worlds different drift', () => {
    const forest = buildAwaySummary(30 * HOURS, TOWN, TOWN.terrain.seed);
    const corridor = buildAwaySummary(30 * HOURS, findBuiltInWorld('the-long-corridor')!, 2718);
    const forestText = forest.lines.map((l) => l.text).join(' ');
    const corridorText = corridor.lines.map((l) => l.text).join(' ');
    expect(forestText).not.toBe(corridorText);
  });

  it('is deterministic for a given world and gap', () => {
    const a = buildAwaySummary(9 * HOURS, TOWN, TOWN.terrain.seed);
    const b = buildAwaySummary(9 * HOURS, TOWN, TOWN.terrain.seed);
    expect(a.lines.map((l) => l.text)).toEqual(b.lines.map((l) => l.text));
  });

  it('renders wrapped lines that fit the terminal', () => {
    const s = buildAwaySummary(20 * HOURS, TOWN, TOWN.terrain.seed);
    const lines = summaryToTerminalLines(s, 30);
    for (const l of lines) {
      expect(l.length).toBeLessThanOrEqual(34);
    }
    expect(lines[0]).toMatch(/^> AWAY /);
    expect(lines[lines.length - 1]).toBe('  RESUMING');
  });

  it('phrases durations in a way a person would say them', () => {
    expect(phraseDuration(30 * 60e3)).toBe('30 minutes');
    expect(phraseDuration(11 * HOURS)).toBe('11 hours');
    expect(phraseDuration(26 * HOURS)).toBe('a day');
    expect(phraseDuration(72 * HOURS)).toBe('3 days');
  });
});
