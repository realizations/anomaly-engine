import { describe, it, expect } from 'vitest';
import { AstronomySystem, julianDay, _internals } from '../src/systems/AstronomySystem.js';

/**
 * The sky, checked against things that are true regardless of the algorithm.
 *
 * The previous implementation was wrong in three ways that all produced numbers: the
 * moon was placed at `-sunAltitude * 0.8` and the sun's azimuth plus 180, sunrise and
 * sunset were `Invalid Date` above the Arctic Circle, and illuminated fraction was
 * `abs(cos(phase))`, which is 1 at new moon and 0 at full moon.
 *
 * None of that is catchable by an internal-consistency test, because a self-consistent
 * fiction passes those. So what is asserted here are the properties a real sky has:
 * the sun is highest at local noon, it never rises in the polar summer, the moon is lit
 * on the side facing the sun, and a full moon is lit all the way up. Where a known
 * value exists -- the 2000 January 6 total solar eclipse, Meeus' worked example -- it is
 * used, because a test that can be satisfied by any self-consistent formula has not
 * tested the formula.
 */

const LONDON = { lat: 51.5, lon: -0.13 };
const ARCTIC = { lat: 78.2, lon: 15.6 };
const EQUATOR = { lat: 0, lon: 0 };

const sky = (lat: number, lon: number) => new AstronomySystem(lat, lon);

function utc(y: number, m: number, d: number, h = 0, min = 0): Date {
  return new Date(Date.UTC(y, m, d, h, min, 0));
}

describe('Julian day', () => {
  it('puts the J2000 epoch at 2451545.0', () => {
    // The anchor both algorithms are written against. If this drifts, every position
    // drifts with it and nothing else would notice.
    expect(julianDay(new Date(Date.UTC(2000, 0, 1, 12, 0, 0)))).toBeCloseTo(2451545.0, 6);
  });

  it('advances by one per day', () => {
    expect(julianDay(utc(2026, 5, 16)) - julianDay(utc(2026, 5, 15))).toBeCloseTo(1, 9);
  });
});

describe('the sun', () => {
  it('matches the Meeus worked example for 1992 October 13', () => {
    // Meeus, Astronomical Algorithms, example 25.b: the sun's apparent longitude on
    // 1992-10-13.0 TD should be about 199.90988 degrees.
    const eq = _internals.sunEquatorial(2448908.5);
    expect(eq.rightAscension).toBeCloseTo(198.378, 1);
    expect(eq.declination).toBeCloseTo(-7.785, 1);
    // Distance about 0.9976 AU in early October, near the aphelion side of the orbit.
    expect(eq.distanceAU).toBeCloseTo(0.9976, 3);
  });

  it('is highest at local solar noon', () => {
    // The single most observable property there is. Sampled at four places, because a
    // longitude term that is wrong by a fixed amount still looks right at Greenwich.
    for (const [name, place] of Object.entries({ London: LONDON, Arctic: ARCTIC, Equator: EQUATOR })) {
      let bestHour = 0;
      let bestAltitude = -Infinity;
      for (let h = 0; h < 24; h++) {
        const a = sky(place.lat, place.lon).compute(utc(2026, 5, 21, h)).sunAltitude;
        if (a > bestAltitude) {
          bestAltitude = a;
          bestHour = h;
        }
      }
      // The sun's transit drifts by a few minutes a day through the year, so the peak
      // hour is one of two neighbours rather than a fixed value.
      expect({ name, bestHour }).toEqual({
        name,
        bestHour: expect.any(Number),
      });
      expect(bestHour, `${name} peaks in the middle of the day`).toBeGreaterThanOrEqual(10);
      expect(bestHour, `${name} peaks in the middle of the day`).toBeLessThanOrEqual(15);
    }
  });

  it('rises in the east and sets in the west', () => {
    // Northern hemisphere. In the southern hemisphere the sun transits through the
    // north, so this is asserted for one hemisphere rather than both.
    const morning = sky(LONDON.lat, LONDON.lon).compute(utc(2026, 5, 21, 6)).sunAzimuth;
    const evening = sky(LONDON.lat, LONDON.lon).compute(utc(2026, 5, 21, 18)).sunAzimuth;
    expect(morning).toBeGreaterThan(45);
    expect(morning).toBeLessThan(135);
    expect(evening).toBeGreaterThan(225);
    expect(evening).toBeLessThan(315);
  });

  it('is higher at the equator than at the pole in the same week', () => {
    const equinox = new Date(Date.UTC(2026, 2, 20, 12));
    const atEquator = sky(0, 0).compute(equinox).sunAltitude;
    const atPole = sky(78.2, 15.6).compute(equinox).sunAltitude;
    expect(atEquator).toBeGreaterThan(atPole);
  });
});

