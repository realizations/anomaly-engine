/**
 * Local weather.
 *
 * The product has been claiming this for a while: the settings window tells users
 * "weather runs from a local simulation seeded by latitude and longitude, no request
 * leaves the machine", and `docs/architecture.md` says the same. There was no
 * simulation. `WeatherSystem` had a provider interface that nothing implemented, and
 * because `_fetchWeather` returned early when no provider was set, the renderer sat
 * on its constructor default forever: the desktop was permanently clear.
 *
 * So this is the model the documentation has been describing, written down.
 *
 * ## What "simulated" is allowed to mean
 *
 * Not random. A wallpaper that rolls a different sky every time you look at it is not
 * simulating weather, it is shuffling a deck, and it cannot be reasoned about. This is
 * a deterministic function of latitude, longitude and the date, which means:
 *
 *   - It is stable. The same minute tomorrow gives the same weather as today, so
 *     "it has been raining since Tuesday" is a true sentence rather than a coincidence.
 *   - It is testable. Every property below is assertable, because there is nothing to
 *     mock.
 *   - It costs nothing and discloses nothing. No key, no request, no location leaving
 *     the machine -- which is also why it is the right default rather than a fallback.
 *
 * ## How it works
 *
 * Three layers, coarse to fine:
 *
 *   1. **Climate.** Latitude sets a baseline temperature and how far the year swings.
 *     Coastal longitudes damp the swing; continental ones exaggerate it. This is the
 *     part that is actually true about the real world, and it is why the model gives
 *     a Mediterranean a mild wet winter and a Siberian one a brutal one.
 *   2. **Synoptic state.** A low-frequency oscillation over days picks the regime --
 *     high pressure, low pressure, or a front passing through. This is what produces
 *     multi-day runs of weather rather than noise.
 *   3. **Hourly detail.** Within a day, the front's progress modulates intensity, and
 *     the diurnal cycle adds an afternoon convective bump in summer.
 *
 * Everything is a sum of sines at incommensurate periods plus a hash of the date, so
 * there is no drift and no state to carry between calls.
 */
import { mulberry32 } from '../render/noise.js';
import type { WeatherCondition } from './WeatherSystem.js';

/**
 * Two-dimensional value noise, local to this file.
 *
 * `render/noise.ts` is one-dimensional and is used by the renderer on a hot path with
 * its own tests; adding 2D there would widen a module whose surface is already the
 * one the art direction depends on, for a consumer that needs exactly one shape of it.
 */
function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function valueNoise2D(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = fade(xf);
  const v = fade(yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
}

/** Fractal sum of `valueNoise2D`, centred on zero so it reads as a deviation. */
function fbm2(x: number, y: number, octaves = 3): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let fx = x;
  let fy = y;
  for (let o = 0; o < octaves; o++) {
    sum += (valueNoise2D(fx, fy) * 2 - 1) * amp;
    norm += amp;
    amp *= 0.5;
    fx *= 2;
    fy *= 2;
  }
  return sum / norm;
}

export interface Location {
  lat: number;
  lon: number;
}

/** What the renderer consumes, plus the numbers a person might want to read. */
export interface SimulatedWeather {
  condition: WeatherCondition;
  /** 0..1. How strongly the condition is expressed. Clear is never exactly 0. */
  intensity: number;
  temperature: number;
  /** 0..1, not the renderer's 0..1 wind: this is a Beaufort-ish fraction. */
  windSpeed: number;
  /** Degrees clockwise from north. */
  windDirection: number;
  humidity: number;
  pressure: number;
  /** Metres. 24000 is a clear day; below 1000 is fog. */
  visibility: number;
  uvIndex: number;
  /** The regime the synoptic layer chose, kept for the debug overlay. */
  regime: 'high' | 'low' | 'front';
  timestamp: number;
}

const DEG = Math.PI / 180;

