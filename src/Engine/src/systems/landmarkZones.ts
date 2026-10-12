/**
 * Turning scene geometry into somewhere to point.
 *
 * ## Why this is separate from both sides
 *
 * `WorldRenderer` knows where everything is. `InteractionSystem` knows how to detect a
 * cursor over a region. Neither knows which regions are *interesting*, and until
 * something did, `InteractionSystem.registerZone` was never called by anything: the
 * zone map stayed empty, `_checkClick` iterated nothing, and the `triple-click:
 * observatory` egg had no path to fire. Both systems were fully built and
 * completely unreachable.
 *
 * This module is the missing third piece, and it is deliberately pure -- geometry in,
 * descriptors out, no DOM and no engine. That keeps the decision "is the observatory
 * worth a click zone, and what should it say when you do" testable without a canvas,
 * and it means changing a hint is a one-line edit rather than a renderer change.
 *
 * ## Why the zones are curated rather than generated
 *
 * It would be easy to make a zone for every landmark the registry knows about. That
 * would be a mistake: a click region on a snowbank or a rock pile is not a
 * discovery, it is a dead pixel that eats the hover state and hands the player a hint
 * about scenery. Four landmarks and two sky regions are the ones with something to
 * say, and the table below is the argument for which four.
 *
 * ## Hints
 *
 * A hint is the cheapest narrative in the engine and the most expensive to get wrong.
 * It is the only text a player sees without having done anything, so it has to be true
 * of the thing it is attached to and must not promise what clicking will do. Each one
 * below is written to describe the building rather than the discovery.
 */
import type { InteractionSurfaces, ScreenRect } from '../renderer/WorldRenderer.js';
import { EN_STRINGS, type Translate } from '../platform/I18n.js';

/** How long the cursor must rest on a zone before `onDwell` fires. */
export const DEFAULT_DWELL_MS = 30_000;

/**
 * Shorter dwell for the moon, which is a small target in the corner of the sky.
 *
 * Thirty seconds of holding a cursor still on a small bright disc is a different act
 * from thirty seconds of resting it on a treeline. The one is noticing; the other is
 * waiting.
 */
export const MOON_DWELL_MS = 10_000;

/** Short enough to exercise in a test without a thirty-second wait. */
export const TEST_DWELL_MS = 250;

export interface ZoneDescriptor {
  /** Stable id. Also the `zoneId` on a triple-click and the key in the zone map. */
  id: string;
  /** Human name, used in logs and tests. */
  name: string;
  rect: ScreenRect;
  cursor: string;
  hint: string;
  /** 0 means the zone never dwells. */
  dwellMs: number;
  /**
   * The easter-egg trigger this zone can fire, if any.
   *
   * Kept as the trigger string rather than the egg id because the trigger is what
   * `EasterEggSystem` matches on, and matching on a different key would be one more
   * place for the two to disagree.
   */
  trigger: string | null;
}

/**
 * `kind` is matched against a landmark's kind; `id` is used for zones the renderer
 * does not model as structures.
 *
 * `as const` is not decoration: it narrows `hintKey` to the literal union, so a
 * misspelled key here is a compile error instead of an English hint that never
 * translates.
 */
const ZONES = [
  {
    id: 'observatory',
    match: 'observatory' as const,
    cursor: 'pointer',
    // The English text, as the identity default. `describeZones` takes a translator and
    // calls this through it, so the string here is what a caller with no locale gets
    // and what `tools/i18n-audit.mjs` matches on. Keeping it means the audit can prove
    // the key and the literal have not drifted apart.
    hintKey: 'hint.observatory',
    hint: 'The dome is shut. The shutter has not moved in a long time.',
    dwellMs: 0,
    trigger: 'triple-click:observatory',
  },
  {
    id: 'radio-tower',
    match: 'radio-tower' as const,
    cursor: 'default',
    hintKey: 'hint.radioTower',
    hint: 'The carrier is still going. Nobody answers it.',
    dwellMs: 0,
    trigger: null,
  },
  {
    id: 'cabin',
    match: 'cabin' as const,
    cursor: 'default',
    hintKey: 'hint.cabin',
    hint: 'Smoke, most nights. No one has come out of it.',
    dwellMs: 0,
    trigger: null,
  },
  {
    id: 'lighthouse',
    match: 'lighthouse' as const,
    cursor: 'default',
    hintKey: 'hint.lighthouse',
    hint: 'The light keeps the interval it was given.',
    dwellMs: 0,
    trigger: null,
  },
] as const;

