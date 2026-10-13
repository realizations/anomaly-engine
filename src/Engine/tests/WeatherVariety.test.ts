import { describe, it, expect } from 'vitest';
import { simulateWeather } from '../src/systems/LocalWeather.js';
import type { Location } from '../src/systems/LocalWeather.js';

/**
 * What the model looks like over a real year, as data.
 *
 * The property tests in `LocalWeather.test.ts` assert that the weather is *sane*. This
 * file answers a different question: is it *interesting*? A model can satisfy every
 * bound and every seasonal property and still produce a wallpaper that looks the same
 * on every screen, which is the failure that matters for a thing people leave running
 * on their desktop all day.
 *
 * So the distributions are computed and checked as distributions. The numbers below are
 * not pinned values -- they would break on any tuning change and prove nothing -- but
 * ranges, and the range for "distinct conditions per month" is the one that matters.
 */

const PLACES: Location[] = [
  { lat: 42.3, lon: -122.7 },
  { lat: 51.5, lon: -0.1 },
  { lat: 55, lon: 90 },
  { lat: -33.9, lon: 151.2 },
  { lat: 35, lon: 139 },
];

/** Samples every place on a grid of the year and returns the whole corpus. */
function corpus(): ReturnType<typeof simulateWeather>[] {
  const out: ReturnType<typeof simulateWeather>[] = [];
  for (const loc of PLACES) {
    for (let d = 0; d < 365; d++) {
      for (const hour of [3, 9, 15, 21]) {
        out.push(simulateWeather(loc, new Date(Date.UTC(2026, 0, 1 + d, hour))));
      }
    }
  }
  return out;
}

const CORPUS = corpus();