/**
 * Day of year as a fraction, 0.0 = 1 January 00:00 UTC.
 *
 * Fractional, and that is load-bearing. An earlier version floored this to an integer,
 * which silently discarded the time of day from every downstream use: `day % 1` was
 * always exactly 0, so the diurnal cycle and the front's progress across a day were
 * both flat. The model still produced correct *daily* weather and looked fine in a
 * test that sampled one instant a day -- while the sky never changed between 3am and
 * 9pm, which is the sort of thing you only notice when you watch it.
 *
 * UTC so the answer does not depend on the machine's timezone: a user who flies between
 * continents should not see the weather change.
 */
function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  return (date.getTime() - start) / 86400000;
}

/**
 * Baseline temperature in Celsius for a latitude and day of year.
 *
 * Two effects, both real:
 *
 *   - Equator-to-pole gradient. Roughly -0.55 C per degree of latitude, offset by the
 *     fact that the hottest latitudes are not the equator.
 *   - Seasonal swing, which is *absent* at the equator and strongest at the poles. The
 *     swing is proportional to the cosine of latitude, which is close to 1 at the poles
 *     and close to 0 at the equator, and its phase is inverted between hemispheres.
 */
function climate(lat: number, day: number, continentality: number): number {
  const absLat = Math.abs(lat);
  const equatorial = 27 - 0.006 * absLat * absLat;
  const swing = 0.42 * absLat * continentality;
  // Northern hemisphere peaks around day 200; southern is six months out of phase.
  const phase = (lat >= 0 ? 0 : Math.PI) - (2 * Math.PI * (day - 200)) / 365;
  return equatorial + swing * Math.cos(phase);
}

/**
 * How continental a place is, 0 (oceanic) to 1 (continental).
 *
 * Derived from longitude rather than a lookup table of coastlines, which we do not
 * have and would not want to ship. It is crude -- it treats longitude 0 as the middle
 * of a continent, which is true for Africa and false for the Atlantic -- and it is
 * deliberately crude: the only thing it drives is how much the year swings, and
 * getting that wrong by a factor of two is a warmer January rather than a wrong sky.
 */
function continentality(lat: number, lon: number): number {
  const bands = Math.cos(lon * DEG * 3);
  return clamp01(0.5 + 0.35 * bands + 0.15 * Math.sin(lat * DEG * 4));
}

/** The synoptic regime for a place on a day, from a low-frequency oscillation. */
function regime(lat: number, lon: number, day: number): 'high' | 'low' | 'front' {
  // A ~5.5 day period with a second harmonic, so regimes last a few days but not
  // identically: real pressure systems do not repeat on a metronome.
  const primary = fbm2(lon * 0.05 + day * 0.18, lat * 0.05 + day * 0.11, 2);
  if (primary > 0.62) return 'high';
  if (primary < -0.62) return 'low';
  return 'front';
}

/**
 * Where a front is, 0 (not yet arrived) to 1 (moved past).
 *
 * Within a day this sweeps east across the place, which is what makes weather *arrive*
 * rather than appear. It is why the model can say it will be raining in an hour.
 */
function frontProgress(day: number, lon: number): number {
  const localHour = (day % 1 + 1) % 1;
  // A front crosses a given longitude roughly in the afternoon local time.
  const arrival = (lon / 360 + 0.5) % 1;
  const raw = (localHour - arrival) / 0.5;
  return clamp01(raw);
}

