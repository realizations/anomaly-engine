import { describe, it, expect } from 'vitest';
import {
  advanceStreak,
  previousDateKey,
  INITIAL_STREAK,
  STREAK_TARGET,
  type StreakState,
} from '../src/systems/staringStreak.js';

/**
 * Three consecutive nights at 03:33.
 *
 * Extracted from `main.ts` precisely so these cases could be written at all. The rules
 * are easy to state and easy to get quietly wrong in a way nothing reports: counting a
 * night twice makes the egg fire early, treating a gap as consecutive makes it fire for
 * someone who never watched, and resetting to one instead of to empty makes it fire
 * exactly once, ever.
 */

describe('previousDateKey', () => {
  it('steps back across a month', () => {
    expect(previousDateKey('2024-06-15')).toBe('2024-06-14');
  });

  it('steps back across a year', () => {
    expect(previousDateKey('2024-01-01')).toBe('2023-12-31');
  });

  it('respects a leap February', () => {
    // Getting this wrong silently shifts every night in early March, which is exactly
    // the kind of off-by-one that only shows up as an egg that never fires.
    expect(previousDateKey('2024-03-01')).toBe('2024-02-29');
    expect(previousDateKey('2023-03-01')).toBe('2023-02-28');
  });

  it('is exactly one day, in the format everything else compares against', () => {
    expect(previousDateKey('2024-02-29')).toBe('2024-02-28');
    // Stepping back twice from the second of January lands in December, which is the
    // boundary most likely to be off by a year if the date is built as a string.
    expect(previousDateKey(previousDateKey('2024-01-02'))).toBe('2023-12-31');
  });
});

describe('advanceStreak', () => {
  it('counts a first night', () => {
    const r = advanceStreak(INITIAL_STREAK, '2024-01-01');
    expect(r).toEqual({ state: { lastNight: '2024-01-01', streak: 1 }, fired: false });
  });

  it('ignores a second reading on the same night', () => {
    // The clock fires for every tick inside the 03:33 minute, so without this the streak
    // would advance on however many ticks happened to land there.
    const first = advanceStreak(INITIAL_STREAK, '2024-01-01');
    const second = advanceStreak(first.state, '2024-01-01');
    expect(second).toEqual({ state: first.state, fired: false });
    expect(second.state.streak).toBe(1);
  });

  it('counts consecutive nights', () => {
    let state = advanceStreak(INITIAL_STREAK, '2024-01-01').state;
    expect(state).toEqual({ lastNight: '2024-01-01', streak: 1 });

    state = advanceStreak(state, '2024-01-02').state;
    expect(state).toEqual({ lastNight: '2024-01-02', streak: 2 });
  });

  it('fires on the third consecutive night', () => {
    let state: StreakState = INITIAL_STREAK;
    for (const night of ['2024-01-01', '2024-01-02']) {
      state = advanceStreak(state, night).state;
    }
    const r = advanceStreak(state, '2024-01-03');
    expect(r.fired).toBe(true);
    expect(r.state).toEqual(INITIAL_STREAK);
  });

  it('breaks the streak on a missed night', () => {
    // Otherwise a week away and three readings in a row would be indistinguishable from
    // watching it three nights running.
    let state = advanceStreak(INITIAL_STREAK, '2024-01-01').state;
    state = advanceStreak(state, '2024-01-02').state;
    expect(state.streak).toBe(2);

    const gap = advanceStreak(state, '2024-01-06');
    expect(gap.fired).toBe(false);
    expect(gap.state).toEqual({ lastNight: '2024-01-06', streak: 1 });
  });

  it('resets to empty rather than to one, so the discovery is repeatable', () => {
    // Resetting to one would leave the egg at "two of three" forever after the first
    // finding, and a player who missed it could never get it.
    let state: StreakState = INITIAL_STREAK;
    for (const night of ['2024-01-01', '2024-01-02', '2024-01-03']) {
      state = advanceStreak(state, night).state;
    }
    expect(state).toEqual(INITIAL_STREAK);

    const next = advanceStreak(state, '2024-01-04');
    expect(next.fired).toBe(false);
    expect(next.state.streak).toBe(1);
  });

  it('never fires before the target, however the nights are spaced', () => {
    let state: StreakState = INITIAL_STREAK;
    for (let day = 1; day <= STREAK_TARGET - 1; day++) {
      const r = advanceStreak(state, `2024-01-0${day}`);
      expect(r.fired).toBe(false);
      state = r.state;
    }
    expect(state.streak).toBe(STREAK_TARGET - 1);
  });

  it('handles a streak that crosses a month boundary', () => {
    let state: StreakState = INITIAL_STREAK;
    for (const night of ['2024-02-29', '2024-03-01']) {
      state = advanceStreak(state, night).state;
    }
    expect(state.streak).toBe(2);

    // If `previousDateKey` did not step back into February here, the streak would break
    // and the egg would never fire for anyone who started watching at the end of a month.
    const last = advanceStreak(state, '2024-03-02');
    expect(last.fired).toBe(true);
    expect(last.state).toEqual(INITIAL_STREAK);
  });
});
