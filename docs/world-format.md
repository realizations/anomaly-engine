# World format v0.1

A world is **data that parameterises the procedural renderer**. It is not a
scene file, and it contains no art.

This is the single most important architectural decision in the project, so it is
worth stating the reasoning:

- The renderer generates every pixel from seeded noise. A world therefore has
  nothing to draw *with* — only parameters for how to draw.
- That keeps the "zero third-party art" guarantee intact. A world is a ~40 line
  JSON-ish object, so worlds can be contributed without touching binary assets or
  opening a licence question.
- It means a new world is cheap. Four shipped worlds are roughly 200 lines of data
  between them.

## Where worlds live

Built-in worlds are bundled TypeScript modules in `src/Engine/src/worlds/registry.ts`,
typed by `WorldDefinition` in `src/Engine/src/worlds/types.ts`. They are bundled
rather than `fetch`ed because the native host serves the renderer from `file://`,
where Chromium blocks both `fetch` of local files and cross-file ES module imports.

User-installed worlds can be supplied two ways:

1. **From the host** — the renderer listens for an `anomaly:worlds` CustomEvent
   carrying a JSON array, and registers each definition. This is the path a
   "worlds folder" installer would use, and it needs no web server.
2. **Over http** — `WorldLoader.loadFromUrl()` works when the renderer is served
   by a dev server, which is how world authors iterate.

## Anatomy

```jsonc
{
  "id": "saltwick",                  // required, lowercase kebab-case
  "name": "Saltwick",               // required
  "author": "...",                   // optional in practice
  "version": "0.1.0",               // required
  "engine": "0.1",                   // required, minimum engine major
  "description": "...",              // required
  "biome": "salt-marsh",             // required, see below

  "terrain": {                       // required
    "seed": 2211,                    // master seed; unique per world
    "ridgeBaseY":  [0.7, 0.715, 0.728],   // far -> near
    "ridgeAmp":   [0.05, 0.035, 0.02],
    "ridgeFreq":  [0.0011, 0.002, 0.0034],
    "ridgePresence": [0.35, 0.25, 0.15],  // 0 hides the layer entirely
    "forestDensity": [0.06, 0.04, 0.02],
    "groundY": 0.66,                 // horizon as fraction of viewport height
    "groundBanding": 1,              // 0 = flat fill, 1 = value-separated bands
    "road": 0                        // 0..1; no paved road on a salt flat
  },

  "sky": {                           // optional
    "horizonTint": { "r": 96, "g": 120, "b": 140 },
    "cloudiness": 0.42,              // 0 clear .. 1 overcast
    "starDensity": 1.15,             // multiplies the star count
    "moonlight": 1.2                 // 0..1
  },

  "palette": {                       // optional; every field falls back
    "haze":   { "r": 54, "g": 66, "b": 78 },
    "ridges": [ {...}, {...}, {...} ],
    "forest": [ {...}, {...}, {...} ],
    "ground": { "r": 78, "g": 82, "b": 80 },
    "road":   { "r": 140, "g": 138, "b": 126 },
    "saturation": 0.62,              // 0 greyscale .. 2 vivid
    "exposure": 1.08                 // final value multiplier
  },

  "structures": [                    // drawn in declaration order
    { "kind": "lighthouse", "x": 0.82, "scale": 1.15,
      "lit": true, "lightColor": { "r": 255, "g": 240, "b": 200 } }
  ],

  "features": {
    "weather": true, "astronomy": true,
    "systemEvents": true, "audioReactive": false
  },

  "lore": {                          // shown in the field-notes panel
    "premise": "The tide table is accurate. Everything else out there is not.",
    "epitaph": "counting the flats",
    "deniability": [                 // each anomaly needs a plausible excuse
      "A lighthouse is automated. Of course it blinks."
    ]
  }
}
```

## Biomes

`biome` selects the ground treatment, because grass on a snowfield or a paved
road on a salt flat is the fastest way to make a world look wrong.

| Biome | Ground treatment |
|---|---|
| `temperate-forest` | Grass, wind sway |
| `salt-marsh` | Tide pools reflecting the sky, polygonal salt crust, reed banks |
| `alpine` | Wind-carved snow drifts, blue-grey shadow pooling, exposed rock |
| `high-desert` | Polygonal desiccation cracks, sparse scrub |
| `coast` | Wet sand mirroring the sky, an irregular waterline, foam lines, shingle and marram grass |
| `liminal-interior` | None — see below |

