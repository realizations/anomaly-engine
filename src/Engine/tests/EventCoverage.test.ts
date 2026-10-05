import { describe, it, expect } from 'vitest';
import { RANDOM_EVENT_TYPES } from '../src/events/RandomSource.js';

/**
 * Every event the engine emits has somewhere to go.
 *
 * This exists because of a dead subscription. `main.ts` subscribed to
 * `weather.storm_started` and called `triggerLightning`; nothing had ever emitted
 * that event, because weather here is state the renderer reads rather than
 * transitions on the bus. So the handler was a valid function against a valid bus,
 * nothing threw, every test passed, and storms rendered through a complete
 * lightning implementation that could never fire. A dead subscription is the
 * quietest possible bug.
 *
 * The inverse is checked too: an event nothing listens to. Several ambient events
 * are in that state, and they are load-bearing in the sense that they fill the
 * history log and the host's structured output. They are listed explicitly rather
 * than asserted empty, because "no listener" is sometimes deliberate -- and the
 * point is that it stops being a thing anyone has to remember.
 */

/** Events with a specific subscriber that acts on them. */
const HANDLED = new Set([
  'random.meteor',
  'random.second_moon',
  'random.red_moon',
  'random.forest_creature',
  'random.observatory_flash',
  'random.lights_out',
  'time.midnight',
  'time.0333',
]);

/**
 * Events that are deliberately atmospheric: emitted, logged, journalled, and not
 * drawn. Each is a one-shot weather gesture with nothing to animate -- a gust of
 * leaves reads as the wind field moving on its own schedule, which it already does.
 *
 * `time.hourly` is here because it is the clock's heartbeat: the engine needs it in
 * history, and nothing needs to react.
 */
const ATMOSPHERIC = new Set([
  'random.cloud_shift',
  'random.bird_flyby',
  'random.leaves_blow',
  'random.distant_light',
  'random.radio_static',
  'time.hourly',
]);

describe('event bus coverage', () => {
  it('every random event is either handled or explicitly atmospheric', () => {
    const unclassified = RANDOM_EVENT_TYPES.filter(
      (t) => !HANDLED.has(t) && !ATMOSPHERIC.has(t)
    );
    expect(unclassified).toEqual([]);
  });

  it('does not list a handled event as atmospheric', () => {
    // A type in both sets means someone added a handler and forgot to remove the
    // note, and the next reader cannot tell which one is true.
    expect([...HANDLED].filter((t) => ATMOSPHERIC.has(t))).toEqual([]);
  });

  it('does not list an event type that is not emitted', () => {
    // Stale entries are how these tables rot: the rename lands, the note stays, and
    // the table quietly stops describing anything.
    const known = new Set<string>([...RANDOM_EVENT_TYPES, 'time.hourly', 'time.midnight', 'time.0333']);
    const stale = [...HANDLED, ...ATMOSPHERIC].filter((t) => !known.has(t));
    expect(stale).toEqual([]);
  });

  it('covers every random event at least once', () => {
    const covered = new Set([...HANDLED, ...ATMOSPHERIC]);
    expect(RANDOM_EVENT_TYPES.filter((t) => !covered.has(t))).toEqual([]);
  });
});