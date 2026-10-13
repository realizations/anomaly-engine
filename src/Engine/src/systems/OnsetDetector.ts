/**
 * Onset detection for a local audio track.
 *
 * Pure functions over plain arrays, deliberately. The obvious implementation is an
 * `AnalyserNode` and a `getByteFrequencyData` call per frame, which is what
 * `MediaReactivitySystem` was reaching for and why it could never be tested: it needs an
 * `AudioContext`, a running graph and a real decoder, none of which exist in a unit
 * test or in a headless check.
 *
 * Doing it here instead means the interesting part -- "is this a beat, and when" -- is
 * a function from samples to beat times, and can be asserted against a click track
 * with a known tempo. That is the difference between a feature that is verified and a
 * feature that has been run once.
 *
 * The method is spectral-flux-lite: short-time energy in a few bands, differenced
 * against the previous frame, thresholded against a running median. It is not a state
 * of the art onset detector and does not need to be -- the target is a visual pulse
 * that feels like the track, not a percussive transcription of it.
 */

/** A mono sample block in the range [-1, 1]. */
export type Samples = Float32Array;

/** One detected transient. */
export interface Beat {
  /** Seconds from the start of the track. */
  time: number;
  /** How far the energy rose, normalised against the track's own range. 0..1. */
  strength: number;
}

/** Tunable parameters, all with defaults that work on uncompressed music. */
export interface OnsetOptions {
  /** Analysis window length in samples. ~23ms at 44.1kHz. */
  readonly hopSize?: number;
  /** Samples per analysis window. ~46ms at 44.1kHz. */
  readonly windowSize?: number;
  /**
   * How many recent frames the adaptive threshold looks at.
   *
   * This is the parameter that decides what a beat is. A fixed threshold is wrong for
   * every track: set it high enough for a quiet passage and a loud chorus stops
   * pulsing, set it low enough and a sustained pad registers every window. Looking at
   * a running median means the detector tracks the track instead of a constant.
   */
  readonly historyFrames?: number;
  /** Frames that must pass after a beat before another is allowed. ~130ms at 44.1kHz. */
  readonly refractoryFrames?: number;
  /** How far above the local median the energy must rise. Higher ignores more. */
  readonly sensitivity?: number;
/**
   * Noise floor below which nothing counts, as a fraction of the loudest band energy
   * in the whole track.
   *
   * An absolute gate underneath the relative one. Silence, and near-silence, are the
   * case a purely relative threshold cannot handle: the median of the flux in a silent
   * track is also zero, so the threshold is zero and any numerical noise clears it.
   * Comparing against the track's own peak is what makes this meaningful -- the same
   * amplitude is loud in a quiet recording and inaudible in a loud one.
   */
  readonly noiseFloor?: number;
  /**
   * Window RMS below which the track is treated as silent.
   *
   * A physical floor, in the units the samples are in, and deliberately the only
   * absolute number in the detector. Everything above it is relative to the track.
   */
  readonly silenceRms?: number;
}

const DEFAULTS = {
  hopSize: 512,
  windowSize: 1024,
  historyFrames: 43,
  refractoryFrames: 6,
  sensitivity: 2.6,
  noiseFloor: 0.05,
  silenceRms: 1e-4,
} as const;

/**
 * Short-time energy of each hop, in three bands.
 *
 * Bands rather than one number because a single broadband energy figure responds
 * mostly to loudness, so a bass line and a hi-hat look identical. Splitting low, mid
 * and high lets the detector notice a kick on its own and a hat on its own, which is
 * what makes a pulse land on the beat rather than on the chorus.
 */