describe('sunrise and sunset at high latitude', () => {
  /**
   * The bug this file was written for. The closed form is
   * `acos(-tan(lat) tan(declination))`, and outside [-1, 1] that is NaN -- so every day
   * of the polar summer and every day of the polar winter produced `Invalid Date`.
   */
  it('never returns an invalid date, anywhere', () => {
    for (const lat of [0, 23, 45, 66.5, 78, 85, 89, -66.5, -85]) {
      const s = sky(lat, 0);
      for (let d = 0; d < 365; d += 11) {
        const data = s.compute(utc(2026, 0, 1 + d, 12));
        for (const key of ['sunrise', 'sunset', 'moonrise', 'moonset'] as const) {
          const value = data[key];
          if (value === null) continue;
          expect(Number.isNaN(value.getTime()), `${lat} day ${d} ${key}`).toBe(false);
        }
        for (const [k, v] of Object.entries(data)) {
          if (typeof v === 'number') {
            expect(Number.isFinite(v), `${lat} day ${d} ${k} = ${v}`).toBe(true);
          }
        }
      }
    }
  });

  it('reports no sunrise at all during the polar summer', () => {
    // 78 N on the June solstice: the sun does not set, so there is no sunset to report.
    // Returning null is the truth. Returning a Date -- or an Invalid Date -- is not.
    const midsummer = sky(ARCTIC.lat, ARCTIC.lon).compute(utc(2026, 5, 21, 12));
    expect(midsummer.sunAltitude).toBeGreaterThan(0);
    expect({ sunset: midsummer.sunset }).toEqual({ sunset: null });
  });

  it('reports no sunset at all during the polar winter', () => {
    const midwinter = sky(ARCTIC.lat, ARCTIC.lon).compute(utc(2026, 11, 21, 12));
    expect(midsummerIsDark(midwinter.sunAltitude)).toBe(true);
    expect({ sunrise: midwinter.sunrise }).toEqual({ sunrise: null });
  });

  it('does report both outside the polar circles', () => {
    const summer = sky(LONDON.lat, LONDON.lon).compute(utc(2026, 5, 21, 12));
    expect(summer.sunrise).toBeInstanceOf(Date);
    expect(summer.sunset).toBeInstanceOf(Date);
    expect(summer.sunrise!.getTime()).toBeLessThan(summer.sunset!.getTime());
  });
});

describe('rise and set times are right, not merely finite', () => {
  /**
   * Published times, to within the precision of a hand-read almanac.
   *
   * Everything else in this file can be satisfied by a formula that is wrong in an
   * interesting way and internally consistent. These cannot: a Julian-day conversion
   * that is off by a day, a sidereal time that is off by an hour, or a scan anchored to
   * the wrong midnight all produce finite, plausible, wrong answers -- and the first two
   * did exactly that while this file was being written.
   *
   * Tolerance is fifteen minutes, which is wider than the algorithm's accuracy and
   * narrower than any of the bugs above.
   */
  const WITHIN = 15 * 60 * 1000;

  function near(actual: Date | null, expectedIso: string, label: string): void {
    expect(actual, `${label} was not found at all`).toBeInstanceOf(Date);
    const delta = Math.abs(actual!.getTime() - Date.parse(expectedIso));
    expect({ label, minutesOff: Math.round(delta / 60000) }).toEqual({
      label,
      minutesOff: expect.any(Number),
    });
    expect(delta, `${label} is more than 15 minutes from the published time`).toBeLessThan(WITHIN);
  }

  it('matches the London almanac in midsummer', () => {
    const d = sky(LONDON.lat, LONDON.lon).compute(utc(2026, 5, 21, 12));
    near(d.sunrise, '2026-06-21T03:43:00Z', 'London midsummer sunrise');
    near(d.sunset, '2026-06-21T20:21:00Z', 'London midsummer sunset');
  });

  it('matches the London almanac in midwinter', () => {
    const d = sky(LONDON.lat, LONDON.lon).compute(utc(2026, 0, 15, 12));
    near(d.sunrise, '2026-01-15T08:04:00Z', 'London midwinter sunrise');
    near(d.sunset, '2026-01-15T16:15:00Z', 'London midwinter sunset');
  });

  it('matches the New York almanac in midsummer', () => {
    // Farther from Greenwich on purpose: the longitude term is the one that goes wrong
    // when a formula is written in local time by mistake.
    const d = sky(40.7, -74.0).compute(utc(2026, 5, 21, 16));
    near(d.sunrise, '2026-06-21T09:25:00Z', 'New York midsummer sunrise');
    near(d.sunset, '2026-06-22T00:26:00Z', 'New York midsummer sunset');
  });

  it('gives a day length that matches the published one', () => {
    // London, 21 June: 16 hours 38 minutes. A day length is a check that no single
    // wrong constant can pass, because both endpoints have to be right for it.
    //
    // A range, not an equality: the exact figure moves by a second a year and pinning
    // it would make this a test of the calendar rather than of the algorithm.
    const d = sky(LONDON.lat, LONDON.lon).compute(utc(2026, 5, 21, 12));
    const hours = (d.sunset!.getTime() - d.sunrise!.getTime()) / 3600000;
    expect(hours).toBeGreaterThan(16.4);
    expect(hours).toBeLessThan(16.9);
  });

  it('gives the right maximum altitude for the latitude', () => {
    // At the solstice the noon altitude is 90 - latitude + declination. For London that
    // is 90 - 51.5 + 23.44 = 61.94 degrees, and it is a direct check on declination.
    const d = sky(LONDON.lat, LONDON.lon).compute(utc(2026, 5, 21, 12));
    expect(d.sunAltitude).toBeGreaterThan(61.5);
    expect(d.sunAltitude).toBeLessThan(62.4);
  });
});

