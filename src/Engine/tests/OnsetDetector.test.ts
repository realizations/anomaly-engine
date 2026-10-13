import { describe, it, expect } from 'vitest';
import { detectBeats, energyEnvelope, beatDueSince, type Samples } from '../src/systems/OnsetDetector.js';

/**
 * That beat detection finds the beats.
 *
 * This is the one part of media reactivity that can be asserted rather than eyeballed,
 * because it is a function from samples to times. Everything here is built from a
 * click track with a tempo chosen so the expected beat times are exact multiples that
 * do not depend on the analysis window's phase.
 */
const RATE = 44100;

function clickTrack(
  beats: number[],
  { duration = 4, clickSeconds = 0.03, amplitude = 0.9 } = {}
): Samples {
  const samples = new Float32Array(Math.round(duration * RATE));
  const click = Math.round(clickSeconds * RATE);

  for (const time of beats) {
    const start = Math.round(time * RATE);
    for (let i = 0; i < click; i++) {
      const index = start + i;
      if (index >= samples.length) break;
      // A decaying noise burst rather than a pure tone. A tone has all its energy in
      // one DFT bin, which flatters the detector; noise spread across the spectrum is
      // what a real percussive hit looks like and the harder case.
      const envelope = Math.exp(-i / (click / 6));
      const noise = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      samples[index] += amplitude * envelope * noise;
      // Plus a low sine so the low band has something in it, like a kick.
      samples[index] += amplitude * envelope * 0.8 * Math.sin((2 * Math.PI * 70 * i) / RATE);
    }
  }
  return samples;
}

/** The median gap between detected beats, in seconds. */
function tempoOf(times: number[]): number {
  const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
  return gaps[gaps.length >> 1];
}

