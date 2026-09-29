/**
 * World format v0.1
 *
 * A world is *data that parameterises the procedural renderer*, not a scene file.
 * Nothing in a world is drawn by hand: every world selects a biome, a palette, a
 * terrain seed profile and a set of structures, and the renderer generates the
 * result. This keeps the "no third-party art" guarantee intact while letting
 * worlds differ as dramatically as a coastline and a mountain range.
 *
 * Worlds are shipped as bundled data rather than fetched JSON because the native
 * host loads the renderer from file://, where Chromium blocks fetch() and ES
 * module imports of external files. User-installed worlds can still be supplied
 * by the host as JSON via the native bridge.
 */

export type BiomeId =
  | 'temperate-forest'
  | 'alpine'
  | 'coast'
  | 'high-desert'
  | 'salt-marsh'
  | 'liminal-interior';

export type StructureKind =
  | 'cabin'
  | 'radio-tower'
  | 'observatory'
  | 'lighthouse'
  | 'ruin'
  | 'well'
  | 'dishes'
  | 'cairn'
  | 'pylon-run'
  | 'fence-line'
  | 'rock-field'
  | 'reed-bank'
  | 'snowbank'
  | 'butte';

export interface RGB8 {
  r: number;
  g: number;
  b: number;
}

/**
 * Palette overrides. Every field is optional: anything omitted falls back to the
 * engine's time-of-day derived defaults, so a world only states what it changes.
 */
export interface WorldPalette {
  /** Tint mixed into distant terrain to create atmospheric perspective. */
  haze?: RGB8;
  /** Ridge layer colours, far to near. */
  ridges?: [RGB8, RGB8, RGB8];
  /** Forest layer colours, far to near. */
  forest?: [RGB8, RGB8, RGB8];
  /** Base ground colour. */
  ground?: RGB8;
  /** Road and bare-earth colour. */
  road?: RGB8;
  /** Overall saturation multiplier, 0 = greyscale, 1 = unchanged. */
  saturation?: number;
  /** Overall value multiplier applied after grading. */
  exposure?: number;
  /** Riso ink used for warm pixels. Falls back to the engine default. */
  risoWarm?: RGB8;
  /** Riso ink used for cool pixels. Falls back to the engine default. */
  risoCool?: RGB8;
  /** Riso paper stock. Falls back to the engine default. */
  risoPaper?: RGB8;
}

export interface TerrainProfile {
  /** Master seed. Two worlds sharing a seed share their landforms exactly. */
  seed: number;
  /** Ridge crest heights as a fraction of viewport height. */
  ridgeBaseY?: [number, number, number];
  /** Ridge amplitude as a fraction of viewport height. */
  ridgeAmp?: [number, number, number];
  /** Horizontal frequency per ridge layer. Higher means more jagged. */
  ridgeFreq?: [number, number, number];
  /** 0 = no ridgeline, 1 = full mountain range. */
  ridgePresence?: [number, number, number];
  /** Conifer density multiplier per forest layer. */
  forestDensity?: [number, number, number];
  /** Ground horizon line as a fraction of viewport height. */
  groundY?: number;
  /** Flat ground gets value-separated bands; 0 disables and uses a flat fill. */
  groundBanding?: number;
  /** Road presence, 0..1. A paved road makes no sense on a salt flat or a fell. */
  road?: number;
  /** Whether precipitation falls as snow rather than rain. */
  snowLine?: number;
}

export interface SkyProfile {
  /** Extra tint pushed into the horizon band at golden hour. */
  horizonTint?: RGB8;
  /** Cloud coverage multiplier. 0 = clear, 1 = overcast. */
  cloudiness?: number;
  /** 0 = no stars, 1 = full starfield. */
  starDensity?: number;
  /** How strongly the moon lights the scene, 0..1. */
  moonlight?: number;
}

/**
 * Liminal interior profile.
 *
 * A liminal space is not frightening because it is dark; it is unsettling
 * because it is *almost* ordinary. The geometry has to be mundane and almost
 * right, because the unease comes entirely from the gap between what you expect
 * and what you get. Every field here controls one specific way the space can be
 * subtly wrong.
 */
export interface LiminalProfile {
  /** Where the corridor's vanishing point sits, 0..1 across the viewport.
   *  Off-centre is unsettling; dead centre reads as a diagram. */
  vanishingX?: number;
  /** Corridor depth as a count of bays. More bays means more repetition,
   *  which is what turns a hallway into something you cannot stop noticing. */
  bays?: number;
  /** Floor tile size in pixels. Institutional sizes feel wrong. */
  tile?: number;
  /** 0 = no ceiling, 1 = fully enclosed. Liminal spaces are usually closed. */
  ceiling?: number;
  /** Fluorescent tube brightness, 0..1. */
  lightLevel?: number;
  /** Hue of the institutional light. Slightly green or slightly warm reads as
   *  "lighting that is not quite right" far more than neutral white. */
  lightTint?: RGB8;
  /** How strongly the walls repeat. 0 = varied, 1 = identical panels. */
  uniformity?: number;
  /** Doors or openings down one side, 0 = none. */
  doors?: number;
}

export interface WorldStructure {
  kind: StructureKind;
  /** Horizontal position, 0..1 across the viewport. */
  x: number;
  /** Optional vertical offset, 0..1. Defaults to sitting on the ground line. */
  y?: number;
  /** Uniform scale multiplier. */
  scale?: number;
  /** Whether the structure emits light at night. */
  lit?: boolean;
  /** Light colour when lit. */
  lightColor?: RGB8;
  /** Whether it is visible during the day. Most are silhouettes either way. */
  dayVisible?: boolean;
}