Biome only changes the ground. Everything else is driven by the palette and
terrain numbers, which is why a new biome is a small change.

`liminal-interior` is the exception that proves the rule. It has no ground, no
sky and no structures, because it is not a landscape: `WorldRenderer` dispatches
that biome to `LiminalInterior`, a separate scene constructor that draws a room.
A world with that biome should carry a `liminal` profile and may omit `structures`
entirely — the field is optional, and the only built-in world that does so is
`the-long-corridor`.

### The liminal profile

Every field is optional and falls back to an engine default. The ranges are what
`validateWorld()` enforces.

| Field | Range | What it does |
|---|---|---|
| `vanishingX` | `0.1..0.9` | Where the corridor converges. Dead centre reads as a diagram; off-centre is unsettling. |
| `bays` | `2..40` | Corridor depth as a count of bays. More bays means more repetition. |
| `tile` | `12..160` | Floor tile size in pixels. Institutional sizes feel wrong. |
| `ceiling` | `0..1` | 0 = open above, 1 = fully enclosed. Liminal spaces are usually closed. |
| `lightLevel` | `0..1` | Fluorescent tube brightness. |
| `lightTint` | RGB | Hue of the light. Slightly green or slightly warm reads as lighting that is not quite right. |
| `uniformity` | `0..1` | How strongly the walls repeat. 0 = varied, 1 = identical panels. |
| `doors` | `0..1` | Openings down one side. |

## Structure kinds

`cabin`, `radio-tower`, `observatory`, `lighthouse`, `ruin`, `well`, `dishes`,
`cairn`, `pylon-run`, `fence-line`, `rock-field`, `reed-bank`, `snowbank`,
`butte`.

Each has a baked-in anchor and tone; a world only sets position, scale, and
whether it is lit. The dispatcher in `WorldRenderer._drawStructures` translates
the baked geometry onto the declared position rather than redrawing it, which
keeps silhouettes consistent across worlds.

**Choose structures that belong to the biome.** An early revision of
`the-long-fell` included a `butte`, which is a desert landform; it rendered as a
brown striped box on a snowfield. `cairn` replaced it.

## Validation

`validateWorld()` returns every problem, not just the first. It is enforced in
three places: the loader's constructor (a malformed built-in world is a
programming error and throws), `register()` for external worlds, and the unit
tests.

Rules that are **errors**, so the world is rejected:

- a missing required string, object or array field
- an `id` that is not lowercase kebab-case, or has a leading or trailing hyphen
- an unknown `biome`, or an unknown `structure.kind`
- a `terrain` value that is not a finite number, a terrain array that is not three
  finite numbers, or a `groundY` outside `(0, 1)`
- `palette.saturation` outside `0..2`
- a structure `x` outside `-0.2..1.2` — the overshoot is deliberate, so a structure
  can sit half off the edge of the frame
- for a `liminal-interior` world, a `liminal` profile outside its documented
  ranges: `bays` outside `2..40`, `tile` outside `12..160`, `vanishingX` outside
  `0.1..0.9`, or any other liminal field outside `0..1`

Rules that are **warnings**, so the world loads anyway:

- no structures — a world with no landmarks is a legitimate choice
- lore with no deniability — allowed, but it removes the reason an anomaly exists
- a `liminal-interior` world with no `liminal` profile, which falls back to engine
  defaults
- a `liminal` profile on a world that is not `liminal-interior`, which is ignored

One rule in the list below is a convention rather than a check: unique seeds cannot
be enforced by a validator that only sees one world at a time. It is asserted across
the built-in set by the unit tests instead.

## Design rules

1. **A world never contains art.** If you want to change how something looks,
   change a palette number or a structure kind. If neither can express it, that
   is a renderer feature request, not a world change.
2. **Seeds are unique.** Two worlds sharing a seed share their landforms exactly,
   which makes them look like the same place recoloured. Enforced across the
   built-in set by the unit tests, not by `validateWorld()` — a validator sees one
   world at a time and cannot know what else exists.
3. **Every anomaly needs a denial.** The whole premise is that nothing is
   provable. A world without deniability lines removes the reason the anomaly
   exists.
4. **Prefer restraint.** `saturation: 0.62` and near-zero `forestDensity` is what
   makes a salt flat look like a salt flat. Filling every biome with trees
   defeats the point of having biomes.

## Versioning

`engine` is the minimum engine major version. A renderer that cannot honour a
field should ignore it rather than reject the world, so adding an optional field
is a minor change. Removing or repurposing a field is a breaking change and
requires a major bump plus a new format version.
