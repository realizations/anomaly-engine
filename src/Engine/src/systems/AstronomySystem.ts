/**
 * Sun and moon, from an ephemeris.
 *
 * What this replaced
 * -----------------
 * The previous version had three defects that all produced plausible-looking numbers:
 *
 *  - The moon was not computed at all. `_computeMoonPosition` returned
 *    `-sunAltitude * 0.8` and the sun's azimuth plus 180 degrees, which is a guess that
 *    the moon is always opposite the sun and always below the horizon when the sun is
 *    above it. It is wrong at full moon by up to five days, wrong at new moon entirely,
 *    and wrong about the moon's rise and set times by twelve hours.
 *  - Sunrise and sunset returned `Invalid Date` inside the polar circles. The closed form
 *    is `acos(-tan(lat) tan(dec))`, and outside [-1, 1] that is `NaN` -- which is what
 *    happens for every day of the polar summer *and* every day of the polar winter. Both
 *    are normal states at high latitude and neither is an error.
 *  - Illuminated fraction was `abs(cos(phase))`, which is 1 at new moon and 0 at full
 *    moon: exactly backwards, and wrong everywhere in between too.
 *
 * So the sky was showing a moon on the wrong side of the earth at the wrong time, and
 * any world above the Arctic Circle rendered `Invalid Date` into its status document.
 *
 * What this is
 * ------------
 * The standard low-precision algorithms from Meeus, *Astronomical Algorithms*. Accurate
 * to a fraction of a degree for the sun and about a degree for the moon, which is
 * several times finer than anything a 1920-wide scene can show, and needing no data
 * tables and no network.
 *
 * Time is Julian Days throughout, because that is what the formulae are written in and
 * converting once at the boundary is far less error-prone than converting inside them.
 */

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const SYNODIC_MONTH = 29.530588853;

/** Julian Day of the Unix epoch, for converting a computed JD back into a Date. */
const UNIX_EPOCH_JD = 2440587.5;

/** Days since the J2000.0 epoch, which is what both algorithms count from. */
export function julianDay(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

/** Julian centuries since J2000.0. */
function julianCentury(jd: number): number {
  return (jd - 2451545.0) / 36525;
}

export interface AstronomyData {
  /** Degrees above the horizon; negative is below. */
  sunAltitude: number;
  /** Degrees clockwise from north. */
  sunAzimuth: number;
  moonAltitude: number;
  moonAzimuth: number;
  /** 0 = new, 0.25 = first quarter, 0.5 = full, 0.75 = last quarter. */
  moonPhase: number;
  /** 0..1. The fraction of the disc that is lit. */
  moonIllumination: number;
  /** Signed age difference from exact phase, in days. */
  moonAge: number;
  sunrise: Date | null;
  sunset: Date | null;
  moonrise: Date | null;
  moonset: Date | null;
  isNight: boolean;
  isDawn: boolean;
  isDusk: boolean;
  timestamp: number;
}

interface HorizontalPosition {
  altitude: number;
  azimuth: number;
}

function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Greenwich Mean Sidereal Time, in degrees.
 *
 * The sidereal day is 23h56m4s, so the sky moves by about 3m56s against the clock each
 * day. Ignoring that is the difference between a moon that rises at the right time and
 * one that drifts by four minutes a day.
 */
function greenwichMeanSiderealTime(jd: number): number {
  const d = jd - 2451545.0;
  const t = d / 36525;
  return norm360(
    280.46061837 + 360.98564736629 * d + 0.000387933 * t * t - t * t * t / 38710000
  );
}

/** Equatorial coordinates in degrees. */
interface Equatorial {
  rightAscension: number;
  declination: number;
  distanceAU: number;
  /**
   * Apparent ecliptic longitude.
   *
   * Carried alongside the equatorial pair because phase needs it and the equatorial
   * form cannot recover it: the difference in ecliptic longitude between moon and sun
   * is what distinguishes waxing from waning, and both bodies are on nearly the same
   * plane. Right ascension is not usable for this -- at high declination the two
   * systems diverge by tens of degrees.
   */
  eclipticLongitude: number;
}

/** Sun, by the low-precision formula in Meeus chapter 25. */
function sunEquatorial(jd: number): Equatorial {
  const n = julianCentury(jd);
  const meanLongitude = norm360(280.46646 + n * (36000.76983 + n * 0.0003032));
  const meanAnomaly = 357.52911 + n * (35999.05029 - 0.0001537 * n);
  const eccentricity = 0.016708634 - n * (0.000042037 + 0.0000001267 * n);

  // Equation of the centre, the correction that turns a mean into a true longitude.
  const centre =
    (1.914602 - n * (0.004817 + 0.000014 * n)) * Math.sin(meanAnomaly * DEG) +
    (0.019993 - 0.000101 * n) * Math.sin(2 * meanAnomaly * DEG) +
    0.000289 * Math.sin(3 * meanAnomaly * DEG);

  const trueLongitude = meanLongitude + centre;
  const trueAnomaly = meanAnomaly + centre;
  const radiusVector =
    (1.000001018 * (1 - eccentricity * eccentricity)) /
    (1 + eccentricity * Math.cos(trueAnomaly * DEG));

  const omega = 125.04 - 1934.136 * n;
  const apparentLongitude = trueLongitude - 0.00569 - 0.00478 * Math.sin(omega * DEG);

  const obliquity =
    23 + (26 + (21.448 - n * (46.815 + n * (0.00059 - n * 0.001813))) / 60) / 60;

  const lambda = apparentLongitude * DEG;
  const epsilon = obliquity * DEG;

  return {
    rightAscension: norm360(Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda)) * RAD),
    declination: Math.asin(Math.sin(epsilon) * Math.sin(lambda)) * RAD,
    distanceAU: radiusVector,
    eclipticLongitude: norm360(apparentLongitude),
  };
}

