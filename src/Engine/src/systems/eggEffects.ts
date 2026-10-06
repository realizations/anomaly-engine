/**
 * What each discovery does when it is found.
 *
 * ## Why this is its own file
 *
 * It used to be a `private static readonly` on the engine class, which made it the one
 * piece of the discovery path no test could reach. Every other link in the chain has a
 * guard: the zone table is pure and covered, `storyBeat`'s envelope is covered, the
 * window-event wiring is covered. The table that connects an egg to a beat sat in the
 * class that starts the engine on import, so nothing could check that all six eggs have
 * an entry -- which is exactly the failure this whole feature was built to remove,
 * an effect string nobody reads.
 *
 * ## The egg's `effect` string is not this
 *
 * The eggs carry prose like "All lights in the town turn on for 10 seconds". That is
 * the description shown to the player; this is what happens. Keeping them adjacent is
 * the point: an egg whose description and its behaviour live in different files is an
 * egg whose description is already a lie.
 *
 * ## Extending
 *
 * Add the egg to `BUILTIN_EASTER_EGGS`, add its beat here, and the coverage test will
 * insist the two agree. A beat with no egg is unreachable; an egg with no beat is
 * discoverable and inert.
 */
import type { StoryBeat } from '../renderer/storyBeat.js';
import { BUILTIN_EASTER_EGGS } from './EasterEggSystem.js';

export const EGG_EFFECTS: Record<string, StoryBeat> = {
  konami: { kind: 'lights-on', durationMs: 10_000 },
  'triple-click-observatory': { kind: 'observatory-door', durationMs: 14_000 },
  'midnight-hover-moon': { kind: 'moon-pulse', durationMs: 9_000 },
  'forest-stare': { kind: 'watcher', durationMs: 12_000 },
  // Dev builds only; see `_maybeDevBuildEgg`.
  'dev-build-message': { kind: 'terminal-message', durationMs: 20_000, lines: ['> WE KNOW YOU ARE THERE'] },
  '0333-stare': { kind: 'clock-lie', durationMs: 30_000, lieMinutes: 173 },
};

/**
 * Egg ids that have a beat but no egg, or an egg with no beat.
 *
 * Both directions are dead ends: the first can never fire, the second fires and does
 * nothing, which is the original bug in a new place.
 */
export function eggEffectGaps(): { withoutEffect: string[]; orphanedEffects: string[] } {
  const eggIds = new Set(BUILTIN_EASTER_EGGS.map((e) => e.id));
  return {
    withoutEffect: [...eggIds].filter((id) => !(id in EGG_EFFECTS)).sort(),
    orphanedEffects: Object.keys(EGG_EFFECTS).filter((id) => !eggIds.has(id)).sort(),
  };
}