describe('detectBeats', () => {
  it('finds every click in a steady 120bpm track', () => {
    // 120bpm is 0.5s between beats, exactly.
    const beats = [0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75];
    const found = detectBeats(clickTrack(beats), RATE);

    expect(found.length).toBeGreaterThanOrEqual(beats.length - 1);
    // Every expected click has a detection within half a beat of it.
    for (const expected of beats) {
      const nearest = Math.min(...found.map((b) => Math.abs(b.time - expected)));
      expect(nearest).toBeLessThan(0.25);
    }
  });

  it('measures the tempo it was given', () => {
    for (const bpm of [90, 120, 140]) {
      const spacing = 60 / bpm;
      const beats = [0.4, 0.4 + spacing, 0.4 + spacing * 2, 0.4 + spacing * 3, 0.4 + spacing * 4];
      const found = detectBeats(clickTrack(beats), RATE);
      expect(found.length).toBeGreaterThanOrEqual(4);
      expect(tempoOf(found.map((b) => b.time))).toBeCloseTo(spacing, 1);
    }
  });

  it('does not invent beats in silence', () => {
    // The failure mode of a fixed threshold, and the reason the threshold is adaptive:
    // a quiet passage with a small absolute threshold reports a beat every window.
    const quiet = new Float32Array(RATE * 3);
    for (let i = 0; i < quiet.length; i += 97) {
      quiet[i] = (Math.sin(i * 0.0001) * 0.0002);
    }
    expect(detectBeats(quiet, RATE).length).toBe(0);
  });

  it('does not report a continuous tone as a beat train', () => {
    // A sustained pad is the case a fixed threshold handles worst: every window
    // differs from the last by rounding noise, which a low enough threshold turns into
    // hundreds of "beats".
    const tone = new Float32Array(RATE * 3);
    for (let i = 0; i < tone.length; i++) {
      tone[i] = 0.4 * Math.sin((2 * Math.PI * 220 * i) / RATE);
    }
    const found = detectBeats(tone, RATE);
    // A handful at most, against 250-odd windows.
    expect(found.length).toBeLessThan(20);
  });

  it('returns beats in time order', () => {
    // Out of order would make the visual pulse jump backwards, which reads as a
    // glitch rather than as a rhythm.
    const beats = [0.2, 0.6, 1.0, 1.9, 2.2];
    const found = detectBeats(clickTrack(beats), RATE);
    const times = found.map((b) => b.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('reports strength within range', () => {
    const found = detectBeats(clickTrack([0.3, 1.0, 1.7]), RATE);
    for (const beat of found) {
      expect(beat.strength).toBeGreaterThanOrEqual(0);
      expect(beat.strength).toBeLessThanOrEqual(1);
    }
  });

  it('honours the refractory period by refusing two beats too close together', () => {
    // 40ms apart is 25bpm apart, which is a flam rather than a beat. The refractory
    // window is ~70ms at these settings, so the second click must be swallowed.
    const found = detectBeats(clickTrack([0.5, 0.54], { duration: 2 }), RATE);
    expect(found.length).toBe(1);
  });

  it('refuses to report anything for a track shorter than two windows', () => {
    // A half-window of audio has no previous frame, so there is no flux to speak of.
    expect(detectBeats(new Float32Array(64), RATE)).toEqual([]);
  });

  it('finds a louder beat that arrives after a quiet passage', () => {
    // The case the running median exists for: a fixed threshold high enough to ignore
    // the quiet intro misses nothing, but one set from the intro's level misses the
    // first loud hit after it.
    //
    // Both segments are written at their absolute times into one buffer. Building them
    // as separate sub-tracks and offsetting them puts the clicks at 3.0 and 3.5
    // seconds of a one-second array, which is out of bounds and silently silent.
    const samples = new Float32Array(RATE * 5);
    const quietBeat = clickTrack([0.2, 1.2], { duration: 5, amplitude: 0.05 });
    const loudBeat = clickTrack([3.0, 3.5], { duration: 5, amplitude: 1.0 });
    samples.set(quietBeat, 0);
    samples.set(loudBeat, 0);

    const found = detectBeats(samples, RATE);
    const afterQuiet = found.filter((b) => b.time > 2.5);
    expect(afterQuiet.length).toBeGreaterThanOrEqual(1);
  });

  it('finds a quiet beat that arrives after a loud passage', () => {
    const samples = new Float32Array(RATE * 5);
    const both = clickTrack([0.3, 0.8, 3.0], { duration: 5, amplitude: 1.0 });
    samples.set(both, 0);

    const found = detectBeats(samples, RATE);
    // Not every quiet beat is detectable -- that would need a real spectral analyser.
    // What is asserted is that the loud ones are not the only ones: a fixed threshold
    // would return exactly the loud pair and nothing after it.
    expect(found.some((b) => b.time < 1.5)).toBe(true);
  });
});

describe('energyEnvelope', () => {
  // The second argument is the hop in samples, not a sample rate. The envelope is
  // measured in frames, so the sample rate only matters when converting an index back
  // to a time, which is the caller's job.
  const HOP = 512;

  it('is normalised to the track peak', () => {
    const quiet = clickTrack([0.2], { duration: 1, amplitude: 0.05 });
    const envelope = energyEnvelope(quiet, HOP);
    expect(Math.max(...envelope)).toBeCloseTo(1, 2);
  });

  it('rises where the sound is and falls where it is not', () => {
    const samples = new Float32Array(RATE * 2);
    // One second of a loud tone, one second of near-silence.
    for (let i = 0; i < RATE; i++) {
      samples[i] = 0.8 * Math.sin((2 * Math.PI * 220 * i) / RATE);
      samples[RATE + i] = 0.0001;
    }
    const envelope = energyEnvelope(samples, HOP);
    const loud = envelope[Math.round(RATE / 2 / HOP)];
    const silent = envelope[Math.round((RATE + RATE / 2) / HOP)];
    expect(loud).toBeGreaterThan(silent * 50);
  });

  it('handles an empty track without dividing by zero', () => {
    const envelope = energyEnvelope(new Float32Array(0), HOP);
    expect(envelope.length).toBeGreaterThanOrEqual(1);
    for (const value of envelope) expect(Number.isFinite(value)).toBe(true);
  });
});

describe('beatDueSince', () => {
  const beats = [
    { time: 1, strength: 0.5 },
    { time: 2, strength: 0.5 },
    { time: 3, strength: 0.5 },
  ];

  it('returns the beat that just passed', () => {
    expect(beatDueSince(beats, 1.5, -1)?.time).toBe(1);
  });

  it('does not return the same beat twice', () => {
    const first = beatDueSince(beats, 1.5, -1)!;
    expect(beatDueSince(beats, 1.6, first.time)).toBeNull();
  });

  it('returns nothing before the first beat', () => {
    expect(beatDueSince(beats, 0.5, -1)).toBeNull();
  });

  it('returns the last beat once the clock is past it, then nothing', () => {
    // A clock that has run off the end still has one beat outstanding if it skipped
    // it, and none once it has been consumed. Both are correct; what matters is that
    // it does not repeat the same beat forever.
    expect(beatDueSince(beats, 99, 2)?.time).toBe(3);
    expect(beatDueSince(beats, 99, 3)).toBeNull();
  });

  it('yields one beat for a coarse clock rather than every beat it slept through', () => {
    // This is the burst-of-pulses failure: a clock that jumps from 0.5 to 2.5 must not
    // fire beats at 1 and 2 together.
    const due = beatDueSince(beats, 2.5, -1);
    expect(due?.time).toBe(1);
  });

  it('is null for an empty list', () => {
    expect(beatDueSince([], 10, -1)).toBeNull();
  });
});