function bandEnergies(samples: Samples, hop: number, window: number, count: number): Float32Array {
  const frames = Math.max(1, Math.floor((samples.length - window) / hop) + 1);
  const out = new Float32Array(frames * count);

  // Naive DFT at a handful of representative frequencies per band. Four bins is enough
  // to tell the bands apart and costs about 16 multiply-adds per sample, which for a
  // three-minute track at 44.1kHz is a few hundred million operations -- noticeable,
  // so it runs once on load and is never done per frame.
  const bands = [
    [55, 110, 220, 330], // low: bass and kick
    [440, 880, 1760, 2640], // mid: body
    [3520, 5280, 7040, 8800], // high: hats and transients
  ];

  // Hann window.
  //
  // Not optional. A rectangular window has its first sidelobe at only -13dB, and as it
  // slides across a steady tone the leaked energy from one cycle to the next makes the
  // measured band energy ripple at roughly the window's own length -- about 43 times a
  // second here. A real onset detector should see nothing in a sustained tone; without
  // this it sees a couple of dozen "beats" in three seconds of a held note, which is
  // the single most visible way this goes wrong on non-percussive material.
  const hann = new Float32Array(window);
  for (let i = 0; i < window; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (window - 1)));
  }

  for (let frame = 0; frame < frames; frame++) {
    const start = frame * hop;
    for (let b = 0; b < count; b++) {
      let sum = 0;
      for (const freq of bands[b]) {
        const omega = (2 * Math.PI * freq) / 44100;
        let re = 0;
        let im = 0;
        // Strided over four samples: the band frequencies are all below 11kHz, so the
        // signal is well oversampled and the stride aliases into nothing that matters.
        for (let i = 0; i < window; i += 4) {
          const s = (samples[start + i] ?? 0) * hann[i];
          re += s * Math.cos(omega * i);
          im += s * Math.sin(omega * i);
        }
        sum += Math.sqrt(re * re + im * im) / (window / 4);
      }
      out[frame * count + b] = sum;
    }
  }
  return out;
}

/** Median of a numeric array, without sorting the caller's array. */
function median(values: Float32Array, from: number, to: number): number {
  const slice = Array.from(values.subarray(from, to)).sort((a, b) => a - b);
  if (!slice.length) return 0;
  const mid = slice.length >> 1;
  return slice.length % 2 ? slice[mid] : (slice[mid - 1] + slice[mid]) / 2;
}

/**
 * Finds the transients in a mono track.
 *
 * Returns beats in time order, which matters because the caller plays them as a
 * sequence: an out-of-order list produces a pulse that jumps backwards, which reads as
 * a glitch rather than as a rhythm.
 */
