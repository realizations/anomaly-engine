/**
 * The anomalies that ship with the engine.
 *
 * These were six literal `register()` calls inside the composition root, which
 * meant the shipped set of anomaly ids was only observable from a running browser.
 * Anything that needed to agree with those ids — the per-world flavour table in
 * `worldFlavor.ts`, the showcase's coverage check, the journal's naming — had no way
 * to assert it and was left to be correct by inspection.
 *
 * Keeping them as data rather than behaviour is what the rest of the project
 * already does with worlds, for the same reason: an id is a contract, and a
 * contract nobody can read is a contract nobody can keep.
 */
import type { AnomalyDefinition } from './AnomalyRegistry.js';

export const BUILT_IN_ANOMALIES: AnomalyDefinition[] = [
  {
    id: 'second-moon',
    name: 'Second Moon',
    description: 'A second moon appears in the sky for 8 seconds.',
    category: 'cosmic',
    rarity: 'very_rare',
    cooldown: 86400,
    duration: 8,
    effects: [{ type: 'spawn', target: 'moon', params: { count: 2 } }],
  },

  // Scoped to biomes with something to hide in. This has no business firing
  // on a salt flat or a desert, which is exactly the incoherence the user
  // spotted: "something moves between the trees" over a landscape with no
  // trees reads as a bug, not as a mystery.
  {
    id: 'forest-watcher',
    name: 'Watcher in the Pines',
    description: 'Something moves between the trees.',
    category: 'behavioral',
    rarity: 'very_rare',
    cooldown: 43200,
    duration: 12,
    biomes: ['temperate-forest'],
    effects: [{ type: 'spawn', target: 'creature', params: { type: 'shadow' } }],
  },

  // Requires an observatory, so it only fires in the two worlds that have one.
  {
    id: 'observatory-signal',
    name: 'Observatory Signal',
    description: 'The observatory sends a signal into the void.',
    category: 'cosmic',
    rarity: 'rare',
    cooldown: 14400,
    duration: 30,
    requiresStructure: 'observatory',
    effects: [{ type: 'light', target: 'observatory', params: { color: 'red' } }],
  },

  {
    id: 'red-moon',
    name: 'Red Moon',
    description: 'The moon turns red.',
    category: 'cosmic',
    rarity: 'legendary',
    cooldown: 604800,
    duration: 300,
    effects: [{ type: 'transform', target: 'moon', params: { color: 'red' } }],
  },

  // Registered so the journal and field notes can name it. The visual is a
  // direct renderer call rather than an effect entry, because a shooting star
  // is a one-off particle, not a persistent transform.
  {
    id: 'meteor',
    name: 'Meteor',
    description: 'Something crosses the sky quickly.',
    category: 'visual',
    rarity: 'common',
    cooldown: 3600,
    duration: 4,
    effects: [{ type: 'spawn', target: 'meteor', params: { count: 1 } }],
  },

  // Needs somewhere to be lit. The three worlds without a lit structure
  // cannot host "every light in the valley" because there is no valley and
  // no light, so this is scoped away from them.
  {
    id: 'lights-out',
    name: 'Lights Out',
    description: 'Every light in the valley goes off at once, then comes back.',
    category: 'behavioral',
    rarity: 'rare',
    cooldown: 43200,
    duration: 10,
    biomes: ['temperate-forest', 'salt-marsh', 'coast'],
    effects: [{ type: 'light', target: 'settlement', params: { state: 'off' } }],
  },
];