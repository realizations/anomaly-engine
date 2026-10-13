/**
 * Window event names, in one place.
 *
 * Creator mode drives the world by dispatching `CustomEvent`s on `window` rather
 * than by holding a reference to the engine, which is the right shape for a panel
 * that is opened and closed independently of the engine's lifetime. The cost is
 * that the sender and the receiver name the event independently, in two different
 * files, as bare strings -- and nothing checks that they agree.
 *
 * That is not hypothetical. Creator mode dispatched five events and `main.ts`
 * listened for none of them: Set Time, Set Weather, Reload World, Trigger Event and
 * Screenshot were five buttons that did nothing when clicked, in a panel reachable
 * from the tray and from Ctrl+Alt+C. Nothing threw. The buttons looked correct.
 *
 * So the names live here, both sides import them, and a rename is now a build error
 * instead of a silently unhooked control.
 *
 * Events sent *to* the renderer by the host process (`anomaly:state` and friends)
 * are listed here too. Nothing in the renderer dispatches those, so the coverage
 * test only asserts one direction -- every dispatched event has a listener -- but
 * having them all in one list means a new channel gets declared rather than
 * invented at the call site.
 */
export const WINDOW_EVENTS = {
  /** Host -> renderer: a persisted state blob to adopt on startup. */
  state: 'anomaly:state',
  /** Host -> renderer: pause rendering. */
  pause: 'anomaly:pause',
  /** Host -> renderer: resume rendering. */
  resume: 'anomaly:resume',
  /** Host -> renderer: switch render style (painterly | flat | riso). */
  style: 'anomaly:style',
  /** Host -> renderer: toggle the debug overlay. */
  debug: 'anomaly:debug',
  /** Host -> renderer: open creator mode. */
  creator: 'anomaly:creator',
  /** Host -> renderer: switch world by id. */
  world: 'anomaly:world',
  /** Host -> renderer: next world in the registry. */
  worldNext: 'anomaly:world-next',
  /** Host -> renderer: previous world in the registry. */
  worldPrev: 'anomaly:world-prev',
  /** Host -> renderer: replace the monitor layout. */
  monitors: 'anomaly:monitors',
  /** Host -> renderer: register a batch of custom world definitions. */
  worlds: 'anomaly:worlds',
  /** Host -> renderer: remove a custom world by id. */
  worldRemove: 'anomaly:world-remove',
  /** Host -> renderer: force reduced motion on or off. */
  reducedMotion: 'anomaly:reduced-motion',
  /** Host -> renderer: fire a random anomaly. */
  trigger: 'anomaly:trigger',
  /** Host -> renderer: toggle the field-notes panel. */
  notes: 'anomaly:notes',
  /** Host -> renderer: switch interface language, by locale code. */
  locale: 'anomaly:locale',
/**
 * A name and a value rather than a whole config, so a settings control cannot send
 * a field the renderer does not have, and so adding a preference needs one event
 * rather than a change of shape. The names are validated against
 * `AccessibilitySystem.KEYS` on arrival: an unknown name is logged and dropped
 * rather than stored as a key nobody reads, which is the failure this gate exists to
 * make impossible to repeat.
 *
 * The marker line is on its own because `tools/verify-host-events.mjs` reads a
 * single-line comment immediately above the entry to decide whether a host is allowed
 * to send it. A multi-line comment above a one-line marker, or the marker inside a
 * block comment, both read as "the page dispatches this at itself" -- which is wrong,
 * and wrong in the direction that makes the check refuse to protect the event.
 */
/** Host -> renderer: set one accessibility preference, by name. */
  accessibility: 'anomaly:accessibility',

  /** Creator mode -> renderer: pin the simulated clock. */
  setTime: 'anomaly:set-time',
  /** Creator mode -> renderer: force a weather condition. */
  setWeather: 'anomaly:set-weather',
  /** Creator mode -> renderer: rebuild the current world from its definition. */
  reloadWorld: 'anomaly:reload-world',
  /** Creator mode -> renderer: emit one named bus event by id. */
  triggerEvent: 'anomaly:trigger-event',
  /** Creator mode -> renderer: save a PNG of the current frame. */
  screenshot: 'anomaly:screenshot',
  /** Interaction -> renderer: a zone was triple-clicked. */
  tripleClick: 'anomaly:triple-click',
} as const;

export type WindowEventName = (typeof WINDOW_EVENTS)[keyof typeof WINDOW_EVENTS];

/**
 * Events internal to the renderer, between a panel and the thing that opened it.
 *
 * Separate from `WINDOW_EVENTS` because none of these cross the host boundary: they
 * exist so that `AccessibilitySystem` can dismiss whatever panel is on top without
 * holding a reference to any of them, which is what keeps adding a panel from being a
 * change to the accessibility code.
 */
export const PANEL_EVENTS = {
  /** Panel -> anything listening: close me. */
  dismiss: 'anomaly:panel-dismiss',
} as const;