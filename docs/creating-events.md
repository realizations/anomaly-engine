# Creating Events

There are three kinds of "something happens" in this engine, and they are all
**data**. There is no plugin API, no trigger DSL and no condition language: an
earlier revision of this document described all three, none of which existed.

Which file you edit depends on what you want:

| You want | Edit | Read |
|---|---|---|
| An occasional sky or weather event, weighted by rarity | `src/Engine/src/events/RandomSource.ts` | [`event-system.md`](event-system.md) |
| Something that happens at a particular time | `src/Engine/src/events/ClockSource.ts` | [`event-system.md`](event-system.md) |
| A strange, notable thing with a name, lore and a denial | `src/Engine/src/anomalies/builtin.ts` | below |
| A moment the player can notice and record | `src/Engine/src/systems/MomentSystem.ts` | below |
| A note the player can find | `src/Engine/src/systems/SecretSystem.ts` | below |

## Random and clock events

A random event is one line in `EVENT_DEFS`:

```ts
{ type: 'random.meteor', rarity: 'rare', payload: { brightness: 0.8 }, cooldown: 7200, duration: 5 },
```

The bus enforces `cooldown` in seconds, so duplicates are dropped however many
sources emit the same type. Rarity is not per-event weight — it selects from a
fixed table (`common` 70, `uncommon` 20, `rare` 8, `very_rare` 1.8,
`legendary` 0.2), so a `rare` event is picked roughly 8% of the time an event is
picked at all, not 8% of rolls.

To add one, append to `EVENT_DEFS`. `RANDOM_EVENT_TYPES` is derived from that array
and is what the tests assert against, so nothing else needs updating.

Clock events live in `ClockSource` and are emitted from its tick. There are three:
`time.hourly`, `time.midnight`, and `time.0333`.

## Anomalies

An anomaly is the tier the project is really about: something with a name, a rarity,
a cooldown, a duration, and a pair of numbers the renderer can read.

```ts
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
```

**`cooldown` is in seconds. `duration` is in milliseconds.** Every other time field
on the surrounding types is milliseconds, so this one is easy to get wrong by a
factor of a thousand — a 30-second anomaly written as `duration: 30` blinks.

`category` is one of `visual`, `audio`, `temporal`, `behavioral`, `cosmic`.

### Which fields actually do something

This is the part worth reading before you write one, because three fields on
`AnomalyDefinition` are declared and not yet interpreted:

| Field | Honoured? |
|---|---|
| `rarity`, `cooldown`, `duration` | Yes — rarity drives selection, the other two gate firing |
| `biomes` | **Yes.** The anomaly only fires in those biomes |
| `requiresStructure` | **Yes.** The world must contain a structure of that kind |
| `effects` | **No.** Recorded, and nothing reads it. The visual is a direct renderer call |
| `conditions` | **No.** Never evaluated |
| `prerequisites` | Checked, but nothing marks one met, so an anomaly with any could never fire |

`biomes` and `requiresStructure` are what make an anomaly belong to a place rather
than sitting on top of one. "Something moves between the trees" over a salt flat
reads as a bug rather than a mystery, which the user noticed and said so. Omit
`biomes` only for things that could happen anywhere, like a sky event.

Because `effects` is inert, wiring a new anomaly to something visible means adding
it to the renderer's anomaly handling as well. `AnomalyKind` in `WorldRenderer.ts`
is the union of what can be drawn; a definition whose id is not in that union will
be selected, journaled and named, and will show nothing.

### Adding one that draws

1. add the id to `AnomalyKind` in `WorldRenderer.ts`
2. handle it where anomalies are drawn
3. add the definition to `BUILT_IN_ANOMALIES`
4. give it a generic flavour in `worldFlavor.ts` if the default text would not suit
5. add it to the `ANOMALIES` list in `tools/showcase.mjs`, or the gallery fails

Step 5 is enforced: `showcase.mjs` compares its list against the engine's and exits
non-zero if a shipped anomaly has no frame. Step 4 is not — a missing flavour falls
back to generic text and nothing complains — but `AnomalyWorldFit.test.ts` now
asserts every shipped anomaly has a real one.

## Deniability

Every anomaly needs a plausible reason it was nothing. It is the entire premise:
the player should always be able to talk themselves out of what they saw. World
lore carries these in `registry.ts`:

```ts
lore: {
  premise: '...',
  epitaph: '...',
  deniability: ['A plausible reason nothing is happening.'],
},
```

A world without deniability lines is rejected by no check and warned about by one —
`validateWorld()` reports it as a warning rather than an error, which is a
deliberate choice, because a world with no landmarks is legitimate but a world that
cannot explain itself away defeats the premise.

## Moments and secrets

A **moment** is something the player notices, not something the engine fires.
`BUILTIN_MOMENTS` names the event to watch for in `anomalyId`, and that name has to
be a type the engine can actually emit — `tests/Discovery.test.ts` asserts it,
because a wrong name is invisible: the lookup misses and nothing says so.

A **secret** is a note with clues. `relatedAnomalies` holds shipped anomaly ids and
is asserted against them for the same reason.

## Tests

Anything you add here should come with a test, and the ones that matter are mostly
about names rather than behaviour:

- `tests/ShippedIds.test.ts` — every identifier the data files name actually ships
- `tests/Discovery.test.ts` — moments name emittable events; secrets ship clues
- `tests/AnomalyWorldFit.test.ts` — world fit, and that every anomaly has a flavour
- `tests/I18n.test.ts` — every locale carries the same keys, in English terms
  present and fiction absent