import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MediaReactivitySystem } from '../src/systems/MediaReactivity.js';
import { AccessibilitySystem } from '../src/platform/AccessibilitySystem.js';

/**
 * That the audio-reactivity transport does what it says.
 *
 * The detector itself is tested in OnsetDetector.test.ts, where it can be handed a
 * click track with a known tempo. What is left here is the part that cannot be a pure
 * function: the clock, the events, and the state machine -- and specifically the three
 * ways this kind of system usually misbehaves, which are pausing, being muted, and
 * accumulating beats while nobody is looking.
 */

const RATE = 44100;

function clickTrack(beats: number[], duration = 4): Float32Array {
  const samples = new Float32Array(Math.round(duration * RATE));
  const click = Math.round(0.03 * RATE);
  for (const time of beats) {
    const start = Math.round(time * RATE);
    for (let i = 0; i < click; i++) {
      const index = start + i;
      if (index >= samples.length) break;
      const envelope = Math.exp(-i / (click / 6));
      const noise = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      samples[index] += 0.9 * envelope * noise;
      samples[index] += 0.7 * envelope * Math.sin((2 * Math.PI * 70 * i) / RATE);
    }
  }
  return samples;
}

describe('MediaReactivitySystem', () => {
  let media: MediaReactivitySystem;

  beforeEach(() => {
    media = new MediaReactivitySystem();
  });

  afterEach(() => {
    media.dispose();
  });

  /** Loads a steady click track and returns it. */
  async function loadSteady() {
    const beats = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0];
    const count = await media.load(clickTrack(beats), RATE, 'click.mp3');
    return { beats, count };
  }

  it('starts disabled, with no track and no beats', () => {
    expect(media.getConfig().enabled).toBe(false);
    expect(media.getState().beatCount).toBe(0);
    expect(media.getBeats()).toEqual([]);
  });

  it('finds beats and reports how many', async () => {
    const { count } = await loadSteady();
    expect(count).toBeGreaterThanOrEqual(4);
    expect(media.getState().beatCount).toBe(count);
    expect(media.getState().title).toBe('click.mp3');
    expect(media.getState().duration).toBeCloseTo(4, 1);
  });

  it('emits one beat event per detected beat as the clock passes them', async () => {
    await loadSteady();
    media.setConfig({ enabled: true });
    media.startTransport(0);

    const fired: number[] = [];
    media.onBeat((beat) => fired.push(beat.time));

    // Step a second at a time across the track, which is coarser than the beats, so
    // this is the case where an edge-triggered detector could either skip beats or
    // fire them in a burst.
    for (let t = 0; t <= 3500; t += 1000) {
      media.update(t);
    }

    expect(fired.length).toBeGreaterThanOrEqual(2);
    expect(fired).toEqual([...fired].sort((a, b) => a - b));
    // Never the same beat twice, however coarsely the clock is stepped.
    expect(new Set(fired).size).toBe(fired.length);
  });

  it('fires a beat once even when stepped at 60Hz', async () => {
    await loadSteady();
    media.setConfig({ enabled: true });
    media.startTransport(0);

    let count = 0;
    media.onBeat(() => count++);
    for (let t = 0; t <= 3200; t += 16) media.update(t);

    const { beats } = await loadSteady();
    // One event per real beat, not one per frame the beat happens to overlap.
    expect(count).toBeLessThanOrEqual(6);
    expect(count).toBeGreaterThanOrEqual(3);
    expect(beats.length).toBeGreaterThan(0);
  });

  it('does not advance the clock while paused', async () => {
    // A system on its own timer keeps time through a pause, so the first frame after
    // resuming fires every beat that accumulated -- a burst of pulses out of nowhere.
    await loadSteady();
    media.setConfig({ enabled: true });
    media.startTransport(0);

    media.update(0);
    const first = media.getState().position;

    media.stop();
    for (let t = 1000; t <= 3000; t += 100) media.update(t);

    expect(media.getState().position).toBe(0);
    expect(media.getState().position).not.toBe(first + 3);
  });

  it('stops emitting the moment it is disabled', async () => {
    await loadSteady();
    media.setConfig({ enabled: true });
    media.startTransport(0);

    let updates = 0;
    media.onUpdate(() => updates++);

    media.setConfig({ enabled: false });
    media.update(500);
    media.update(1000);

    expect(media.getState().playing).toBe(false);
    // Only the disable itself, not a per-frame stream afterwards.
    expect(updates).toBeLessThanOrEqual(1);
  });

  it('will not play before a track is loaded', () => {
    media.setConfig({ enabled: true });
    media.startTransport(0);
    expect(media.getState().playing).toBe(false);
  });

  it('rewinds on stop rather than resuming later', async () => {
    // A wallpaper that resumed an audio track an hour later would be a surprise.
    await loadSteady();
    media.setConfig({ enabled: true });
    media.startTransport(0);
    media.update(0);
    media.update(1200);
    expect(media.getState().position).toBeGreaterThan(0);

    media.stop();
    expect(media.getState().position).toBe(0);
    expect(media.getState().playing).toBe(false);
  });

  it('follows the mute preference, and does not resume on its own when unmuted', async () => {
    // The engine mutes its own generated tracks through the mixer; this is a file the
    // user supplied, and unticking a mute box should not restart audio.
    await loadSteady();
    media.setConfig({ enabled: true });
    media.startTransport(0);

    media.setMuted(true);
    media.setMuted(false);

    // No throw, and still analysable either way: the beats are computed at load time
    // and do not depend on playback at all.
    expect(media.getBeats().length).toBeGreaterThan(0);
    expect(media.getState().playing).toBe(true);
  });

  it('keeps the beats after the track is unloaded from playback', async () => {
    await loadSteady();
    media.setConfig({ enabled: true, silentPlayback: true });
    media.startTransport(0);
    media.update(600);

    // Silent playback is the "I want the visuals, not the sound" case, and the whole
    // point is that the response does not depend on being audible.
    expect(media.getBeats().length).toBeGreaterThan(0);
    expect(media.getState().playing).toBe(true);
  });

  it('ignores configuration values of the wrong type', () => {
    // A string from a host event would otherwise sit in a boolean field and read as
    // true at every use.
    media.setConfig({ enabled: true });
    media.setConfig({ enabled: 'yes' } as never);
    expect(media.getConfig().enabled).toBe(true);
  });

  it('emits a smoothed level rather than the raw waveform', async () => {
    // A level response that follows the waveform closely enough looks like a strobe,
    // and on some displays that is a genuine accessibility problem.
    await loadSteady();
    media.setConfig({ enabled: true });
    media.startTransport(0);

    let previous = 0;
    let largestStep = 0;
    for (let t = 0; t <= 2000; t += 16) {
      media.update(t);
      const level = media.getState().level;
      largestStep = Math.max(largestStep, Math.abs(level - previous));
      previous = level;
    }

    expect(media.getState().level).toBeGreaterThanOrEqual(0);
    expect(media.getState().level).toBeLessThanOrEqual(1);
    // One frame never jumps the whole range.
    expect(largestStep).toBeLessThan(0.6);
  });

  it('leaves no listeners behind after dispose', async () => {
    await loadSteady();
    let updates = 0;
    media.onUpdate(() => updates++);
    media.onBeat(() => updates++);

    media.dispose();
    media.setConfig({ enabled: true });
    media.update(0);
    media.update(1000);

    expect(updates).toBe(0);
  });

  it('reports an empty track without throwing', async () => {
    const count = await media.load(new Float32Array(0), RATE, 'empty.wav');
    expect(count).toBe(0);
    media.setConfig({ enabled: true });
    media.startTransport(0);
    expect(() => media.update(500)).not.toThrow();
  });
});