/** Moon, by the low-precision formula in Meeus chapter 47, main terms only. */
function moonEquatorial(jd: number): Equatorial {
  const n = julianCentury(jd);
  const Lp = norm360(218.316 + n * (481267.8813 + n * (-0.0015786 + n / 538841)));
  const D = norm360(297.8502 + n * (445267.1115 + n * (-0.0018819 + n / 545868)));
  const M = norm360(357.5291 + n * (35999.0503 + n * (-0.0001536 + n / 24490000)));
  const Mp = norm360(134.9634 + n * (477198.8676 + n * (0.0087414 + n / 69699)));
  const F = norm360(93.2721 + n * (483202.0175 + n * (-0.0036539 + n / 3526000)));

  // Longitude in degrees plus the periodic terms that matter at this precision.
  const longitude =
    Lp +
    6.289 * Math.sin(Mp * DEG) +
    1.274 * Math.sin((Lp - 2 * D) * DEG) +
    0.658 * Math.sin(2 * D * DEG) +
    0.214 * Math.sin(2 * Mp * DEG) -
    0.186 * Math.sin(M * DEG) -
    0.114 * Math.sin(2 * F * DEG);

  const latitude =
    5.128 * Math.sin(F * DEG) +
    0.281 * Math.sin((Mp + F) * DEG) -
    0.278 * Math.sin((Mp - F) * DEG) -
    0.173 * Math.sin((2 * D - F) * DEG);

  const distanceKm = 385000.56 - 20905.355 * Math.cos(Mp * DEG) - 3699.111 * Math.cos(2 * D * DEG);

  const lambda = longitude * DEG;
  const beta = latitude * DEG;
  const n2 = julianCentury(jd);
  const obliquity =
    (23 + (26 + (21.448 - n2 * (46.815 + n2 * (0.00059 - n2 * 0.001813))) / 60) / 60) * DEG;

  const sinLambda = Math.sin(lambda);
  const cosLambda = Math.cos(lambda);
  const sinBeta = Math.sin(beta);
  const cosBeta = Math.cos(beta);

  return {
    rightAscension: norm360(
      Math.atan2(sinLambda * Math.cos(obliquity) - (sinBeta / cosBeta) * Math.sin(obliquity), cosLambda) * RAD
    ),
    declination: Math.asin(sinBeta * Math.cos(obliquity) + cosBeta * Math.sin(obliquity) * sinLambda) * RAD,
    distanceAU: distanceKm / 149597870.7,
    eclipticLongitude: norm360(longitude),
  };
}

/**
 * Equatorial to horizontal, for one observer.
 *
 * Azimuth is measured clockwise from north, which is the compass convention and what
 * the renderer expects -- so the atan2 argument order below is deliberate and is the
 * easiest thing in this file to get backwards.
 */
function toHorizontal(eq: Equatorial, jd: number, latitude: number, longitude: number): HorizontalPosition {
  const lst = greenwichMeanSiderealTime(jd) + longitude;
  const hourAngle = ((lst - eq.rightAscension + 540) % 360) - 180;
  const lat = latitude * DEG;
  const dec = eq.declination * DEG;
  const ha = hourAngle * DEG;

  const sinAltitude =
    Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha);
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAltitude))) * RAD;

  const azimuth = norm360(
    Math.atan2(
      -Math.sin(ha),
      Math.cos(lat) * Math.tan(dec) - Math.sin(lat) * Math.cos(ha)
    ) * RAD
  );

  return { altitude, azimuth };
}

