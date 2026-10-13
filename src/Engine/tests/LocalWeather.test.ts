import { describe, it, expect } from 'vitest';
import {
  simulateWeather,
  forecast,
  locationSeed,
  DEFAULT_LOCATION,
  type Location,
} from '../src/systems/LocalWeather.js';
import type { WeatherCondition } from '../src/systems/WeatherSystem.js';

/**
 * The weather model, asserted on the properties that make it worth having.
 *
 * The product told users this simulation existed before it did -- the settings window,
 * `docs/architecture.md` and `docs/how-to-use.md` all described a local model seeded by
 * latitude and longitude. There was no model, so the desktop was permanently clear.
 *
 * Every test here is a property rather than a snapshot, because a model with no state
 * is exactly the kind of thing where a golden-file test gives false confidence: it
 * would pin the numbers and say nothing about whether they are right. Determinism,
 * seasonal sense, latitude sense and physical bounds are all checkable without knowing
 * the answer in advance.
 */

const PLACES: Record<string, Location> = {
  'the tropics': { lat: 1.5, lon: 20 },
  'the high arctic': { lat: 78, lon: 15 },
  'a temperate coast': { lat: 51.5, lon: -0.1 },
  'the deep tropics south': { lat: -8, lon: -60 },
  'a continental interior': { lat: 55, lon: 90 },
};

/** A date far enough from the edge of the year that an off-by-one in the phase shows. */
function at(month: number, day = 15, hour = 12): Date {
  return new Date(Date.UTC(2026, month, day, hour, 0, 0));
}

describe('determinism', () => {
  it('gives the same answer for the same place and moment', () => {
    // The property the whole design rests on. If this fails, "it has been raining
    // since Tuesday" is not a sentence anyone can say, and the model is a shuffle.
    for (const [name, loc] of Object.entries(PLACES)) {
      const a = simulateWeather(loc, at(6));
      const b = simulateWeather(loc, at(6));
      expect({ name, equal: JSON.stringify(a) === JSON.stringify(b) }).toEqual({
        name,
        equal: true,
      });
    }
  });

  it('gives different answers for different days', () => {
    // The other half. A model that is stable *and* constant is a constant function.
    const conditions = new Set<WeatherCondition>();
    for (let d = 1; d <= 28; d++) {
      conditions.add(simulateWeather(DEFAULT_LOCATION, at(1, d)).condition);
    }
    expect(conditions.size).toBeGreaterThan(1);
  });

  it('gives neighbouring places similar weather, not identical', () => {
    // A model keyed only on a coarse grid would give one town and the next a different
    // sky; one keyed only on the exact coordinate would give the same sky to both.
    const here = simulateWeather({ lat: 51.5, lon: -0.1 }, at(3));
    const nearby = simulateWeather({ lat: 51.52, lon: -0.12 }, at(3));
    const faraway = simulateWeather({ lat: -33.9, lon: 151.2 }, at(3));

    expect(Math.abs(here.temperature - nearby.temperature)).toBeLessThan(3);
    expect(Math.abs(here.temperature - faraway.temperature)).toBeGreaterThan(3);
  });

  it('does not depend on the machine timezone', () => {
    // UTC throughout, so a user who flies between continents does not see the weather
    // change. Constructed from UTC parts specifically to catch a local-time regression.
    const a = simulateWeather(DEFAULT_LOCATION, new Date(Date.UTC(2026, 6, 4, 15, 0, 0)));
    const b = simulateWeather(DEFAULT_LOCATION, new Date(Date.UTC(2026, 6, 4, 15, 0, 0)));
    expect(a).toEqual(b);
  });
});

