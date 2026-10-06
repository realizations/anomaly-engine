/**
 * Story beats: the one channel through which narrative reaches the screen.
 *
 * ## Why
 *
 * Every discovery in this engine has a description and no consequence. Six easter
 * eggs carry strings like "All lights in the town turn on for 10 seconds" and "The
 * observatory door opens slightly", and there was no mechanism anywhere that could
 * carry either out -- the `effect` field was prose that nothing read, while
 * `AnomalyDefinition.effects` was a parallel array of structured intent that the
 * renderer also ignored, because the renderer dispatches on `AnomalyKind` instead.
 *
 * Rather than six bespoke mechanisms, or a seventh entry in the anomaly union with
 * its own cooldown and world-fit rules, this is a single typed union that the
 * renderer knows how to perform. An egg, an anomaly, a moment or a future story pack
 * all emit a beat, and there is exactly one place that decides what a beat looks
 * like.
 *
 * ## Why not reuse the anomaly pipeline
 *
 * Anomalies are rare, rate-limited, world-scoped and journal-worthy. A discovery is
 * a one-off reaction to something the player did. Routing one through the other
 * would mean either marking every discovery as an anomaly -- so it inherits a
 * cooldown and a `very_rare` rarity it does not deserve -- or building a parallel
 * rarity system, which is the same indirection with more paperwork.
 *
 * Beats are deliberately not persisted. An egg that has been found stays found (the
 * `EasterEggSystem` owns that), but the door closing behind you is part of the moment,
 * not a state to restore on the next launch.
 *
 * ## Extending this
 *
 * Add a variant, give it a case in `WorldRenderer._applyStoryBeat` and in whatever
 * draws it, and add its egg entry. The union is the only place a new beat has to be
 * declared, which is the property that keeps the effects honest: a beat cannot exist
 * that nothing performs, and TypeScript will say so rather than letting it sit there
 * as another unread string.
 */

export interface StoryBeatBase {
  /**
   * How long the beat lasts, in milliseconds.
   *
   * The envelope fades in and out inside this window, so the duration includes the
   * transition rather than being the length of a flat hold. A beat that snapped on and
   * off would read as a glitch, which is the wrong register for most of these.
   */
  durationMs: number;
}

export type StoryBeat =
  /** Every window and lamp in the settlement comes on at once. */
  | ({ kind: 'lights-on' } & StoryBeatBase)
  /** The observatory's door stands ajar. */
  | ({ kind: 'observatory-door' } & StoryBeatBase)
  /** The moon brightens once and settles back. */
  | ({ kind: 'moon-pulse' } & StoryBeatBase)
  /** Something moves between the trees. */
  | ({ kind: 'watcher' } & StoryBeatBase)
  /** Text appears on the terminal, replacing the readout. */
  | ({ kind: 'terminal-message'; lines: string[] } & StoryBeatBase)
  /**
   * The terminal's clock shows a different time.
   *
   * `lieMinutes` is an offset in whole minutes, so the clock still reads a plausible
   * time rather than an obvious sentinel like 99:99.
   */
  | ({ kind: 'clock-lie'; lieMinutes: number } & StoryBeatBase);

/** Every beat kind, for tests that assert coverage rather than a hand-copied list. */
export const STORY_BEAT_KINDS = [
  'lights-on',
  'observatory-door',
  'moon-pulse',
  'watcher',
  'terminal-message',
  'clock-lie',
] as const satisfies readonly StoryBeat['kind'][];

export type StoryBeatKind = (typeof STORY_BEAT_KINDS)[number];

/** A beat currently being performed. */
export interface ActiveStoryBeat {
  beat: StoryBeat;
  /** `performance.now()` when it started. */
  startedAt: number;
}

/**
 * How strongly a beat should be applied right now, from 0 to 1.
 *
 * Zero outside the window. Inside it, a short fade in, a hold, and a longer fade out
 * -- asymmetric on purpose, because the interesting moment is the arrival and the
 * departure should not compete with it. Both edges are smoothstepped, so the
 * derivative is zero at each end and the transition cannot read as a step.
 *
 * Returns 0 rather than throwing for a zero or negative duration, because a caller
 * computing `durationMs` from a subtraction can legitimately produce one, and a
 * throw here would take the render loop down over arithmetic.
 */
export function beatEnvelope(startedAt: number, durationMs: number, now: number): number {
  if (!(durationMs > 0)) return 0;
  const t = now - startedAt;
  if (t <= 0 || t >= durationMs) return 0;

  const fadeInMs = Math.min(400, durationMs * 0.18);
  const fadeOutMs = Math.min(900, durationMs * 0.3);

  if (t < fadeInMs) return smoothstep(t / fadeInMs);
  if (t > durationMs - fadeOutMs) return smoothstep((durationMs - t) / fadeOutMs);
  return 1;
}

function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/**
 * Whether a beat still needs drawing.
 *
 * The renderer calls this once per frame and returns early when it is false, so an
 * expired beat costs one comparison rather than a sweep through the scene.
 */
export function isBeatActive(beat: ActiveStoryBeat | null, now: number): boolean {
  return beat !== null && beatEnvelope(beat.startedAt, beat.beat.durationMs, now) > 0;
}