/**
 * How much of the moon is lit, and where it is in its cycle.
 *
 * Two quantities that must not be confused:
 *
 *   - **Illuminated fraction** comes from the phase angle, the angle at the moon
 *     between the earth and the sun. It is a triangle angle, so it is unsigned: it
 *     sweeps 180 -> 0 -> 180 across a lunation, which is a *symmetric* curve and
 *     cannot tell a waxing moon from a waning one on its own.
 *   - **Phase** comes from the difference in ecliptic longitude, which is signed.
 *     Zero is new, a quarter is first quarter, a half is full.
 *
 * Deriving phase from the phase angle instead -- which an earlier version of this file
 * did, and which I did too before the tests caught it -- produces a moon that is
 * waxing when it is waning, and a "phase" that turns round twice per lunation.
 */
function moonIllumination(sun: Equatorial, moon: Equatorial): { fraction: number; phase: number; age: number } {
  // Geocentric elongation between sun and moon.
  const cosPsi =
    Math.sin(sun.declination * DEG) * Math.sin(moon.declination * DEG) +
    Math.cos(sun.declination * DEG) * Math.cos(moon.declination * DEG) *
      Math.cos((sun.rightAscension - moon.rightAscension) * DEG);
  const psi = Math.acos(Math.max(-1, Math.min(1, cosPsi)));

  // Phase angle at the moon, using the two distances as the sides of the triangle.
  const phaseAngle = Math.atan2(
    sun.distanceAU * Math.sin(psi),
    moon.distanceAU - sun.distanceAU * Math.cos(psi)
  );

  // Illuminated fraction. The previous version used abs(cos(2*pi*phase)), which is 1 at
  // new moon and 0 at full moon -- exactly backwards.
  const fraction = (1 + Math.cos(phaseAngle)) / 2;

  // Phase from the signed longitude difference, which is what carries waxing/waning.
  const separation = norm360(moon.eclipticLongitude - sun.eclipticLongitude);

  return { fraction, phase: separation / 360, age: (separation / 360) * SYNODIC_MONTH };
}

/**
 * The time a body next crosses the horizon, or null if it does not today.
 *
 * Found by scanning rather than by the closed form, because the closed form is what
 * returned `Invalid Date` at high latitude. A scan is immune to that by construction:
 * if the body never crosses, the scan finds nothing and reports null, which is the
 * truth -- polar day has no sunset and polar night has no sunrise, and both are normal.
 *
 * The scan starts at *local midnight*, not at the moment of the call. Searching
 * forward twelve hours from an arbitrary instant finds a sunrise only if you happen to
 * be looking in the twelve hours before it, which is why asking at noon returned null
 * for London in June. A full local day covers both crossings regardless of when it is
 * asked.
 *
 * Resolution is five minutes, well inside the accuracy of the positions themselves.
 */
/**
 * The altitude at which the sun is considered risen or set: -0.833 degrees.
 *
 * Not zero, and the difference is about seven minutes at mid-latitudes. The published
 * definition of sunrise is the moment the *upper limb* of the sun appears, and the
 * atmosphere bends light so it appears while it is still geometrically below the
 * horizon. Using 0 gives a day that is about fifteen minutes too short at midsummer,
 * which is what an earlier version of this function did.
 *
 * Applied only to the sun. A moonrise is a different question -- there is no
 * convention that puts the moon's upper limb on the horizon and calls it moonrise.
 */
const SUNSET_ALTITUDE = -0.833;

function findCrossing(
  body: (jd: number) => HorizontalPosition,
  jd: number,
  longitude: number,
  rising: boolean,
  horizon: number
): Date | null {
  const stepMinutes = 5;
  const dayMs = 86400000;

  // Local midnight, as a Julian day.
  //
  // Two things about Julian Day catch people out here and both bit this function:
  //
  //   - A Julian day begins at *noon*, so an integral JD is midday, not midnight. An
  //     earlier version anchored the scan at `jd - fraction` and therefore started
  //     twelve hours late, which is why it reported a London sunset at 02:24 UTC.
  //   - Local midnight is midnight *at the observer's longitude*, which is four
  //     minutes per degree away from Greenwich.
  //
  // Getting it right means the scan always covers the whole local day regardless of
  // when it is asked, which is the entire point.
  const startJd = jd - ((((jd + longitude / 360 - 0.5) % 1) + 1) % 1);

  let previousAltitude = body(startJd).altitude;
  let previousJd = startJd;

  for (let minutes = stepMinutes; minutes <= 24 * 60; minutes += stepMinutes) {
    const jdNext = startJd + (minutes * 60000) / dayMs;
    const altitude = body(jdNext).altitude;
    const crossedRising = previousAltitude < horizon && altitude >= horizon;
    const crossedSetting = previousAltitude >= horizon && altitude < horizon;

    if (rising ? crossedRising : crossedSetting) {
      // Linear interpolation to the crossing point, so the answer is not quantised to
      // the step.
      const t = altitude === previousAltitude
        ? 0
        : (horizon - previousAltitude) / (altitude - previousAltitude);

      // Interpolate in Julian days and convert once. Doing it the other way round --
      // converting `previousJd` to milliseconds and then adding a number of minutes
      // measured from `startJd` -- double-counts the offset from `startJd`, because
      // `previousJd` already contains it. That is what made an earlier version report
      // a London sunrise at 07:35 UTC instead of 03:43.
      const crossingJd = previousJd + (t * stepMinutes * 60000) / dayMs;

      // Julian Day 0 is noon on 1 January 4713 BC and the Unix epoch is JD 2440587.5.
      // The offset is not optional: multiplying a raw Julian day by the milliseconds in
      // a day yields a date in the year 8700-something.
      return new Date(Math.round((crossingJd - UNIX_EPOCH_JD) * dayMs));
    }

    previousAltitude = altitude;
    previousJd = jdNext;
  }
  return null;
}