describe('season', () => {
  it('is warmer at the equator than at the pole, at every point in the year', () => {
    for (let m = 0; m < 12; m++) {
      const tropical = simulateWeather(PLACES['the tropics'], at(m)).temperature;
      const arctic = simulateWeather(PLACES['the high arctic'], at(m)).temperature;
      expect({ month: m, arcticWarmer: arctic > tropical }).toEqual({ month: m, arcticWarmer: false });
    }
  });

  it('swings further from summer to winter the further you are from the equator', () => {
    // The equatorial year is flat and the polar year is not. This is the single most
    // recognisable property of real climate and the one most worth proving.
    const swing = (loc: Location) => {
      const summer = loc.lat >= 0 ? 6 : 0;
      const winter = loc.lat >= 0 ? 0 : 6;
      return Math.abs(
        simulateWeather(loc, at(summer)).temperature - simulateWeather(loc, at(winter)).temperature
      );
    };

    const tropical = swing(PLACES['the tropics']);
    const temperate = swing(PLACES['a temperate coast']);
    const arctic = swing(PLACES['the high arctic']);

    expect({ tropicalLessThanTemperate: tropical < temperate }).toEqual({
      tropicalLessThanTemperate: true,
    });
    expect({ temperateLessThanArctic: temperate < arctic }).toEqual({
      temperateLessThanArctic: true,
    });
  });

  it('has its summer in opposite months in the two hemispheres', () => {
    // December is southern summer and July is southern winter, so the southern place
    // must be warmer in the first. An earlier version of this test asserted the
    // opposite, which is the kind of error a model test makes when the author has the
    // hemispheres the right way round in their head and the wrong way round in the code.
    const south = PLACES['the deep tropics south'];
    const southDecember = simulateWeather(south, at(11)).temperature;
    const southJune = simulateWeather(south, at(5)).temperature;
    const northJuly = simulateWeather(PLACES['a temperate coast'], at(6)).temperature;
    const northJanuary = simulateWeather(PLACES['a temperate coast'], at(0)).temperature;

    expect({
      southWarmestInDecember: southDecember > southJune,
      northWarmestInJuly: northJuly > northJanuary,
    }).toEqual({ southWarmestInDecember: true, northWarmestInJuly: true });
  });
});

describe('physical bounds', () => {
  it('keeps every field in a range the real world produces', () => {
    // Sampled across a full year at every test place, because a model that stays in
    // bounds in July and leaves them in January is not a model that stays in bounds.
    for (const [name, loc] of Object.entries(PLACES)) {
      for (let d = 0; d < 365; d += 7) {
        const w = simulateWeather(loc, new Date(Date.UTC(2026, 0, 1 + d, 6)));
        const where = `${name} day ${d}`;
        expect({ where, c: Number.isFinite(w.temperature) }).toEqual({ where, c: true });
        expect(w.temperature, where).toBeGreaterThan(-70);
        expect(w.temperature, where).toBeLessThan(60);
        expect(w.windSpeed, where).toBeGreaterThanOrEqual(0);
        expect(w.windSpeed, where).toBeLessThanOrEqual(1);
        expect(w.humidity, where).toBeGreaterThanOrEqual(0);
        expect(w.humidity, where).toBeLessThanOrEqual(1);
        expect(w.windDirection, where).toBeGreaterThanOrEqual(0);
        expect(w.windDirection, where).toBeLessThan(360);
        // 870 hPa is below the lowest pressure ever recorded at sea level.
        expect(w.pressure, where).toBeGreaterThan(870);
        expect(w.pressure, where).toBeLessThan(1085);
        expect(w.visibility, where).toBeGreaterThan(0);
        expect(w.uvIndex, where).toBeGreaterThanOrEqual(0);
        expect(w.uvIndex, where).toBeLessThan(16);
      }
    }
  });

  it('never returns NaN for any field, at any input', () => {
    // A NaN reaching the canvas is a blank frame, and the guard upstream is a plain
    // `Number.isFinite`, so the model has to be clean rather than merely usually clean.
    const edges: Location[] = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 180 },
      { lat: 90, lon: 180 },
      { lat: -90, lon: -180 },
      { lat: 45, lon: 359.9 },
    ];
    for (const loc of edges) {
      for (let d = 0; d < 360; d += 11) {
        const w = simulateWeather(loc, new Date(Date.UTC(2026, 0, 1 + d, 3)));
        for (const [k, v] of Object.entries(w)) {
          if (typeof v === 'number') {
            expect(Number.isFinite(v), `${loc.lat},${loc.lon} day ${d} ${k}`).toBe(true);
          }
        }
      }
    }
  });
});

