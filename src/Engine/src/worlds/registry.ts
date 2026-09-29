import type { WorldDefinition } from './types.js';

/**
 * Built-in worlds.
 *
 * Each is pure data. The renderer generates every pixel, so a new world is a
 * ~40 line file rather than an art pipeline. Terrain seeds are distinct, so no
 * two worlds share landforms even where the palette looks similar.
 */

const TOWN: WorldDefinition = {
  id: 'the-town-that-wasnt-there',
  name: "The Town That Wasn't There",
  author: 'Anomaly Engine contributors',
  version: '0.1.0',
  engine: '0.1',
  description:
    'A valley town that has been present on every map for a century and appears on none of them. A road leads in. The radio tower still transmits.',
  biome: 'temperate-forest',
  terrain: {
    seed: 1337,
    ridgeBaseY: [0.665, 0.688, 0.712],
    ridgeAmp: [0.215, 0.15, 0.085],
    ridgeFreq: [0.0019, 0.0033, 0.0056],
    ridgePresence: [1, 1, 1],
    forestDensity: [1, 1, 1],
    groundY: 0.7,
    groundBanding: 1,
    road: 1,
  },
  sky: { cloudiness: 0.22, starDensity: 1, moonlight: 1 },
  palette: {
    haze: { r: 22, g: 26, b: 54 },
    ridges: [
      { r: 74, g: 88, b: 112 },
      { r: 62, g: 76, b: 96 },
      { r: 40, g: 52, b: 64 },
    ],
    forest: [
      { r: 34, g: 46, b: 52 },
      { r: 20, g: 30, b: 34 },
      { r: 9, g: 15, b: 17 },
    ],
    ground: { r: 30, g: 40, b: 32 },
    road: { r: 122, g: 106, b: 86 },
    saturation: 1,
    exposure: 1,
  },
  structures: [
    { kind: 'cabin', x: 0.17, scale: 1, lit: true, lightColor: { r: 255, g: 196, b: 112 } },
    { kind: 'radio-tower', x: 0.77, scale: 1, lit: true, lightColor: { r: 255, g: 90, b: 80 } },
    { kind: 'observatory', x: 0.53, scale: 1, lit: true, lightColor: { r: 255, g: 214, b: 150 } },
    { kind: 'pylon-run', x: 0.0, scale: 1 },
    { kind: 'fence-line', x: 0.3, scale: 1 },
  ],
  features: { weather: true, astronomy: true, systemEvents: true, audioReactive: false },
  lore: {
    premise:
      'The lights in the valley follow a schedule. So does the tower. Neither schedule is published.',
    epitaph: 'waking the town',
    deniability: [
      'A red moon is a red moon. It happens.',
      'The tower is a relay. Relays blink.',
      'You were half asleep. You saw movement.',
    ],
  },
};

const SALT: WorldDefinition = {
  id: 'saltwick',
  name: 'Saltwick',
  author: 'Anomaly Engine contributors',
  version: '0.1.0',
  engine: '0.1',
  description:
    'Tidal flats where the water withdraws further than the charts allow, and a light that keeps time for ships that stopped running.',
  biome: 'salt-marsh',
  terrain: {
    seed: 2211,
    // Almost no ridgeline: the horizon is the subject, not the mountains.
    ridgeBaseY: [0.7, 0.715, 0.728],
    ridgeAmp: [0.05, 0.035, 0.02],
    ridgeFreq: [0.0011, 0.002, 0.0034],
    ridgePresence: [0.35, 0.25, 0.15],
    forestDensity: [0.06, 0.04, 0.02],
    groundY: 0.66,
    groundBanding: 1,
    road: 0,
  },
  sky: { cloudiness: 0.42, starDensity: 1.15, moonlight: 1.2, horizonTint: { r: 96, g: 120, b: 140 } },
  palette: {
    haze: { r: 54, g: 66, b: 78 },
    ridges: [
      { r: 96, g: 104, b: 110 },
      { r: 78, g: 88, b: 96 },
      { r: 60, g: 70, b: 78 },
    ],
    forest: [
      { r: 58, g: 62, b: 58 },
      { r: 42, g: 46, b: 44 },
      { r: 26, g: 30, b: 30 },
    ],
    ground: { r: 78, g: 82, b: 80 },
    road: { r: 140, g: 138, b: 126 },
    saturation: 0.62,
    exposure: 1.08,
  },
  structures: [
    { kind: 'lighthouse', x: 0.82, scale: 1.15, lit: true, lightColor: { r: 255, g: 240, b: 200 } },
    { kind: 'reed-bank', x: 0.12, scale: 1 },
    { kind: 'reed-bank', x: 0.62, scale: 0.8 },
    { kind: 'well', x: 0.36, scale: 0.9 },
    { kind: 'fence-line', x: 0.5, scale: 0.7 },
  ],
  features: { weather: true, astronomy: true, systemEvents: true, audioReactive: false },
  lore: {
    premise: 'The tide table is accurate. Everything else out there is not.',
    epitaph: 'counting the flats',
    deniability: [
      'A lighthouse is automated. Of course it blinks.',
      'Salt flats look like figures. That is what salt does.',
      'The tide is out. You simply misjudged how far out.',
    ],
  },
};