export function detectBeats(samples: Samples, sampleRate = 44100, options: OnsetOptions = {}): Beat[] {
  const hop = options.hopSize ?? DEFAULTS.hopSize;
  const window = options.windowSize ?? DEFAULTS.windowSize;
  const history = options.historyFrames ?? DEFAULTS.historyFrames;
  const refractory = options.refractoryFrames ?? DEFAULTS.refractoryFrames;
  const sensitivity = options.sensitivity ?? DEFAULTS.sensitivity;
  const noiseFloor = options.noiseFloor ?? DEFAULTS.noiseFloor;
  const silenceRms = options.silenceRms ?? DEFAULTS.silenceRms;

  if (samples.length < window * 2) return [];

  // The silence gate comes first because it is the only one that costs nothing: a
  // track with no measurable level in it cannot have transients, whatever its flux
  // looks like.
  let energy = 0;
  for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i];
  if (Math.sqrt(energy / samples.length) < silenceRms) return [];

  const bands = bandEnergies(samples, hop, window, 3);
  const frames = Math.floor(bands.length / 3);

  // One peak across every band, not one per band.
  //
  // Normalising each band against its own maximum looks more principled and is badly
  // wrong. A pure 220Hz tone puts almost nothing in the 55Hz band -- what little is
  // there is spectral leakage, and it ripples by a factor of two as the window slides.
  // Divided by its own peak, that leakage becomes a flux of 1.0 and a held note is
  // reported as a dozen onsets. Against the loudest thing in the whole track it is
  // four thousandths and stays below the noise floor, which is what should happen.
  //
  // The cost is that a genuinely quiet high band counts for less. That is the correct
  // trade: a hat that is audible but 30dB below the bass is not what should drive a
  // full-screen visual pulse.
  let globalPeak = 0;
  for (let f = 0; f < frames; f++) {
    for (let b = 0; b < 3; b++) {
      const v = bands[f * 3 + b];
      if (v > globalPeak) globalPeak = v;
    }
  }
  if (globalPeak <= 0) return [];

  const flux = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    let total = 0;
    for (let b = 0; b < 3; b++) {
      const current = bands[f * 3 + b];
      const previous = bands[(f - 1) * 3 + b];
      total += Math.max(0, current - previous) / globalPeak;
    }
    flux[f] = total / 3;
  }

  /*
   * Subtract a short moving average rather than the single previous frame.
   *
   * Frame-to-frame differencing cannot tell a transient from the slow ripple that
   * sliding a window across any steady sound produces: a Hann window still loses up to
   * 1.4dB at the edges of a cycle, so the band energy of a held note breathes by a few
   * percent every hop, and that breathes straight through the noise floor. A three-frame
   * baseline averages that ripple away while leaving a transient -- which lasts one or
   * two frames -- intact. This is the standard formulation and it is the difference
   * between a sustained tone producing no beats and producing a dozen.
   */
  const smoothed = new Float32Array(frames);
  const BASELINE = 3;
  for (let f = 1; f < frames; f++) {
    let sum = 0;
    let count = 0;
    for (let back = 1; back <= BASELINE && f - back >= 1; back++) {
      sum += flux[f - back];
      count++;
    }
    smoothed[f] = count ? sum / count : flux[f];
  }

  const beats: Beat[] = [];
  let lastBeatFrame = -refractory;
  const floorSamples = Math.max(1, history);

  for (let f = 1; f < frames; f++) {
    const value = flux[f];
    const rise = value - smoothed[f];

    // Relative to the track's loudest moment. A rise, not a level: a loud passage held
    // steady has high flux relative to nothing and no rise at all.
    if (rise < noiseFloor) continue;

    // A beat is a peak, not an excursion.
    if (value < (flux[f - 1] ?? 0)) continue;
    if (f + 1 < frames && value < flux[f + 1]) continue;

    // Relative to the local median, as a ratio rather than a product.
    //
    // A product threshold (`median * 1.35`) is the textbook form and it is wrong when
    // the median is near zero: the threshold stays near zero, and in a noisy passage
    // plenty of frames clear it. A ratio cannot be satisfied by noise sitting on top of
    // other noise, because noise-to-noise ratios are rarely large.
    const medianValue = median(flux, Math.max(1, f - floorSamples), f);
    if (value < medianValue * sensitivity) continue;

    if (f - lastBeatFrame < refractory) continue;

    lastBeatFrame = f;
    beats.push({
      time: (f * hop) / sampleRate,
      strength: Math.min(1, value / Math.max(medianValue * sensitivity, 1e-6)),
    });
  }

  return beats;
}

/**
 * A short-window energy envelope, for the continuous part of the response.
 *
 * Returned rather than sampled on demand because the caller wants it on every frame
 * and recomputing an RMS over 1024 samples every frame for an hour of wallpaper is
 * 180 million operations of work nobody asked for. One pass up front, one lookup per
 * frame.
 */
export function energyEnvelope(samples: Samples, hop = 512): Float32Array {
  const frames = Math.max(1, Math.floor(samples.length / hop));
  const out = new Float32Array(frames);
  let peak = 0;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const start = f * hop;
    for (let i = 0; i < hop; i++) {
      const s = samples[start + i] ?? 0;
      sum += s * s;
    }
    const rms = Math.sqrt(sum / hop);
    out[f] = rms;
    if (rms > peak) peak = rms;
  }
  if (peak > 0) for (let f = 0; f < frames; f++) out[f] /= peak;
  return out;
}

/**
 * The first beat that became due between two clock readings.
 *
 * Returns the beat, or null. `afterTime` is exclusive and `positionSeconds` inclusive,
 * so calling it repeatedly with the previous result's time advances exactly one beat
 * per call and never the same one twice.
 *
 * The half-open interval is the whole point. A caller stepping its clock coarsely --
 * a slow frame, or a background tab -- gets one beat rather than every beat it slept
 * through, which is the burst of pulses that an edge-triggered system produces when it
 * finally looks at the clock. It also means a fast frame rate cannot fire a beat twice,
 * because the interval has already moved past it.
 */
export function beatDueSince(
  beats: Beat[],
  positionSeconds: number,
  afterTime: number
): Beat | null {
  for (const beat of beats) {
    if (beat.time <= afterTime) continue;
    if (beat.time > positionSeconds) return null;
    return beat;
  }
  return null;
}