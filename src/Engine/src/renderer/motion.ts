/**
 * Motion tuning.
 *
 * This exists because the renderer had no single place to describe how much of
 * anything moves. Tuning constants were scattered through the drawing code as
 * bare numbers -- `0.8`, `1.7`, `0.06`, `0.42` -- which meant the only way to calm
 * the scene down was to find each one individually, and the only way to make it
 * flicker was to move the wrong one.
 *
 * The failure this fixes was concrete. Several independently animating elements
 * were each individually reasonable and together produced a strobe: three
 * expanding beacon rings at 0.8 rad/s on a `lighter` composite, a scan bar
 * crossing the terminal continuously, stars twinkling at 1.7 rad/s, and grass
 * swaying at 0.85. None of them flickered on its own. On a desktop that is
 * visible for hours, the sum was irritating in a way that is hard to describe and
 * easy to miss while looking at any single frame.
 *
 * ## Intensity responses are not uniform
 *
 * `motionIntensity` scales each *category* of motion by its own response, rather
 * than multiplying every animation by one number. A global multiplier is the
 * obvious implementation and it is wrong: it slows down everything equally, so
 * turning motion down makes the world look sluggish and sluggish is its own kind
 * of ugly. Different things tolerate different amounts of reduction.
 *
 * Camera and environment motion responds strongly, because slow drift is what
 * makes a place feel alive and is cheap to lose. Particles respond moderately,
 * because a still particle field reads as a bug. Ambient *brightness* barely
 * responds at all, because brightness oscillation is the thing that actually
 * hurts: it is what the eye notices when it is not looking directly, and it is
 * what makes a wallpaper tiring. UI and the terminal should not respond at all --
 * a readout that flickers is a broken readout, not an atmospheric effect.
 *
 * So at low intensity the scene keeps moving and stops pulsing.
 */

/** User-facing motion level, 0..1. */
export type MotionIntensity = number;

/**
 * Default.
 *
 * Calm. This is a background, and the overwhelming majority of its life should be
 * looking like nothing is happening. The scene still breathes and the weather
 * still moves; it simply never strobes.
 */
export const DEFAULT_MOTION_INTENSITY = 0.35;

/** Level forced when the system or the user asks for reduced motion. */
export const REDUCED_MOTION_INTENSITY = 0.1;

/**
 * How strongly each category of motion responds to the intensity setting.
 *
 * These are the numbers the earlier version lacked. Exposed as named values so a
 * new animated element has to decide which category it belongs to rather than
 * inventing a rate.
 */
export const RESPONSE = {
  /**
   * Camera and environment drift: cloud travel, parallax, slow sway.
   *
   * Strong response. This is what makes a place feel like a place, and it is the
   * first thing to go when motion is turned right down, which is correct: a
   * completely frozen sky reads as a screenshot.
   */
  environment: 0.85,

  /**
   * Particles: motes, snow, rain, dust.
   *
   * Moderate. Still visible at low intensity, because a scene with no particles
   * in the air looks wrong in a way that is hard to name.
   */
  particles: 0.55,

  /**
   * Stars and distant points of light.
   *
   * Low response, and the amplitude here is small to begin with. Twinkle is a
   * garnish; at 1.7 rad/s across a full screen of stars it read as sensor noise
   * rather than as sky.
   */
  twinkle: 0.3,

  /**
   * Ambient brightness: the beacon, lamp glows, the scan bar, anything that
   * changes how bright a region is rather than where something is.
   *
   * Very low. Brightness oscillation is the specific thing that makes a
   * wallpaper tiring over hours, because peripheral vision picks it up when
   * deliberate attention is elsewhere. This is the number that matters most and it
   * is deliberately not 1.
   */
  glow: 0.18,

  /**
   * The terminal and other instrumentation.
   *
   * Zero. A readout that changes brightness is a broken readout, not an effect.
   * The terminal's own scan bar is the exception and is handled by its own
   * setting below rather than by this.
   */
  interface: 0,
} as const;

/** Named motion categories, used to look up a response. */
export type MotionCategory = keyof typeof RESPONSE;

/**
 * Resolves an effective amplitude for a category.
 *
 * `base` is the amplitude at full intensity, so existing drawing code can keep
 * expressing itself in absolute terms and simply ask how much of it to use.
 */
export function amplitude(category: MotionCategory, intensity: MotionIntensity, base: number): number {
  const response = RESPONSE[category];
  return base * (1 - response + response * clamp01(intensity));
}

/**
 * Resolves an effective rate, in radians per second, for motion that should slow
 * as well as shrink.
 *
 * Used for positional animation rather than brightness. A star field that twinkle
 * stops twinkling should drift more slowly too, or it reads as broken rather than
 * as calm.
 */
export function rate(category: MotionCategory, intensity: MotionIntensity, baseRate: number): number {
  const response = RESPONSE[category];
  return baseRate * (1 - response * 0.55 + response * 0.55 * clamp01(intensity));
}

export function clamp01(v: number): number {
  // NaN means the caller has no idea what it wanted, so the default is the only
  // sensible answer.
  //
  // Infinities do not: an intensity of Infinity means more than the maximum, and
  // clamping it to the maximum is what "clamp" means. This used to return the
  // default for both, so an intensity that should have been maximal -- a division
  // that overflowed, say -- silently became calm instead. On a control whose whole
  // purpose is that somebody found the motion uncomfortable, quietly turning their
  // setting down is the wrong way to fail.
  if (Number.isNaN(v)) return DEFAULT_MOTION_INTENSITY;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * The terminal scan bar.
 *
 * Off by default. A bright bar sweeping the screen of the one piece of
 * instrumentation in the scene is the single most tiring thing in the original
 * build, and it is decorative: a real CRT's refresh is far faster than this and
 * reads as a uniform phosphor glow rather than as a travelling band.
 *
 * Opt-in, for anyone who wants it.
 */
export const SCAN_BAR = {
  enabled: false,
  /** Seconds for one full pass. Slow enough to be an event rather than a loop. */
  periodSeconds: 14,
  /** Peak alpha of the band. Low, because it is additive on top of everything else. */
  peakAlpha: 0.05,
} as const;

/**
 * Beacon breathing.
 *
 * Replaces three expanding rings at 0.8 rad/s. Rings expand and fade in a cycle,
 * so three of them at different phases means three brightness pulses per cycle
 * across a bright additive glow, which is precisely a strobe.
 *
 * A breath is a slow rise and fall in intensity at a fixed radius. One cycle, no
 * repetition, and slow enough that it reads as a lamp with a filament rather than
 * as an animation.
 */
export const BEACON = {
  /** Radians per second. About a 42 second cycle: below conscious notice. */
  breathRate: 0.15,
  /** Fraction of base brightness at the bottom of the breath. */
  minScale: 0.82,
  /** Peak multiplier of the halo radius at the top of the breath. */
  radiusScale: 1.18,
} as const;

/**
 * Star twinkle.
 *
 * Was 0.22 of amplitude at 1.7 rad/s. That is a full two-and-a-quarter cycles a
 * second across every star on screen, which reads as sensor noise.
 */
export const TWINKLE = {
  rate: 0.55,
  amplitude: 0.12,
} as const;