export class AstronomySystem {
  private _latitude: number;
  private _longitude: number;
  private _currentData: AstronomyData | null = null;
  private _timer: number | null = null;
  private _listeners: ((data: AstronomyData) => void)[] = [];

  constructor(latitude: number, longitude: number) {
    this._latitude = latitude;
    this._longitude = longitude;
  }

  start(): void {
    this._update();
    this._timer = window.setInterval(() => this._update(), 60000);
  }

  stop(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  private _update(): void {
    this._currentData = this.compute(new Date());
    this._listeners.forEach((fn) => fn(this._currentData!));
  }

  private _sunAt(jd: number): HorizontalPosition {
    return toHorizontal(sunEquatorial(jd), jd, this._latitude, this._longitude);
  }

  private _moonAt(jd: number): HorizontalPosition {
    return toHorizontal(moonEquatorial(jd), jd, this._latitude, this._longitude);
  }

  /**
   * The sky at a moment.
   *
   * Pure and public, because it is the part worth testing: `start` only schedules it
   * once a minute and the tests want it for arbitrary dates and places.
   */
  compute(date: Date): AstronomyData {
    const jd = julianDay(date);
    const sun = sunEquatorial(jd);
    const moon = moonEquatorial(jd);
    const sunPos = toHorizontal(sun, jd, this._latitude, this._longitude);
    const moonPos = toHorizontal(moon, jd, this._latitude, this._longitude);
    const lit = moonIllumination(sun, moon);

    return {
      sunAltitude: round(sunPos.altitude, 3),
      sunAzimuth: round(norm360(sunPos.azimuth), 3),
      moonAltitude: round(moonPos.altitude, 3),
      moonAzimuth: round(moonPos.azimuth, 3),
      moonPhase: round(lit.phase, 5),
      moonIllumination: round(lit.fraction, 4),
      moonAge: round(lit.age, 2),
      sunrise: findCrossing((j) => this._sunAt(j), jd, this._longitude, true, SUNSET_ALTITUDE),
      sunset: findCrossing((j) => this._sunAt(j), jd, this._longitude, false, SUNSET_ALTITUDE),
      // The moon is a point here: no upper-limb convention, and using one would put
      // every moonrise seven minutes early for no reason anyone asked for.
      moonrise: findCrossing((j) => this._moonAt(j), jd, this._longitude, true, 0),
      moonset: findCrossing((j) => this._moonAt(j), jd, this._longitude, false, 0),
      // Astronomical twilight is -18, nautical -12, civil -6. The previous thresholds
      // used -6 for "night", which made the sky black an hour before it was.
      isNight: sunPos.altitude < -12,
      isDawn: sunPos.altitude >= -12 && sunPos.altitude < -0.833,
      isDusk: sunPos.altitude >= -0.833 && sunPos.altitude < 6,
      timestamp: date.getTime(),
    };
  }

  getCurrentData(): AstronomyData | null {
    return this._currentData;
  }

  onUpdate(listener: (data: AstronomyData) => void): () => void {
    this._listeners.push(listener);
    // A late subscriber must not wait up to a minute for the first reading, and the
    // engine subscribes after `start` has already fired once.
    if (this._currentData) listener(this._currentData);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  }

  dispose(): void {
    this.stop();
    this._listeners = [];
  }
}

function round(v: number, places: number): number {
  const f = Math.pow(10, places);
  return Math.round(v * f) / f;
}

/** Exported for the tests, which need the positions rather than the whole record. */
export const _internals = { sunEquatorial, moonEquatorial, toHorizontal, greenwichMeanSiderealTime };