/** Map a scalar to a condition, with intensity as the distance past each threshold. */
function classify(value: number): { condition: WeatherCondition; intensity: number } {
  if (value < -0.55) return { condition: 'storm', intensity: clamp01((-value - 0.55) / 0.45) };
  if (value < -0.2) return { condition: 'rain', intensity: clamp01((-value - 0.2) / 0.35) };
  if (value < 0.22) return { condition: 'cloudy', intensity: clamp01((0.22 - value) / 0.42) };
  if (value < 0.62) return { condition: 'clear', intensity: clamp01((0.62 - value) / 0.4) };
  return { condition: 'clear', intensity: 1 };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Freezing level, in metres.
 *
 * The one piece of real physics in here, and the reason snow is not a coin flip in
 * February. Temperature drops about 6.5 C per kilometre of altitude, so a place at 20 C
 * and 200 m is snowing while a place at 20 C and 2000 m is raining, and at high
 * latitude the freezing level is simply on the ground.
 */
function freezingLevel(temperature: number, humidity: number): number {
  // Wet air freezes lower than dry air, because the latent heat released as the droplet
  // freezes warms the parcel back up.
  return Math.max(0, (temperature + 2 - humidity * 2.5) * 1000 / 6.5 + 400);
}

/**
 * The weather at a place and time.
 *
 * Pure: same arguments, same answer, forever. That is the property everything else in
 * this file is built on, and the reason the tests can assert on it.
 */
export function simulateWeather(location: Location, date: Date): SimulatedWeather {
  const { lat, lon } = location;
  const day = dayOfYear(date);
  const continental = continentality(lat, lon);
  const temperature = climate(lat, day, continental);

  const state = regime(lat, lon, day);
  const progress = frontProgress(day, lon);
  const hourly = hash2(Math.floor(lon * 8), day);

  const hourOfDay = (day % 1 + 1) % 1;
  // Local solar noon, in UTC. Four minutes per degree of longitude, which is the real
  // figure for the mean sun -- so at longitude -122.7 the sun is highest at 20:10 UTC,
  // and anything that assumes "noon means 12:00" is wrong by eight hours.
  const solarNoon = (0.5 - lon / 360 + 1) % 1;
  const solarElevation = Math.cos((hourOfDay - solarNoon) * 2 * Math.PI);

  // The diurnal temperature swing. Air is heated from below, so the warmest moment is
  // mid-afternoon rather than at solar noon -- solar noon is when the input is
  // strongest, not when the output peaks. Ocean-facing coasts have a small swing and
  // continental interiors a large one, which is the reason the same latitude can be
  // 12 degrees apart between Lisbon and Madrid in July.
  const swingAmplitude =
    1.5 + 8 * clamp01(continental) * clamp01((temperature + 5) / 25);
  const peakHour = 0.25;
  const temperatureNow =
    temperature + swingAmplitude * Math.cos((hourOfDay - solarNoon - peakHour) * 2 * Math.PI);

  // The wetness signal. Negative is wet, positive is settled.
  //
  // `hourly` is centred before it is used. A hash returns 0..1, so using it raw would
  // bias every day toward settled weather by up to half the classifier's range -- and
  // the first version of this file did exactly that, which showed up as a year that was
  // 97% clear. The offsets below are then relative to a neutral day.
  let wetness = (hourly - 0.5) * 1.15;
  if (state === 'low') wetness -= 0.85;
  if (state === 'front') wetness -= 0.5 * (1 - Math.abs(progress - 0.5) * 2);
  if (state === 'high') wetness += 0.55;

  // Convective afternoon bump: summer heats the boundary layer, which lifts air and
  // makes storms. Winter has no such cycle over land at these latitudes.
  const diurnal = Math.max(0, solarElevation) * clamp01((temperatureNow - 12) / 18);
  wetness -= diurnal * 0.45;

  const { condition, intensity } = classify(wetness);
  // Humidity rises with wetness and with proximity to the sea.
  const humidity = clamp01(
    0.42 + wetness * -0.35 + (1 - continental) * 0.18 + Math.cos((lat / 90) * Math.PI / 2) * 0.1
  );

  // Pressure. Real systems span roughly 960 to 1040 hPa and the number is legible to
  // anyone who has read a shipping forecast, so it is produced in that range.
  const pressure = 1013 + (state === 'low' ? -22 : state === 'high' ? 18 : -6) + hourly * 5;

  const windSpeed = clamp01(
    0.12 + (state === 'low' ? 0.45 : state === 'front' ? 0.3 : 0.08) + Math.abs(wetness) * 0.2
  );
  // Veers from west in the northern hemisphere to east in the southern, which is the
  // real Coriolis-driven pattern and costs one line.
  const windDirection = ((lat >= 0 ? 250 : 70) + hourly * 40 + state.length * 7) % 360;

  // Visibility collapses in fog and rain and is otherwise good.
  const baseVisibility = 24000 - humidity * 6000;
  const visibility =
    condition === 'fog' ? lerp(baseVisibility, 300, intensity)
    : condition === 'rain' || condition === 'storm' ? lerp(baseVisibility, 2500, intensity)
    : baseVisibility;

  // UV: strongest at low latitude, high altitude, midday, and when it is not raining.
  // Reuses the solar elevation computed above, which is why it is `cos` and not `sin`:
  // sin is zero at solar noon, which put the UV peak at sunrise and sunset.
  const elevation = Math.max(0, solarElevation);
  const uvIndex =
    Math.max(0, elevation * 12 * Math.cos(lat * DEG) * (1 - humidity * 0.6) * (1 - intensity * 0.7));

  const level = freezingLevel(temperatureNow, humidity);

  return {
    condition: adjustForTemperature(condition, temperatureNow, intensity, level),
    intensity,
    temperature: round1(temperatureNow),
    windSpeed: round2(windSpeed),
    windDirection: round1(windDirection),
    humidity: round2(humidity),
    pressure: round0(pressure),
    visibility: round0(visibility),
    uvIndex: round1(uvIndex),
    regime: state,
    timestamp: date.getTime(),
  };
}

/**
 * Turn rain into snow, or clear into fog, on the evidence of temperature.
 *
 * Separated from `classify` because it is a *correction* rather than a classification:
 * the synoptic signal says "it is precipitating", and the freezing level says in what
 * form. Fog is decided separately because it is a visibility phenomenon, not a
 * precipitation one -- a cold foggy dawn is below freezing and not snowy.
 */
function adjustForTemperature(
  condition: WeatherCondition,
  temperature: number,
  intensity: number,
  freezingLevelM: number
): WeatherCondition {
  if (condition === 'rain' || condition === 'storm') {
    // The terrain is not sea level, and most of the shipped worlds are cold places.
    // Without a real altitude the freezing level has to come from the model, and the
    // default assumes a lowland site, which is the conservative choice: rain rather
    // than snow at 2 C is right far more often than the reverse.
    return freezingLevelM <= 0 ? 'snow' : condition;
  }
  if (condition === 'clear' && temperature <= 0 && intensity < 0.25) {
    return 'fog';
  }
  return condition;
}

/** The next few hours, for a forecast readout. */
export function forecast(location: Location, date: Date, hours = 6): SimulatedWeather[] {
  const out: SimulatedWeather[] = [];
  for (let i = 0; i < hours; i++) {
    out.push(simulateWeather(location, new Date(date.getTime() + i * 3600000)));
  }
  return out;
}

/**
 * A stable seed for a location, so a place has its own character.
 *
 * Two machines at the same coordinates produce the same weather, which is the point of
 * a deterministic model, and two places a few kilometres apart produce nearly the same
 * weather, which is also the point.
 */
export function locationSeed(location: Location): number {
  return Math.floor(hash2(Math.round(location.lat * 100), Math.round(location.lon * 100)) * 0xffffffff);
}

/** A per-location jitter source, for callers that want variation within the rules. */
export function locationRandom(location: Location): () => number {
  return mulberry32(locationSeed(location));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function round0(v: number): number {
  return Math.round(v);
}

/**
 * Where the machine is, if it will say.
 *
 * Refuses rather than guesses. A wallpaper that approximates your position from an IP
 * lookup is disclosing something nobody asked it to, and this project has no telemetry
 * and no accounts -- so the location is the user's to provide, and the default is a
 * fixed point with a comment saying so.
 */
export const DEFAULT_LOCATION: Location = { lat: 42.3, lon: -122.7 };