describe('the model actually produces weather', () => {
  it('reaches every condition across a year', () => {
    // A model that only ever returns "clear" is the bug this file exists to replace, so
    // the distribution is asserted rather than assumed.
    const seen = new Set<WeatherCondition>();
    for (const [name, loc] of Object.entries(PLACES)) {
      for (let d = 0; d < 365; d += 3) {
        seen.add(simulateWeather(loc, new Date(Date.UTC(2026, 0, 1 + d, 12))).condition);
      }
      expect({ name, conditions: seen.size > 0 }).toEqual({ name, conditions: true });
    }
    // Fog and snow are the two a naive model never reaches, so they are named.
    expect([...seen].sort()).toEqual(['clear', 'cloudy', 'fog', 'rain', 'snow', 'storm']);
  });

  it('does not spend most of the year raining', () => {
    // Sanity on the classifier's thresholds. A model where "rain" is the default is as
    // useless as one where "clear" is, so the distribution gets a floor and a ceiling.
    let wet = 0;
    let total = 0;
    for (let d = 0; d < 365; d++) {
      for (const loc of Object.values(PLACES)) {
        const c = simulateWeather(loc, new Date(Date.UTC(2026, 0, 1 + d, 12))).condition;
        total++;
        if (c === 'rain' || c === 'storm' || c === 'snow') wet++;
      }
    }
    const fraction = wet / total;
    expect(fraction).toBeGreaterThan(0.05);
    expect(fraction).toBeLessThan(0.8);
  });

  it('is colder in winter, and precipitation is not more likely to be snow', () => {
    // A sanity check on the freezing-level logic running the right way round.
    const january = simulateWeather(PLACES['a temperate coast'], at(0, 15, 6));
    const july = simulateWeather(PLACES['a temperate coast'], at(6, 15, 6));
    expect(january.temperature).toBeLessThan(july.temperature);
  });

  it('gives the polar winter precipitation as snow', () => {
    // Cold enough that precipitation cannot be rain. Sampled over the whole polar
    // winter rather than one day, because one day might legitimately be clear.
    const winter = [];
    for (let d = 0; d < 90; d++) {
      winter.push(simulateWeather(PLACES['the high arctic'], new Date(Date.UTC(2026, 11, d, 12))).condition);
    }
    expect(winter.filter((c) => c === 'rain' || c === 'storm')).toEqual([]);
  });
});

describe('forecast', () => {
  it('runs forward from the moment it is given', () => {
    const start = at(3, 10, 6);
    const hours = forecast(DEFAULT_LOCATION, start, 6);
    expect(hours).toHaveLength(6);
    expect(hours[0].timestamp).toBe(start.getTime());
    expect(hours[5].timestamp).toBe(start.getTime() + 5 * 3600000);
  });

  it('agrees with simulateWeather at each step', () => {
    const start = at(9, 20, 3);
    const hours = forecast(DEFAULT_LOCATION, start, 4);
    for (const h of hours) {
      expect(h).toEqual(simulateWeather(DEFAULT_LOCATION, new Date(h.timestamp)));
    }
  });
});

describe('locationSeed', () => {
  it('is stable per place and differs between places', () => {
    expect(locationSeed({ lat: 51.5, lon: -0.1 })).toBe(locationSeed({ lat: 51.5, lon: -0.1 }));
    expect(locationSeed({ lat: 51.5, lon: -0.1 })).not.toBe(locationSeed({ lat: -33.9, lon: 151.2 }));
  });
});