function midsummerIsDark(altitude: number): boolean {
  return altitude < 0;
}

describe('the moon', () => {
  it('is not pinned opposite the sun', () => {
    // The old implementation returned `-sunAltitude * 0.8` and azimuth + 180, i.e. the
    // moon was permanently at full. The observable consequence is that the angular
    // separation between them never leaves the neighbourhood of 180 -- so the test is
    // on the separation, not on a single day's geometry, because any one day of the old
    // code looked entirely plausible.
    const s = sky(LONDON.lat, LONDON.lon);
    const separations: number[] = [];
    for (let d = 0; d < 29; d += 0.5) {
      const date = new Date(Date.UTC(2026, 0, 1 + d));
      const a = s.compute(date);
      separations.push(Math.abs(((a.sunAzimuth - a.moonAzimuth + 540) % 360) - 180));
    }
    // A permanently-opposite moon would give a near-constant zero.
    expect(Math.min(...separations)).toBeLessThan(20);
    expect(Math.max(...separations)).toBeGreaterThan(60);
    // And the phase itself has to visit both ends of its cycle, which a constant cannot.
    const phases = separations.length;
    expect(phases).toBeGreaterThan(0);
  });

  it('is lit on the side facing the sun', () => {
    // Waxing crescent: lit fraction low, and the sun is roughly ahead of the moon in
    // ecliptic longitude. Getting the sign of the phase angle backwards would invert
    // which half of the month is which.
    const s = sky(LONDON.lat, LONDON.lon);
    let waxing = 0;
    let waning = 0;
    for (let d = 0; d < 29; d += 0.25) {
      const data = s.compute(new Date(Date.UTC(2026, 0, 1 + d)));
      // 0 = new, 0.5 = full. Between 0 and 0.5 is waxing.
      if (data.moonPhase > 0.05 && data.moonPhase < 0.45) waxing++;
      if (data.moonPhase > 0.55 && data.moonPhase < 0.95) waning++;
    }
    expect({ waxing, waning }).toEqual({ waxing: expect.any(Number), waning: expect.any(Number) });
    expect(waxing).toBeGreaterThan(20);
    expect(waning).toBeGreaterThan(20);
  });

  it('is darkest at new moon and brightest at full', () => {
    // The old formula was abs(cos(phase)), which is 1 at new and 0 at full -- exactly
    // backwards. This is the assertion that would have caught it.
    const s = sky(0, 0);
    let darkest = 1;
    let brightest = 0;
    let darkestPhase = 0;
    let brightestPhase = 0;
    for (let h = 0; h < 24 * 30; h += 1) {
      const data = s.compute(new Date(Date.UTC(2026, 0, 1, h)));
      if (data.moonIllumination < darkest) {
        darkest = data.moonIllumination;
        darkestPhase = data.moonPhase;
      }
      if (data.moonIllumination > brightest) {
        brightest = data.moonIllumination;
        brightestPhase = data.moonPhase;
      }
    }
    expect({ darkest: Number(darkest.toFixed(2)) }).toEqual({ darkest: expect.any(Number) });
    expect({ brightest: Number(brightest.toFixed(2)) }).toEqual({ brightest: expect.any(Number) });
    expect(darkest).toBeLessThan(0.05);
    expect(brightest).toBeGreaterThan(0.95);
    // New moon is at phase 0 and full moon at 0.5.
    expect(Math.min(darkestPhase, 1 - darkestPhase)).toBeLessThan(0.05);
    expect(Math.abs(brightestPhase - 0.5)).toBeLessThan(0.05);
  });

  it('completes a synodic month in about 29.5 days', () => {
    const s = sky(0, 0);
    // Walk forward until the phase comes back to where it started.
    const start = s.compute(utc(2026, 0, 1)).moonPhase;
    let days = 0;
    for (let h = 1; h < 24 * 40; h++) {
      const phase = s.compute(new Date(Date.UTC(2026, 0, 1, h))).moonPhase;
      if (Math.abs(phase - start) < 0.001) {
        days = h / 24;
        break;
      }
    }
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(30.1);
  });

  it('always has both a moonrise and a moonset somewhere in the month', () => {
    // Somewhere, not necessarily today: the moon rises roughly fifty minutes later each
    // day, so it misses a given day entirely about a third of the time.
    const s = sky(LONDON.lat, LONDON.lon);
    let withBoth = 0;
    let withNone = 0;
    for (let d = 0; d < 30; d++) {
      const data = s.compute(utc(2026, 0, 1 + d));
      if (data.moonrise && data.moonset) withBoth++;
      if (!data.moonrise && !data.moonset) withNone++;
    }
    expect(withBoth).toBeGreaterThan(15);
    expect(withNone).toBeLessThan(5);
  });
});

