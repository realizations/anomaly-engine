import { describe, it, expect } from 'vitest';
import { EGG_EFFECTS, eggEffectGaps } from '../src/systems/eggEffects.js';
import { BUILTIN_EASTER_EGGS } from '../src/systems/EasterEggSystem.js';
import { STORY_BEAT_KINDS } from '../src/renderer/storyBeat.js';

/**
 * Every discovery has to do something.
 *
 * This table is the whole point of M2's discovery half. Before it, six eggs carried
 * `effect` strings like "All lights in the town turn on for 10 seconds" and nothing
 * anywhere read them: the eggs were undiscoverable, and even had they been reachable,
 * finding one would have logged a sentence and drawn no scene. The strings still exist
 * -- they are what the player is shown -- but this is what happens.
 *
 * It lives in its own module rather than as a private static on the engine because that
 * is what made it testable. `main.ts` starts the engine on import, so a table defined
 * there is a table nothing can check, which is how the original gap survived.
 */

describe('egg effect coverage', () => {
  it('every egg has an effect, and no effect is orphaned', () => {
    expect(eggEffectGaps()).toEqual({ withoutEffect: [], orphanedEffects: [] });
  });

  it('covers the six shipped eggs by id', () => {
    // Explicit rather than derived, so an egg renamed in one file and not the other
    // shows up as a named failure instead of as a list that quietly shrank.
    const ids = BUILTIN_EASTER_EGGS.map((e) => e.id).sort();
    expect(ids).toEqual([
      '0333-stare',
      'dev-build-message',
      'forest-stare',
      'konami',
      'midnight-hover-moon',
      'triple-click-observatory',
    ]);
    expect(Object.keys(EGG_EFFECTS).sort()).toEqual(ids);
  });

  it('uses only kinds the renderer performs', () => {
    const kinds = new Set<string>(STORY_BEAT_KINDS);
    const unknown = Object.entries(EGG_EFFECTS)
      .filter(([, beat]) => !kinds.has(beat.kind))
      .map(([id, beat]) => `${id} -> ${beat.kind}`);
    expect(unknown).toEqual([]);
  });
});

describe('effects that would be invisible', () => {
  it('every effect runs for a positive duration', () => {
    // A duration of zero or less makes `beatEnvelope` return 0 unconditionally. The egg
    // would be discovered, the journal entry written, the log line sent -- and the scene
    // would not change at all. Nothing throws, which is why it is checked rather than
    // assumed.
    const inert = Object.entries(EGG_EFFECTS)
      .filter(([, beat]) => !(beat.durationMs > 0))
      .map(([id]) => id);
    expect(inert).toEqual([]);
  });

  it('the terminal message actually has a message', () => {
    const beat = EGG_EFFECTS['dev-build-message'];
    expect(beat.kind).toBe('terminal-message');
    if (beat.kind !== 'terminal-message') throw new Error('unreachable');
    expect(beat.lines.length).toBeGreaterThan(0);
    // Blank lines would replace the readout with nothing, which reads as the terminal
    // crashing rather than as a message.
    expect(beat.lines.every((l) => l.trim().length > 0)).toBe(true);
  });

  it('the clock lie lies by a non-zero amount', () => {
    const beat = EGG_EFFECTS['0333-stare'];
    expect(beat.kind).toBe('clock-lie');
    if (beat.kind !== 'clock-lie') throw new Error('unreachable');
    expect(beat.lieMinutes).not.toBe(0);
  });
});