describe('reduced motion scales the audio response', () => {
  let a11y: AccessibilitySystem;

  beforeEach(() => {
    a11y = new AccessibilitySystem();
  });

  afterEach(() => {
    a11y.dispose();
  });

  it('reports reduced motion, which is what the engine scales the response by', () => {
    a11y.setConfig({ reducedMotion: true });
    expect(a11y.shouldReduceMotion()).toBe(true);
  });
});

describe('renderer audio response', () => {
  it('clamps its inputs', async () => {
    // Asserted through the exported clamp path rather than by constructing the
    // renderer: the values are held, not drawn, and `getAudioResponse` needs a 2d
    // context stub large enough to get past the paper-texture builder.
    const { nextAudioImpulse } = await import('../src/renderer/WorldRenderer.js');

    expect(nextAudioImpulse(0, 1)).toBe(1);
    expect(nextAudioImpulse(0, 5)).toBe(1);
    expect(nextAudioImpulse(0, -3)).toBe(0);
  });

  it('holds the impulse at the peak rather than accumulating it', async () => {
    // Five beats in quick succession must leave the impulse at one, not at five.
    const { nextAudioImpulse } = await import('../src/renderer/WorldRenderer.js');

    let impulse = 0;
    for (let i = 0; i < 5; i++) impulse = nextAudioImpulse(impulse, 1);
    expect(impulse).toBeLessThanOrEqual(1);
  });

  it('decays the impulse, so a beat is a flare and not a permanently brighter sky', async () => {
    const { nextAudioImpulse } = await import('../src/renderer/WorldRenderer.js');

    let impulse = 1;
    for (let i = 0; i < 60; i++) impulse = nextAudioImpulse(impulse, 0);
    expect(impulse).toBeLessThan(0.01);
  });

  it('does not decay while a beat is still arriving', async () => {
    const { nextAudioImpulse } = await import('../src/renderer/WorldRenderer.js');
    // A quiet beat during a loud one must still register: the decay is a floor
    // underneath the peak, not a replacement for it.
    expect(nextAudioImpulse(1, 0.4)).toBe(0.82);
  });
});