/** Sky and ground regions, which are not landmarks and so are matched by id. */
const EXTRA_ZONES = [
  {
    id: 'moon',
    cursor: 'default',
    hintKey: 'hint.moon',
    hint: 'It is the right shape and the wrong distance.',
    // A dwell, because the egg is `hover:moon@midnight` -- resting the cursor on the
    // moon is the only gesture the sky offers. This was 0, and that made the egg
    // unreachable in a way every table check passed: `EasterEggSystem` knew the
    // trigger, `EGG_EFFECTS` had a beat for it, and `InteractionSystem` returns from
    // `_tickDwell` before reaching a callback on a zone whose dwell is 0. Nothing ever
    // fired `hover:moon@midnight` in any build.
    //
    // Shorter than the treeline's. The moon is a small target that a moving cursor
    // leaves by accident, so the threshold is a third shorter; the egg is meant to feel
    // like noticing something rather than earning it.
    dwellMs: MOON_DWELL_MS,
    trigger: 'hover:moon@midnight',
  },
  {
    id: 'forest',
    cursor: 'default',
    // The dwell hint. Only shown while the cursor is actually resting there, so it
    // reads as the forest noticing rather than as an instruction.
    hintKey: 'hint.forest',
    hint: 'The treeline is not moving.',
    dwellMs: DEFAULT_DWELL_MS,
    trigger: 'idle:forest:30s',
  },
] as const;

/**
 * Build the zone descriptors for a scene.
 *
 * Returns an empty list for a scene with nothing to point at -- the interior world --
 * rather than throwing, because a zone table is an enhancement and a wallpaper with
 * no clickable regions is a normal state, not a failure.
 *
 * `t` translates the hints, which are the one piece of text a player sees before doing
 * anything at all, so they are the strings that have to survive a locale switch. It
 * defaults to the identity rather than requiring an argument so this stays a pure
 * geometry function that a test can call with no locale machinery in scope.
 */
export function describeZones(
  surfaces: InteractionSurfaces,
  t: Translate = (key) => EN_STRINGS[key]
): ZoneDescriptor[] {
  const out: ZoneDescriptor[] = [];

  for (const zone of ZONES) {
    const match = surfaces.landmarks.find((l) => l.kind === zone.match);
    if (!match) continue;
    out.push({
      id: zone.id,
      name: zone.match,
      rect: { x: match.x, y: match.y, width: match.width, height: match.height },
      cursor: zone.cursor,
      hint: t(zone.hintKey),
      dwellMs: zone.dwellMs,
      trigger: zone.trigger,
    });
  }

  if (surfaces.moon) {
    out.push({
      id: 'moon',
      name: 'moon',
      rect: surfaces.moon,
      cursor: EXTRA_ZONES[0].cursor,
      hint: t(EXTRA_ZONES[0].hintKey),
      dwellMs: EXTRA_ZONES[0].dwellMs,
      trigger: EXTRA_ZONES[0].trigger,
    });
  }

  // A zero-height forest band would be an unhittable zone that still swallows the
  // hover state at exactly one row of pixels.
  if (surfaces.forest.height > 0.01) {
    out.push({
      id: 'forest',
      name: 'forest',
      rect: surfaces.forest,
      cursor: EXTRA_ZONES[1].cursor,
      hint: t(EXTRA_ZONES[1].hintKey),
      dwellMs: EXTRA_ZONES[1].dwellMs,
      trigger: EXTRA_ZONES[1].trigger,
    });
  }

  return out;
}

/**
 * Whether two zones overlap.
 *
 * `_checkHover` and `_checkClick` both take the first match in insertion order, so an
 * overlap is not an error but it *is* invisible: whichever zone happens to be
 * registered first silently wins. The forest band spans the full width and therefore
 * overlaps every landmark sitting in the midground, so this is a real condition rather
 * than a hypothetical one, and it is checked rather than assumed away.
 */
export function overlappingZones(zones: ZoneDescriptor[]): string[][] {
  const hits: string[][] = [];
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      if (intersects(zones[i].rect, zones[j].rect)) hits.push([zones[i].id, zones[j].id]);
    }
  }
  return hits;
}

function intersects(a: ScreenRect, b: ScreenRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