const FELL: WorldDefinition = {
  id: 'the-long-fell',
  name: 'The Long Fell',
  author: 'Anomaly Engine contributors',
  version: '0.1.0',
  engine: '0.1',
  description:
    'Above the weather line, where the ground is bare and the wind does the talking. A survey station that has not reported since before you were born.',
  biome: 'alpine',
  terrain: {
    seed: 5507,
    // Tall, jagged, aggressive ridgeline. The most mountainous of the worlds.
    ridgeBaseY: [0.6, 0.645, 0.7],
    ridgeAmp: [0.34, 0.26, 0.15],
    ridgeFreq: [0.0027, 0.0041, 0.0062],
    ridgePresence: [1, 0.95, 0.8],
    forestDensity: [0.35, 0.16, 0.05],
    groundY: 0.76,
    groundBanding: 1,
    road: 0,
    snowLine: 1,
  },
  sky: { cloudiness: 0.55, starDensity: 0.85, moonlight: 1.15, horizonTint: { r: 150, g: 168, b: 190 } },
  palette: {
    haze: { r: 70, g: 84, b: 102 },
    ridges: [
      { r: 138, g: 150, b: 168 },
      { r: 108, g: 120, b: 138 },
      { r: 78, g: 90, b: 104 },
    ],
    forest: [
      { r: 44, g: 54, b: 52 },
      { r: 30, g: 38, b: 40 },
      { r: 18, g: 24, b: 28 },
    ],
    ground: { r: 168, g: 174, b: 180 },
    road: { r: 148, g: 150, b: 152 },
    saturation: 0.5,
    exposure: 1.04,
  },
  structures: [
    { kind: 'observatory', x: 0.62, scale: 0.85, lit: true, lightColor: { r: 180, g: 226, b: 255 } },
    { kind: 'cairn', x: 0.26, scale: 1.2 },
    { kind: 'cairn', x: 0.47, scale: 0.9 },
    { kind: 'cairn', x: 0.68, scale: 1 },
    { kind: 'rock-field', x: 0.86, scale: 1.1 },
    { kind: 'snowbank', x: 0.36, scale: 1.2 },
  ],
  features: { weather: true, astronomy: true, systemEvents: true, audioReactive: false },
  lore: {
    premise: 'The station logs the weather. The weather does not log back.',
    epitaph: 'above the weather line',
    deniability: [
      'A dish is a dish. It points somewhere.',
      'Snow makes shapes. You were tired.',
      'The station has been dark since the eighties. That is the whole record.',
    ],
  },
};

const MERE: WorldDefinition = {
  id: 'the-dry-mere',
  name: 'The Dry Mere',
  author: 'Anomaly Engine contributors',
  version: '0.1.0',
  engine: '0.1',
  description:
    'A basin that was a lake until it was not. The waterline is still visible, and still very slightly too high.',
  biome: 'high-desert',
  terrain: {
    seed: 8803,
    // Flat-topped mesas rather than peaks.
    ridgeBaseY: [0.655, 0.685, 0.715],
    ridgeAmp: [0.16, 0.1, 0.06],
    ridgeFreq: [0.0009, 0.0014, 0.0022],
    ridgePresence: [0.8, 0.5, 0.3],
    forestDensity: [0.05, 0.02, 0.01],
    groundY: 0.68,
    groundBanding: 1,
    road: 0,
  },
  sky: { cloudiness: 0.14, starDensity: 1.3, moonlight: 0.9, horizonTint: { r: 190, g: 140, b: 96 } },
  palette: {
    haze: { r: 96, g: 76, b: 62 },
    ridges: [
      { r: 150, g: 122, b: 96 },
      { r: 124, g: 98, b: 78 },
      { r: 96, g: 74, b: 60 },
    ],
    forest: [
      { r: 86, g: 74, b: 58 },
      { r: 62, g: 52, b: 42 },
      { r: 40, g: 34, b: 28 },
    ],
    ground: { r: 148, g: 122, b: 92 },
    road: { r: 172, g: 148, b: 114 },
    saturation: 0.9,
    exposure: 1.0,
  },
  structures: [
    { kind: 'ruin', x: 0.24, scale: 1.05 },
    { kind: 'well', x: 0.58, scale: 1.1 },
    { kind: 'dishes', x: 0.79, scale: 1 },
    { kind: 'butte', x: 0.08, scale: 1.5 },
    { kind: 'butte', x: 0.9, scale: 0.9 },
    { kind: 'rock-field', x: 0.42, scale: 0.9 },
  ],
  features: { weather: true, astronomy: true, systemEvents: true, audioReactive: false },
  lore: {
    premise: 'Nothing has been recorded here since the water left. The instruments still run.',
    epitaph: 'reading the waterline',
    deniability: [
      'Dry lake beds are the flattest places on earth. Perspective lies.',
      'A dish array is infrastructure. It has a maintenance schedule.',
      'Ruins do not rearrange. You walked a different line.',
    ],
  },
};

