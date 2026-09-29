# Direction

This is the document that explains *why* the renderer is built the way it is. The
architecture explains how; this explains what it is for.

## The one sentence

A live desktop that behaves like a place with a history, observed by a piece of
equipment that may or may not be telling the truth.

## What this is not

It is not a scenic wallpaper with occasional visual glitches. That version is
easy to build and it is boring within a week, because a beautiful landscape does
not ask anything of the viewer.

It is also not a horror project. Nothing chases you, nothing appears, nothing
follows. A creature in the frame converts liminality into a haunted house, and a
haunted house is a different and much less interesting thing.

## The three registers

The project works in three registers that are opposites with one shared
discipline: put **one** thing in the frame that cannot be right, and then refuse
to confirm it.

### Liminal — the almost-ordinary

A liminal space is not frightening because it is dark. It is unsettling because
it is *almost* normal: an ordinary corridor, a car park, a lobby at an hour when
nobody is there. The unease is the gap between expectation and reality.

Four rules, taken from what actually makes this imagery work:

1. **No people, ever.** The absence is the subject. The moment a figure is in
   frame, the space becomes somewhere something is watching you, which is
   horror rather than liminality.
2. **Low entropy.** Repetition, symmetry, a small palette. The eye has nothing
   to rest on, so it begins hunting for the thing that changed.
3. **Mundane geometry.** Institutional tile, panelled walls, ceiling grids, a row
   of identical fluorescent tubes. Nothing dramatic ever happens here, on
   purpose.
4. **Exactly one wrong thing.** The space is almost right. Two or more wrong
   details and it becomes a set design.

Implemented as a separate scene constructor, because an interior has no sky and
no ridgeline and pretending otherwise produces nonsense. See
`src/Engine/src/renderer/LiminalInterior.ts`.

### Uncanny — the near-miss

Everything stays correct and one detail is off by a hair. The sources, in the
order they actually work on a viewer:

- **Cloned repetition.** Identical elements at a correct rhythm. A forest of
  exactly equal trees is a stencil, not a forest. The *slightly* too regular is
  the tell.
- **The wrong count.** Six lights, then seven, then six again. The eye is very
  good at counting and does it without being asked.
- **Almost-legible text.** Marks at reading size and an opacity that only
  resolves if you look. The moment any of them form a word, they should not.
- **A light that is right until it is not.** Same brightness, same colour, same
  rhythm, and then one interval is longer. Nothing is out of place; the sequence
  simply has an extra beat.
- **Pareidolia.** Two dark marks and a lighter surround, positioned so a face
  is *available* without ever being present. Never drawn as a face.

Implemented in `src/Engine/src/renderer/UncannyLayer.ts`. Everything is drawn
small and faint on purpose: the effect only works while it is being looked for,
and if the viewer notices it immediately it has failed.

### Surreal — the impossible

One violation of physical possibility, never two. Two is a joke; one is a dream.

Scale inversion, a shadow with no object above it, sky reflected at the wrong
depth, a seam in the ground line. The amount is deliberately tiny, because a
large violation reads as a bug report and a small one reads as something you are
not sure you saw.

## The hard rule

**Never draw a creature.** Presence is implied by what moved, what changed, or
what is almost there. This is not a stylistic preference; it is the thing that
keeps the project liminal instead of turning it into a jumpscare generator.

## The surface: the observatory terminal

The product is a mystery interface that happens to be looking at a landscape. The
CRT is the surface that carries the mystery, so it is a composited layer lit by
the same time of day as the world, standing *in* the scene rather than overlaid
on it.

It is deliberately small and quiet. The landscape is the subject; the terminal is
a piece of equipment humming at the edge of the view, not a HUD competing for
the same space.

Three rules govern its behaviour:

1. **Quiet by default.** It idles. It is equipment, not an interface.
2. **Never break the fiction.** It does not know it is wallpaper, never uses UI
   words like "anomaly", and never claims to be watching the user.
3. **Everything it says is deniable.** A signal is a calibration ping. A visitor
   is a bird. The player must always be able to decide they imagined it — that
   is the entire contract of the ARG.

## The moment the whole thing is for

> *The best moment is when the user looks at their desktop and realises that
> something changed while they were away.*

That only works under three conditions, all of which are easy to get wrong:

- **It has to be earned.** Below forty-five minutes there is nothing to say, and
  nothing is said, because a summary on every launch is a notification.
- **It has to be deniable.** The copy reports what the *place* did, not what
  happened to the player. The trees moved in closer. The corridor is longer.
  Every line carries an explanation.
- **It has to be brief.** Shown once, on the terminal, for nine seconds, and
  never re-shown. A thing that demands attention is not a discovery.

## Worlds as data

A world is roughly forty lines of data: a biome, a palette, a terrain profile
and a list of structures. The renderer generates every pixel.

This is a deliberate constraint, not a limitation. It means contributing a world
needs no art pipeline, no licence review and no renderer change, and it keeps the
guarantee that the project ships no third-party art. See
[`world-format.md`](world-format.md).

## Anomalies are properties of places

An anomaly is only frightening if it belongs to the place you are looking at. So
every anomaly is scoped by biome and by required structure, and the scheduler
substitutes a fitting one rather than firing something that makes no sense
there. `forest-watcher` will not trigger on a salt flat because there is nothing
to hide in.

The same anomaly is also *named* per world, so the journal reads as a record of a
location rather than a global effect log: the town "holds its breath", the head
"goes dark", the fell observatory "answers". See
`src/Engine/src/anomalies/worldFlavor.ts`.

## Art direction

Three styles ship, all complete renderer treatments rather than filters over one
image:

- **Painterly** — layered atmospheric perspective, baked finish, film grain.
  Currently the strongest across day, night, weather and every world.
- **Flat** — flat fills and solid ridges, no per-frame readback.
- **Riso** — a real two-drum halftone separation with spot inks, dot-area
  coverage and paper showing through. It is a print, not a filter.

All three hold up across the full day and night cycle. The choice between them
is still open.

## Open decisions

Two things are deliberately undecided and should stay that way until someone
actually looks at the options:

- **The name.** See [`NAMING.md`](NAMING.md).
- **The art direction.** Painterly currently wins on every condition tested, but
  all three styles are now legitimate and the difference is a matter of taste
  rather than of quality.

## What would be a betrayal of this

- Drawing a monster.
- Making the terminal urgent — red alert boxes, beeping, countdowns.
- Telling the player they are being watched.
- A summary that appears on every launch.
- An anomaly that fires where it makes no sense, purely for frequency.
- Replacing procedural scenery with stock photography.