export interface WorldLore {
  /** Shown in the tray About box and the settings window. */
  premise?: string;
  /** One-line epitaph rendered on the boot screen. */
  epitaph?: string;
  /** Plausible deniability. Each anomaly should have one. */
  deniability?: string[];
}

export interface WorldDefinition {
  id: string;
  name: string;
  author: string;
  version: string;
  /** Minimum engine major version. */
  engine: string;
  description: string;
  biome: BiomeId;
  terrain: TerrainProfile;
  sky?: SkyProfile;
  /** Interior geometry. Only meaningful for the liminal-interior biome. */
  liminal?: LiminalProfile;
  palette?: WorldPalette;
  structures?: WorldStructure[];
  features?: {
    weather?: boolean;
    astronomy?: boolean;
    systemEvents?: boolean;
    audioReactive?: boolean;
  };
  lore?: WorldLore;
  /** Optional path to a standalone world.json when distributed outside the bundle. */
  externalPath?: string;
}

export interface WorldValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const BIOMES: BiomeId[] = [
  'temperate-forest', 'alpine', 'coast', 'high-desert', 'salt-marsh', 'liminal-interior',
];
const STRUCTURES: StructureKind[] = [
  'cabin', 'radio-tower', 'observatory', 'lighthouse', 'ruin', 'well',
  'dishes', 'cairn', 'pylon-run', 'fence-line', 'rock-field', 'reed-bank',
  'snowbank', 'butte',
];

/** Validates a world object. Returns every problem found, not just the first. */
export function validateWorld(input: unknown): WorldValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input || typeof input !== 'object') {
    return { valid: false, errors: ['world is not an object'], warnings };
  }
  const w = input as Partial<WorldDefinition>;

  for (const field of ['id', 'name', 'version', 'engine', 'description', 'biome'] as const) {
    if (typeof w[field] !== 'string' || !String(w[field]).trim()) {
      errors.push(`missing required string field "${field}"`);
    }
  }
  if (typeof w.id === 'string' && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(w.id)) {
    errors.push(`id "${w.id}" must be lowercase kebab-case with no leading or trailing hyphen`);
  }
  if (w.biome && !BIOMES.includes(w.biome)) {
    errors.push(`unknown biome "${w.biome}" (expected one of ${BIOMES.join(', ')})`);
  }
  if (!w.terrain || typeof w.terrain !== 'object') {
    errors.push('missing required object field "terrain"');
  } else {
    const t = w.terrain as Partial<TerrainProfile>;
    if (typeof t.seed !== 'number' || !Number.isFinite(t.seed)) {
      errors.push('terrain.seed must be a finite number');
    }
    for (const key of ['ridgeBaseY', 'ridgeAmp', 'ridgeFreq', 'ridgePresence', 'forestDensity'] as const) {
      const v = t[key];
      if (v !== undefined) {
        if (!Array.isArray(v) || v.length !== 3 || v.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
          errors.push(`terrain.${key} must be an array of 3 finite numbers`);
        }
      }
    }
    if (t.groundY !== undefined && (typeof t.groundY !== 'number' || t.groundY <= 0 || t.groundY >= 1)) {
      errors.push('terrain.groundY must be a number strictly between 0 and 1');
    }
  }
  if (w.palette?.saturation !== undefined) {
    const s = w.palette.saturation;
    if (typeof s !== 'number' || s < 0 || s > 2) errors.push('palette.saturation must be between 0 and 2');
  }
  for (const s of w.structures ?? []) {
    if (!STRUCTURES.includes(s.kind)) {
      errors.push(`unknown structure kind "${s.kind}"`);
    }
    if (typeof s.x !== 'number' || s.x < -0.2 || s.x > 1.2) {
      errors.push(`structure ${s.kind} has x outside -0.2..1.2`);
    }
  }
  if (!w.structures || w.structures.length === 0) {
    warnings.push('world defines no structures, so the scene will be empty of landmarks');
  }
  if (w.lore && !w.lore.deniability?.length) {
    warnings.push('lore has no deniability lines, so anomalies cannot be explained away');
  }
  if (w.biome === 'liminal-interior' && !w.liminal) {
    warnings.push('liminal-interior world has no liminal profile, so it will use the engine defaults');
  }
  if (w.biome !== 'liminal-interior' && w.liminal) {
    warnings.push('world defines a liminal profile but is not a liminal-interior, so it will be ignored');
  }
  if (w.liminal) {
    const l = w.liminal;
    if (l.bays !== undefined && (typeof l.bays !== 'number' || l.bays < 2 || l.bays > 40)) {
      errors.push('liminal.bays must be a number between 2 and 40');
    }
    if (l.tile !== undefined && (typeof l.tile !== 'number' || l.tile < 12 || l.tile > 160)) {
      errors.push('liminal.tile must be a number between 12 and 160');
    }
    for (const key of ['ceiling', 'lightLevel', 'uniformity'] as const) {
      const v = l[key];
      if (v !== undefined && (typeof v !== 'number' || v < 0 || v > 1)) {
        errors.push(`liminal.${key} must be between 0 and 1`);
      }
    }
    if (l.vanishingX !== undefined && (typeof l.vanishingX !== 'number' || l.vanishingX < 0.1 || l.vanishingX > 0.9)) {
      errors.push('liminal.vanishingX must be between 0.1 and 0.9');
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
