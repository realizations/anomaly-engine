/**
 * The one list of effects a feed is allowed to cause.
 *
 * This file exists because the six names used to be written down six times.
 *
 *   - `AnomalyKind` in `WorldRenderer.ts`, the union the renderer draws against.
 *   - `ANOMALY_KINDS` in `FeedMapper.ts`, "mirrored from the renderer's union".
 *   - `BUILT_IN_ANOMALIES` in `builtin.ts`, the journal's definitions.
 *   - `generic()` in `worldFlavor.ts`, the fallback flavour table.
 *   - the `durations` table in `main.ts`, when a manual trigger fires one.
 *
 * Five lists, one contract, and a security boundary resting on the agreement between
 * two of them. The drift risk was not hypothetical: the no-network gate exists
 * specifically to catch `FeedMapper` offering an effect `WorldRenderer` cannot draw,
 * which is a gate firing on a real class of bug rather than a hypothetical one.
 *
 * So the names are derived here, from a `const` tuple, and every other module imports
 * them. `AnomalyKind` is a union computed from `EFFECT_IDS`, which means adding a
 * seventh effect is one entry in one file and the compiler finds every place that
 * switches over the union.
 *
 * This is also what makes the settings window's rule editor possible. To offer a
 * dropdown of effects that cannot invent one, it has to ask a registry rather than
 * hold its own list -- otherwise the picker and the mapper are two authorities, and the
 * picker is the one a user can reach.
 */

/**
 * The identifiers, in the order the settings window presents them.
 *
 * Order is presentation, not priority: it groups the three that are cosmic and can
 * happen anywhere before the two that need a landscape to hide in, and ends on the
 * one that is a whole-scene interruption. Changing the order changes the rule
 * editor's dropdown and nothing else, so it is free to art-direct.
 */
export const EFFECT_IDS = [
  'second-moon',
  'red-moon',
  'meteor',
  'observatory-signal',
  'forest-watcher',
  'lights-out',
] as const;

/** Every effect id, as a type. The renderer cannot draw an id that is not in here. */
export type AnomalyKind = (typeof EFFECT_IDS)[number];

/** Whether a string names a registered effect. Exported for the settings window's check. */
export function isAnomalyKind(value: unknown): value is AnomalyKind {
  return typeof value === 'string' && (EFFECT_IDS as readonly string[]).includes(value);
}

/**
 * Presentation metadata for a registered effect.
 *
 * Every field is static and safe. None of it is ever read from a feed document, which
 * is the point: the description and the glyph are compiled into the binary, so a
 * headline cannot supply a rule's label, only which of these six to select.
 */
export interface EffectInfo {
  id: AnomalyKind;
  /** The name the journal and the rule editor both use. */
  name: string;
  /** One line describing what the user will see. */
  description: string;
  /**
   * A short label for the effect's category, shown in the archive.
   *
   * Deliberately not the `AnomalyCategory` enum from `AnomalyRegistry.ts`. That one
   * classifies how the anomaly *system* schedules an effect; this one describes what
   * the effect looks like from the outside, and conflating them would mean a
   * presentation change silently altering scheduling semantics.
   */
  family: 'sky' | 'signal' | 'behaviour';
  /**
   * How long the effect lasts, in seconds, when triggered deliberately.
   *
   * This is the table that used to live inline in `main.ts`. It is here because it is
   * part of describing an effect, and a table of durations kept apart from the table
   * of effects is a table that goes stale.
   */
  durationSeconds: number;
  /**
   * Whether the effect needs a particular landscape to make sense.
   *
   * Shown in the editor so a user does not map "something moves between the trees"
   * onto a salt flat and then spend an evening wondering why it never fires. The
   * runtime check is `AnomalySystem.fitsWorld`; this is the honest label for it.
   */
  needsLandscape?: string;
}

const INFO: readonly EffectInfo[] = [
  {
    id: 'second-moon',
    name: 'Second Moon',
    description: 'A second moon rises low on the horizon and is gone within seconds.',
    family: 'sky',
    durationSeconds: 8,
  },
  {
    id: 'red-moon',
    name: 'Red Moon',
    description: 'The moon runs red and holds for five minutes.',
    family: 'sky',
    durationSeconds: 300,
  },
  {
    id: 'meteor',
    name: 'Meteor',
    description: 'Something crosses the sky quickly, trailing light, and is gone.',
    family: 'sky',
    durationSeconds: 4,
  },
  {
    id: 'observatory-signal',
    name: 'Observatory Signal',
    description: 'The observatory dish turns on its own and holds, aimed at nothing.',
    family: 'signal',
    durationSeconds: 30,
    needsLandscape: 'A world with an observatory',
  },
  {
    id: 'forest-watcher',
    name: 'Watcher in the Pines',
    description: 'Something moves between the trees, well back from the cabins.',
    family: 'behaviour',
    durationSeconds: 12,
    needsLandscape: 'A temperate forest',
  },
  {
    id: 'lights-out',
    name: 'Lights Out',
    description: 'Every light in the valley goes off at once, then returns.',
    family: 'behaviour',
    durationSeconds: 10,
    needsLandscape: 'A valley, a coast or a settlement',
  },
];

const BY_ID = new Map<AnomalyKind, EffectInfo>(INFO.map((e) => [e.id, e]));

/** Every registered effect, in presentation order. The rule editor's dropdown. */
export const REGISTERED_EFFECTS: readonly EffectInfo[] = INFO;

/** Metadata for one effect, or undefined if the id is not registered. */
export function effectInfo(id: AnomalyKind): EffectInfo {
  const found = BY_ID.get(id);
  if (!found) {
    // Unreachable for a value that has passed `isAnomalyKind`, which is why it throws
    // rather than returning a placeholder. A silent fallback here would render a
    // plausible-looking effect the engine cannot actually draw.
    throw new Error(`Unregistered effect: ${id}`);
  }
  return found;
}

/**
 * The display name for an effect id, tolerant of a value that is not registered.
 *
 * For log lines and persisted state read back from an older or hand-edited file, where
 * throwing would turn a display problem into a crash. The mapper never reaches this
 * with an unregistered value -- `isAnomalyKind` has already refused it.
 */
export function effectName(id: string): string {
  return BY_ID.get(id as AnomalyKind)?.name ?? id;
}