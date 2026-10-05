/**
 * World-aware anomaly naming.
 *
 * An anomaly is only frightening if it belongs to the place you are looking at.
 * The same visual should read as a different story depending on whether you are
 * standing in a pine forest, a salt flat, a fell or a coastline — that is what
 * makes the world feel like it has a history rather than a random effect layer.
 *
 * This module supplies, for each (anomaly, world) pair, a name the player can
 * read in the journal, a one-line note, and a plausible deniability. The
 * deniability matters most: the whole ARG rests on the user being able to talk
 * themselves out of what they saw.
 */

import type { WorldDefinition } from '../worlds/types.js';

export interface AnomalyFlavor {
  /** Name shown in the journal for this anomaly in this world. */
  name: string;
  /** One-line observation. */
  note: string;
  /** A believable mundane explanation, so the sighting can be dismissed. */
  deniability: string;
}

/** Fallback used when a world has no specific flavour for an anomaly. */
function generic(anomalyId: string): AnomalyFlavor {
  const base: Record<string, AnomalyFlavor> = {
    'second-moon': {
      name: 'Second Moon',
      note: 'A second moon, low on the horizon, gone in seconds.',
      deniability: 'A reflection off high cloud, or an aircraft light.',
    },
    'red-moon': {
      name: 'Red Moon',
      note: 'The moon runs red for several minutes.',
      deniability: 'A dust storm on the horizon, or an eclipse.',
    },
    'meteor': {
      name: 'Meteor',
      note: 'Something crosses the sky quickly and is gone.',
      deniability: 'A satellite, a flare, or a firework.',
    },
    'forest-watcher': {
      name: 'Watcher in the Pines',
      note: 'Something moves between the trees.',
      deniability: 'An animal. Wind in the branches.',
    },
    'observatory-signal': {
      name: 'Observatory Signal',
      note: 'The observatory sends a signal into the void.',
      deniability: 'A maintenance broadcast, or a stuck transmitter.',
    },
    'lights-out': {
      name: 'Lights Out',
      note: 'Every light goes off at once, then comes back.',
      deniability: 'A grid flicker. A blown fuse.',
    },
  };
  return base[anomalyId] ?? {
    name: anomalyId,
    note: 'Something is not right.',
    deniability: 'Probably nothing.',
  };
}

/**
 * Per-world flavour, keyed by world id. Each entry supplies the flavour for the
 * anomalies most relevant to that place, so the journal reads like a record of
 * *this* location rather than a global effect log.
 *
 * Exported so its keys can be checked. A world id that does not exist, or an
 * anomaly id that does not, produces no error and no visible symptom: the lookup
 * misses and the generic flavour is used instead, which reads as though the entry
 * were never written. Both are one typo away and neither is worth discovering by
 * noticing that a place sounds generic.
 */
export const WORLD_FLAVOR: Record<string, Record<string, AnomalyFlavor>> = {
  'the-town-that-wasnt-there': {
    'forest-watcher': {
      name: 'Something in the Fence Line',
      note: 'A shape crosses the treeline, well back from the cabins.',
      deniability: 'A deer, picking its way along the old fence line.',
    },
    'observatory-signal': {
      name: 'Observatory Signal',
      note: 'The observatory dish turns on its own and holds, aimed at nothing.',
      deniability: 'A motor fault, or someone leaving the drive engaged.',
    },
    'lights-out': {
      name: 'The Town Holds Its Breath',
      note: 'Every window in town goes dark at once. The radio tower keeps its light.',
      deniability: 'A generator cutover. A power cut.',
    },
  },
  saltwick: {
    'lights-out': {
      name: 'The Lighthouse Goes Dark',
      note: 'The light cuts out and the flats go black, then it returns.',
      deniability: 'A timed bulb change, or a bird against the lens.',
    },
  },
  'the-long-fell': {
    'observatory-signal': {
      name: 'The Fell Observatory Answers',
      note: 'Something answers the dish on the fell, at three in the morning.',
      deniability: 'Echo. A relay on the next peak, waking on the same schedule.',
    },
  },
  'the-long-head': {
    'lights-out': {
      name: 'The Head Goes Dark',
      note: 'The coast road lights die together, then return one by one.',
      deniability: 'A scheduled grid cut along the coast road.',
    },
  },
  'the-dry-mere': {
    'lights-out': {
      name: 'The Dishes Fall Silent',
      note: 'The listening dishes go still, all of them, facing the same way.',
      deniability: 'A power cycle on the array.',
    },
  },
};

/**
 * Returns the flavour for an anomaly as experienced in a given world, falling
 * back to the generic description when the world has nothing specific.
 */
export function flavorFor(world: WorldDefinition, anomalyId: string): AnomalyFlavor {
  const worldEntry = WORLD_FLAVOR[world.id]?.[anomalyId];
  if (worldEntry) return worldEntry;
  return generic(anomalyId);
}
