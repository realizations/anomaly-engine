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