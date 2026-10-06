/**
 * Three consecutive nights at 03:33.
 *
 * ## Why this is a module rather than a private method
 *
 * It was three lines inside `main.ts`, which means it was three lines no test could
 * reach -- and it is the piece of the discovery path most likely to be subtly wrong. The
 * rest of M2 is guarded: the zone table, the beat envelope, the window-event wiring and
 * the egg-to-beat table each have their own file and their own test. Streak arithmetic
 * decides whether an egg is reachable *ever*, and getting it wrong fails silently: the
 * player watches three nights and nothing happens, or watches one night twice and
 * something does.
 *
 * ## Why calendar days
 *
 * "Three nights" means three nights, not three elapsed days. A second reading inside
 * the same 03:33 minute is the same night and must not count twice, and a missed night
 * has to break the streak rather than be skipped over -- otherwise leaving the engine
 * off for a week and coming back to three readings in a row would be indistinguishable
 * from watching it three nights running.
 *
 * The state is plain data and the function is pure, so the caller owns persistence and
 * the test owns the calendar.
 */
import { dateKey } from '../events/ClockSource.js';

export interface StreakState {
  /** The most recent night counted, as a `dateKey`, or null if none is outstanding. */
  lastNight: string | null;
  /** How many consecutive nights are counted so far. */
  streak: number;
}

/** A streak with nothing counted -- also the state a completed streak resets to. */
export const INITIAL_STREAK: StreakState = { lastNight: null, streak: 0 };

/** How many consecutive nights trigger the discovery. */
export const STREAK_TARGET = 3;

/**
 * The date key for the day before `key`.
 *
 * Derived from the key rather than from `new Date()` so that a night supplied by the
 * caller is compared against *its own* previous day. Going through local noon rather
 * than midnight keeps a DST transition from landing on a date that was never two days
 * ago, and using the same `dateKey` as everything else keeps the string comparison
 * honest -- this is a statement about days, so the day string is the only thing allowed
 * to define one.
 */
export function previousDateKey(key: string): string {
  const d = new Date(`${key}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return dateKey(d);
}

/**
 * Count a night, and report whether the streak completed.
 *
 * Repeated calls for the same night are a no-op, so being inside the 03:33 minute for
 * several ticks counts once. A completed streak resets to empty rather than to one:
 * the next night starts a fresh attempt, which is what makes the discovery repeatable
 * for a player who missed it.
 */
export function advanceStreak(
  state: StreakState,
  todayKey: string
): { state: StreakState; fired: boolean } {
  if (state.lastNight === todayKey) return { state, fired: false };

  const yesterday = previousDateKey(todayKey);
  const streak = state.lastNight === yesterday ? state.streak + 1 : 1;

  if (streak >= STREAK_TARGET) return { state: INITIAL_STREAK, fired: true };
  return { state: { lastNight: todayKey, streak }, fired: false };
}