describe('the year is worth watching', () => {
  /**
   * The hour at which the sun is highest, in UTC, for a place.
   *
   * Local solar noon is 12:00 *local*, and local time runs four minutes behind UTC per
   * degree of longitude. At longitude -122.7 that is 20:10 UTC. A test that assumes
   * "noon means 12:00" samples the small hours at any longitude far from Greenwich,
   * which is how an earlier version of this file concluded a working model was broken.
   */
  function solarNoonUTC(lon: number): number {
    return Math.round((((0.5 - lon / 360) % 1) + 1) % 1 * 24) % 24;
  }

  /** The local clock hour corresponding to a UTC hour. */
  function toLocalHour(utcHour: number, lon: number): number {
    return (utcHour - solarNoonUTC(lon) + 12 + 24) % 24;
  }
  it('shows at least three different conditions in any single month', () => {
    // The core property. Two conditions means the wallpaper is a coin flip between two
    // looks; three means there is something to see this week that was not there last
    // week, which is the entire premise of a living desktop.
    const thin: number[] = [];
    for (let m = 0; m < 12; m++) {
      const seen = new Set(
        CORPUS.filter((w) => new Date(w.timestamp).getUTCMonth() === m).map((w) => w.condition)
      );
      if (seen.size < 3) thin.push(m);
    }
    expect(thin).toEqual([]);
  });

  it('varies intensity within a condition rather than always reading the same', () => {
    // A model that always returns the same intensity per condition produces a stable
    // sky that never develops, which is the same problem in a different dimension.
    for (const condition of ['cloudy', 'rain', 'clear'] as const) {
      const intensities = CORPUS.filter((w) => w.condition === condition).map((w) => w.intensity);
      expect(intensities.length, condition).toBeGreaterThan(50);
      const min = Math.min(...intensities);
      const max = Math.max(...intensities);
      expect({ condition, spread: max - min }).toMatchObject({ condition });
      // A spread of less than a fifth would mean the condition is a fixed tint.
      expect({ condition, spread: Number((max - min).toFixed(2)) }).toEqual({
        condition,
        spread: expect.any(Number),
      });
      expect(max - min, `${condition} intensity spread`).toBeGreaterThan(0.2);
    }
  });

  it('spends a plausible share of the year on precipitation', () => {
    // Roughly a third of Earth's land surface sees rain on any given day, but a
    // wallpaper wants *some* variety without being dreary. These bounds are wide on
    // purpose and would only fail if the classifier stopped working.
    const wet = CORPUS.filter((w) => w.condition === 'rain' || w.condition === 'storm').length;
    const snowy = CORPUS.filter((w) => w.condition === 'snow').length;
    const fraction = (wet + snowy) / CORPUS.length;

    expect(fraction).toBeGreaterThan(0.12);
    expect(fraction).toBeLessThan(0.6);
  });

  it('is not the same sky every hour of the same day', () => {
    // Determinism does not mean constancy. Two samples eight hours apart on the same
    // day should differ in at least one observable field somewhere in the corpus.
    let identical = 0;
    let compared = 0;
    for (const loc of PLACES) {
      for (let d = 0; d < 365; d += 5) {
        const morning = simulateWeather(loc, new Date(Date.UTC(2026, 0, 1 + d, 3)));
        const evening = simulateWeather(loc, new Date(Date.UTC(2026, 0, 1 + d, 21)));
        compared++;
        if (
          morning.condition === evening.condition &&
          morning.temperature === evening.temperature &&
          morning.windSpeed === evening.windSpeed
        ) {
          identical++;
        }
      }
    }
    expect(identical / compared).toBeLessThan(0.35);
  });

  it('lets a front arrive, rather than weather only ever being present', () => {
    // A place whose weather never changes over a week reads as a static image. Sampled
    // hourly across two weeks, the count of distinct condition-changes is what tells us
    // whether anything is moving.
    let changes = 0;
    for (const loc of PLACES) {
      let previous: string | null = null;
      for (let h = 0; h < 14 * 24; h++) {
        const w = simulateWeather(loc, new Date(Date.UTC(2026, 4, 1, h)));
        if (previous !== null && w.condition !== previous) changes++;
        previous = w.condition;
      }
    }
    expect(changes).toBeGreaterThan(10);
  });

  it('puts UV in daylight and not at midnight', () => {
    // Sampled at *local* solar noon, which is not 12:00 UTC. At longitude -122.7 the
    // sun is highest around 20:10 UTC, so a test that samples at noon UTC is sampling
    // the small hours and would have called a working model broken. An earlier version
    // of this test did exactly that.
    const place = PLACES[0];
    const noonUTC = solarNoonUTC(place.lon);

    let noon = 0;
    let midnight = 0;
    for (let d = 0; d < 365; d += 11) {
      noon = Math.max(
        noon,
        simulateWeather(place, new Date(Date.UTC(2026, 5, 1 + d, noonUTC))).uvIndex
      );
      // Local midnight, not 00:00 UTC. At longitude -122.7, 00:00 UTC is four in the
      // afternoon and broad daylight, so the original version of this assertion asked
      // for UV to be zero in the middle of the afternoon.
      midnight = Math.max(
        midnight,
        simulateWeather(place, new Date(Date.UTC(2026, 5, 1 + d, (noonUTC + 12) % 24))).uvIndex
      );
    }
    expect({ noonAboveSix: noon > 6 }).toEqual({ noonAboveSix: true });
    expect({ midnightIsZero: midnight === 0 }).toEqual({ midnightIsZero: true });
  });

  it('swings the temperature across a day, warmest in the afternoon', () => {
    // Air is heated from below, so the warmest hour is mid-afternoon rather than at
    // solar noon. Without the diurnal term the model reported 29.2 C at 3am and 29.3 C
    // at 9pm, which is not weather, it is a constant with a date on it.
    const place = PLACES[0];
    const readings: { hour: number; t: number }[] = [];
    for (let h = 0; h < 24; h++) {
      readings.push({ hour: h, t: simulateWeather(place, new Date(Date.UTC(2026, 5, 15, h))).temperature });
    }
    const warmest = readings.reduce((a, b) => (b.t > a.t ? b : a));
    const coldest = readings.reduce((a, b) => (b.t < a.t ? b : a));

    expect({ swing: Number((warmest.t - coldest.t).toFixed(1)) }).toEqual({
      swing: expect.any(Number),
    });
    expect(warmest.t - coldest.t, 'diurnal swing').toBeGreaterThan(3);
    // Mid-afternoon *local*, which at longitude -122.7 is a UTC small-hours hour. The
    // first version of this test compared UTC hours and concluded the model had the
    // wrong peak, when in fact it was right and the assertion was in the wrong timezone.
    const warmestLocal = toLocalHour(warmest.hour, place.lon);
    expect({ warmestLocal }).toEqual({ warmestLocal: expect.any(Number) });
    expect(warmestLocal).toBeGreaterThanOrEqual(12);
    expect(warmestLocal).toBeLessThanOrEqual(18);
  });
});