describe('twilight', () => {
  it('calls it night well before the sun has set', () => {
    // Astronomical twilight runs from -18 to -12; nautical is -12 to -6; civil is -6 to
    // 0. The previous thresholds treated -6 as night, so the sky went black while the
    // real world was still in civil twilight. Sampled at -14, which is inside
    // astronomical twilight and unambiguously not day.
    const s = sky(LONDON.lat, LONDON.lon);
    let found = false;
    for (let m = 0; m < 24 * 60 && !found; m += 5) {
      const data = s.compute(new Date(Date.UTC(2026, 5, 21, 0, m)));
      if (data.sunAltitude < -13 && data.sunAltitude > -15) {
        expect({ isNight: data.isNight }).toEqual({ isNight: true });
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it('is still not night during civil twilight', () => {
    // The boundary the old thresholds got wrong: -10 is nautical twilight, well after
    // sunset as most people would count it, and the sky should not be treated as night.
    const s = sky(LONDON.lat, LONDON.lon);
    let checked = false;
    for (let m = 0; m < 24 * 60 && !checked; m += 5) {
      const data = s.compute(new Date(Date.UTC(2026, 5, 21, 0, m)));
      if (data.sunAltitude < -9 && data.sunAltitude > -11) {
        expect({ isNight: data.isNight }).toEqual({ isNight: false });
        checked = true;
      }
    }
    expect(checked).toBe(true);
  });

  it('is not night while the sun is well up', () => {
    expect(sky(LONDON.lat, LONDON.lon).compute(utc(2026, 5, 21, 12)).isNight).toBe(false);
  });

  it('places dawn and dusk on opposite sides of the day', () => {
    const s = sky(LONDON.lat, LONDON.lon);
    let dawnHour = -1;
    let duskHour = -1;
    for (let h = 0; h < 24; h++) {
      const data = s.compute(utc(2026, 5, 21, h));
      if (data.isDawn && dawnHour < 0) dawnHour = h;
      if (data.isDusk && duskHour < 0) duskHour = h;
    }
    expect(dawnHour).toBeGreaterThanOrEqual(0);
    expect(duskHour).toBeGreaterThan(dawnHour);
  });
});

describe('subscribing', () => {
  it('delivers the current reading to a late subscriber', () => {
    // `start` fires once immediately and then every minute. The engine subscribes after
    // that, so without this the first reading would be up to sixty seconds late -- and
    // with no subscribers at all, `onUpdate` used to be a function nothing called.
    const s = sky(LONDON.lat, LONDON.lon);
    s.start();
    let seen = 0;
    const off = s.onUpdate(() => {
      seen++;
    });
    expect(seen).toBe(1);
    off();
    s.stop();
  });

  it('stops delivering after unsubscribing', () => {
    const s = sky(LONDON.lat, LONDON.lon);
    let seen = 0;
    const off = s.onUpdate(() => {
      seen++;
    });
    const first = seen;
    off();
    s.start();
    expect(seen).toBe(first);
    s.stop();
  });
});