const HEAD: WorldDefinition = {
  id: 'the-long-head',
  name: 'The Long Head',
  author: 'Anomaly Engine contributors',
  version: '0.1.0',
  engine: '0.1',
  description:
    'A cape on the headland where the sea keeps arriving earlier than the charts allow. Someone keeps the light working. The light is not automated.',
  biome: 'coast',
  terrain: {
    seed: 6407,
    // A low headland on one side, open water on the other.
    ridgeBaseY: [0.63, 0.655, 0.68],
    ridgeAmp: [0.1, 0.06, 0.035],
    ridgeFreq: [0.0015, 0.0024, 0.0038],
    ridgePresence: [0.55, 0.3, 0.12],
    forestDensity: [0.12, 0.05, 0.02],
    groundY: 0.68,
    groundBanding: 1,
    road: 0,
  },
  sky: { cloudiness: 0.5, starDensity: 0.95, moonlight: 1.1, horizonTint: { r: 120, g: 150, b: 170 } },
  palette: {
    haze: { r: 66, g: 84, b: 96 },
    ridges: [
      { r: 104, g: 112, b: 118 },
      { r: 84, g: 94, b: 102 },
      { r: 64, g: 74, b: 84 },
    ],
    forest: [
      { r: 54, g: 60, b: 52 },
      { r: 38, g: 44, b: 40 },
      { r: 24, g: 28, b: 28 },
    ],
    ground: { r: 118, g: 112, b: 100 },
    road: { r: 150, g: 146, b: 134 },
    saturation: 0.66,
    exposure: 1.05,
  },
  structures: [
    { kind: 'lighthouse', x: 0.16, scale: 1.2, lit: true, lightColor: { r: 255, g: 246, b: 214 } },
    { kind: 'ruin', x: 0.63, scale: 1 },
    { kind: 'well', x: 0.45, scale: 0.85 },
    { kind: 'rock-field', x: 0.86, scale: 1.2 },
    { kind: 'fence-line', x: 0.55, scale: 0.9 },
  ],
  features: { weather: true, astronomy: true, systemEvents: true, audioReactive: false },
  lore: {
    premise: 'The light was automated. It is automated. It is also, on some nights, lit.',
    epitaph: 'counting the intervals',
    deniability: [
      'Lighthouses flash in a fixed pattern. That is the whole point of them.',
      'A headland erodes. The ruins were always further inland than the map says.',
      'You saw a figure on the rocks. People walk on rocks.',
    ],
  },
};

/**
 * A liminal interior. The only world with no landscape at all, and the one that
 * carries the project's strangest idea: that the unsettling place is an
 * ordinary one, emptied of people and lit by the wrong fluorescent tube.
 */
const LIMINAL: WorldDefinition = {
  id: 'the-long-corridor',
  name: 'The Long Corridor',
  author: 'Anomaly Engine contributors',
  version: '0.1.0',
  engine: '0.1',
  description:
    'An interior that is not outside. The lights are on a timer. There is no window, and the corridor does not appear on any floor plan.',
  biome: 'liminal-interior',
  terrain: {
    seed: 2718,
    // Terrain is unused by the interior scene, but the seed still drives the
    // space's identity: which single detail is wrong, and which door is ajar.
    groundY: 0.5,
    groundBanding: 0,
    road: 0,
  },
  sky: { cloudiness: 0, starDensity: 0, moonlight: 0 },
  liminal: {
    // Off centre on purpose. A dead-centred vanishing point reads as a
    // diagram; slightly off reads as a place someone built.
    vanishingX: 0.44,
    bays: 10,
    // Institutional tile. Sizes that are slightly too large read as wrong in a
    // way the eye notices but cannot name.
    tile: 58,
    ceiling: 1,
    lightLevel: 0.82,
    // Not white. Slightly green, which is the colour of lighting that is
    // present but not quite right.
    lightTint: { r: 206, g: 218, b: 196 },
    // Very high uniformity. The repetition is the point.
    uniformity: 0.9,
    doors: 1,
  },
  palette: {
    // Desaturated and slightly warm, the colour of old carpet and vinyl.
    haze: { r: 26, g: 28, b: 32 },
    ground: { r: 150, g: 146, b: 134 },
    road: { r: 150, g: 146, b: 134 },
    saturation: 0.5,
    exposure: 1,
  },
  features: { weather: false, astronomy: false, systemEvents: true, audioReactive: false },
  lore: {
    premise: 'It is a public building. It has been open continuously. Nothing about that is strange on its own.',
    epitaph: 'the far end is further than it was',
    deniability: [
      'Offices are like this. Nobody is ever quite sure how many floors there are.',
      'The lights are on a timer. You have seen the timer.',
      'The door was ajar because of the draught.',
    ],
  },
};

export const BUILT_IN_WORLDS: WorldDefinition[] = [TOWN, SALT, FELL, MERE, HEAD, LIMINAL];

export function findBuiltInWorld(id: string): WorldDefinition | null {
  return BUILT_IN_WORLDS.find((w) => w.id === id) ?? null;
}
